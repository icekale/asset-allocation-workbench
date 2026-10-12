# 数据自动更新（抓取层）现状与运行方式

本文只描述**抓取与发布自动化**：哪些数据已经在无人值守下更新、由什么触发、失败时会发生什么、
怎么验证。评分与研究结论仍然按 `AGENTS.md` 的要求人工核验，不在本文范围内。

## 三条自动链路

| 链路 | 数据 | 触发 | 执行位置 | 写入目标 |
| --- | --- | --- | --- | --- |
| 指数行情 | 上证指数收盘点位、涨跌幅、观察时间、来源记录 | Cloudflare Cron `10 7 * * 1-5`（北京时间工作日 15:10） | Cloudflare Worker `scheduled` | D1 `dataset_versions`（经 `/api/update` 的同一套校验） |
| 指数行情（兜底） | 同上 | macOS LaunchAgent，工作日 15:20 | 本机 `scripts/refresh-index.mjs --publish` | 先写 `collector/latest-payload.json`，再 POST `/api/update` |
| 官方宏观序列 | 统计局价格/平减指数/二手房、人民银行货币与社融、海关社融流量、政策跟踪 | macOS LaunchAgent，每月 16 日、26 日 09:40 | 本机 `scripts/refresh-official-macro.mjs` 或 `collector-run.mjs --mode=apply` | `app/data/*.json`（重构建后生效；失败自动回滚） |
| 编排 / 新鲜度 | 分步 ok/fail 报告、过期检查、财新白名单只读审计 | GitHub Actions `data-refresh.yml`（工作日 + 每月 16/26）；本机可同脚本 | `scripts/collector-run.mjs`（默认 `--mode=audit`） | 只写 `output/collector-last-run.json` 与 artifact；**不**写 D1/评分 |

来源优先级：**官方原始发布 →（可选）Wind → 财新 API**。本仓库自动化默认 **不用 Wind**；财新仅白名单审计/补缺。见 `docs/WIND_DATA.md`、`docs/CAIXIN_API.md`、下文「编排器」。

## 指数行情链路

`lib/index-quote.ts` 同时抓三个源并交叉核验，顺序即优先级：

1. 腾讯财经 `qt.gtimg.cn`（响应 GB18030，脚本只用其中的 ASCII 数值字段）
2. 新浪财经 `hq.sinajs.cn`（需要 `Referer`，涨跌幅由昨收现算）
3. 东方财富 `push2.eastmoney.com`（UTF-8 JSON，对高频请求限流）

规则：
- 任一源成功即可更新；**两个及以上源成功时点位偏差必须 ≤ 0.2%**，否则整体拒绝写入，线上保留上一期数据。
- 同一交易日同一收盘点位重复触发不会新增版本（`isQuoteApplied` 幂等判断）。
- 合并只替换 `index`、`asOf`、`collectedAt`、来源记录与提示语，19 项大类因子、6 项风格因子、现仓与评分原样保留。
- 只在一个源可用时仍会写入，但来源记录里会标注"未完成交叉核验"。

时点选择：北京时间 15:10 已在收盘（15:00）之后；节假日行情源返回上一交易日快照，幂等判断会直接跳过，
因此不需要维护交易日历。

## 官方宏观链路

`scripts/refresh-official-macro.mjs` 串行运行 `scripts/collect-*.py`，并做两道防护：

1. 运行前把 `app/data` 整体备份到 `output/official-macro-refresh/<时间戳>/app-data/`；
2. 运行后逐个文件比对，出现以下任一情况即**回滚该文件**并把采集结果留在
   `output/official-macro-refresh/pending/` 供人工合并：
   - 新结果丢了原有顶层字段（采集器输出结构不完整）；
   - `rows` 数量比上一版少 5% 以上（抓取中途失败）；
   - 新结果不是合法 JSON。

默认不发布；`--deploy` 且本轮没有任何待人工合并、没有失败、确有变化时，才调用
`scripts/deploy-cloudflare.sh` 重新构建发布主站。

## 失败与告警

- Worker：抓取或校验失败会抛错，Cloudflare 记录并重试；`/api/health` 暴露
  `asOf`、`collectedAt`、`status`、`ageHours`、`stale`（超过 72 小时未更新为 `true`），可直接接入 uptime 监控。
- D1 中最新一条记录若无法通过校验，会向前取最近 5 条中第一条可用版本，避免一条坏数据让全站退回 seed。
- 本机：采集失败或出现待人工合并时弹一次桌面通知；日志在
  `/tmp/asset-allocation-official-macro.{out,err}.log` 与 `/tmp/asset-allocation-index-refresh.{out,err}.log`。


## 编排器 `collector-run.mjs`

统一入口，两种模式：

| 模式 | 命令 | 写 `app/data`？ | 适用 |
| --- | --- | --- | --- |
| `audit`（默认） | `node --experimental-strip-types scripts/collector-run.mjs` | 否（写入 `output/collector-run/<时间戳>/staging/`） | CI、只读体检 |
| `apply` | `… --mode=apply` | 是（经 `refresh-official-macro.mjs` 备份/回滚） | 能访问官网的本机 |

