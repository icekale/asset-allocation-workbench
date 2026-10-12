# 数据自动更新（抓取层）现状与运行方式

本文只描述**抓取与发布自动化**：哪些数据已经在无人值守下更新、由什么触发、失败时会发生什么、
怎么验证。评分与研究结论仍然按 `AGENTS.md` 的要求人工核验，不在本文范围内。

## 三条自动链路

| 链路 | 数据 | 触发 | 执行位置 | 写入目标 |
| --- | --- | --- | --- | --- |
| 指数行情 | 上证指数收盘点位、涨跌幅、观察时间、来源记录 | Cloudflare Cron `10 7 * * 1-5`（北京时间工作日 15:10） | Cloudflare Worker `scheduled` | D1 `dataset_versions`（经 `/api/update` 的同一套校验） |
| 指数行情（兜底） | 同上 | macOS LaunchAgent，工作日 15:20 | 本机 `scripts/refresh-index.mjs --publish` | 先写 `collector/latest-payload.json`，再 POST `/api/update` |
| 官方宏观序列 | 统计局价格/平减指数/二手房、人民银行货币与社融、海关社融流量、政策跟踪 | macOS LaunchAgent，每月 16 日、26 日 09:40 | 本机 `scripts/refresh-official-macro.mjs` | `app/data/*.json`（重构建后生效） |

Wind 与财新仍是**半自动**：脚本只产出可审计候选（`output/wind-*.json`、`output/caixin-sync-report.json`），
映射与口径确认后才能写进 payload —— 见 `docs/WIND_DATA.md`、`docs/CAIXIN_API.md`。

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

# 单元测试
node --experimental-strip-types --test tests/index-quote.test.mjs tests/index-refresh.test.mjs
```

## 安装定时任务

```bash
bash scripts/install-launchd.sh          # 安装并加载 launchd/*
launchctl kickstart -k gui/$UID/com.asset-allocation.index-refresh   # 立即试跑
launchctl bootout gui/$UID/com.asset-allocation.index-refresh        # 卸载
```