附加步骤（均可跳过）：

- 财新白名单只读审计：`scripts/caixin-audit.mjs`（需 `CAIXIN_API_KEY` / `.env.caixin`）
- 新鲜度：`lib/stale-check.mjs`；任一关键序列过期则退出码 **2**
- 报告：`output/collector-last-run.json`（每步 ok/fail/skip）

```bash
# CI / 本地只读
node --experimental-strip-types scripts/collector-run.mjs --mode=audit
node --experimental-strip-types scripts/stale-check.mjs

# 本机真抓取（不发布、不写 D1）
node --experimental-strip-types scripts/collector-run.mjs --mode=apply
```

`audit` 下支持 `--output` 暂存的采集器：价格历史、GDP 平减、社融存量、宏观政策（含 LPR）。其余采集器仅在 `apply`（或直接跑 `refresh-official-macro.mjs`）执行。暂存结果若相对线上 **丢字段或 rows 缩水 >20%**，记为 guard 失败，**不会**建议覆盖。

## GitHub Actions

工作流：`.github/workflows/data-refresh.yml`

- **工作日** 01:00 UTC：过期检查 +（若配置）财新审计；跳过重采集
- **每月 16/26** 01:40 UTC：同上并尝试 stageable 采集（海外 runner 访问国内官网常失败，默认**不**因采集失败红灯，只因**过期**失败）
- `workflow_dispatch` 可手动开关采集 / `--strict-collectors`
- Artifact：`collector-last-run.json`、`stale-check.json`、`output/collector-run/**`
- **不会**自动 commit `app/data`、不会部署、不会写 D1

### 需要仓库 Secrets（Settings → Secrets and variables → Actions）

| Secret | 必需？ | 说明 |
| --- | --- | --- |
| `CAIXIN_API_KEY` | 可选 | 未配置则跳过财新审计 |
| `CAIXIN_API_BASE_URL` | 可选 | 默认 `https://cxdata.053727.xyz` |
| `CAIXIN_API_USER_AGENT` | 可选 | 机构标识 |

启用：合并本 PR 后在 Actions 页允许 workflow；首次可手动 **Run workflow**。

人工合并数据：在能访问官网的机器 `--mode=apply` → 检查 diff → 另开数据 PR 或本地构建发布（仍遵守 `AGENTS.md`，不自动改评分）。

## 本机 LaunchAgent / cron

已有：

- `launchd/com.asset-allocation.official-macro.plist` → `refresh-official-macro.mjs`
- `launchd/com.asset-allocation.index-refresh.plist` → 指数兜底

推荐改用编排器（示例模板）：`launchd/com.asset-allocation.collector-run.plist.example`

```bash
# 安装原有 launchd
bash scripts/install-launchd.sh

# 或 cron（Linux 采集机，Asia/Shanghai）
# 40 9 16,26 * * cd /path/to/repo && /path/to/node --experimental-strip-types scripts/collector-run.mjs --mode=apply >> /tmp/collector-run.log 2>&1

# DMIT（179.255.150.134）本地门户：指数收盘写入 Miniflare D1，见 docs/DMIT_COLLECTOR.md
# 10 15 * * 1-5 /root/bin/aaw-index-refresh.sh
```

本机密钥放在被 gitignore 的 `.env.caixin`（或 `.env.local`），**不要**提交。

## 验证

```bash
# 抓取与交叉核验（只读，不写库）
node --experimental-strip-types scripts/fetch-shanghai-index.mjs

# 合并 + 校验 + 幂等（用线上基线或本地基线）
node --experimental-strip-types scripts/refresh-index.mjs --check
node --experimental-strip-types scripts/refresh-index.mjs --baseline=collector/latest-payload.json --output=/tmp/payload.json

# Worker 定时任务：本地触发一次 scheduled 事件
npx wrangler dev --config wrangler.deploy.jsonc --test-scheduled
curl "http://localhost:8787/__scheduled?cron=10+7+*+*+1-5"

# 部署前预检（含 cron 配置）
bash scripts/deploy-cloudflare.sh --dry-run

# 官方宏观抓取（默认不发布）
node scripts/refresh-official-macro.mjs

# 编排器（audit 不写 app/data；过期退出码 2）
node --experimental-strip-types scripts/collector-run.mjs --mode=audit --skip-collectors
node --experimental-strip-types scripts/stale-check.mjs


# 单元测试
node --experimental-strip-types --test tests/index-quote.test.mjs tests/index-refresh.test.mjs
```

## 安装定时任务

```bash
bash scripts/install-launchd.sh          # 安装并加载 launchd/*
launchctl kickstart -k gui/$UID/com.asset-allocation.index-refresh   # 立即试跑
launchctl bootout gui/$UID/com.asset-allocation.index-refresh        # 卸载
```
