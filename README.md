# 资产配置工作台

面向投资研究的资产配置工作台，包含宏观趋势、宏观评级及评分历史、核心会议与政策跟踪、股票评级框架，以及大类资产、中观、微观和配置总览。

主站：<https://multi-asset-allocation-advisor.xlp2077.workers.dev/>

## 本地运行

需要 Node.js 22.13.0 或更新版本。

```bash
npm ci
npm run dev
```

访问密码、会话密钥及数据更新令牌通过 Cloudflare Worker 环境变量配置。参考 `.env.example` 的变量名称，将本地 Worker 密钥写入被 Git 忽略的 `.dev.vars`；不要提交真实密钥。Wind 与财新接入说明分别见 `docs/WIND_DATA.md` 和 `docs/CAIXIN_API.md`。

## 检查与发布

```bash
node --experimental-strip-types --test tests/*.test.mjs
bash scripts/deploy-cloudflare.sh --dry-run
```

当前发布脚本适用于 macOS Apple Silicon，兼容本机 Codex 随附的 Node，并处理锁定版本 esbuild 的隔离属性。`--dry-run` 仅构建和预检查，不发布。

明确需要发布主站时运行：

```bash
bash scripts/deploy-cloudflare.sh
```

只有 Wrangler 返回成功回执并核对线上页面后才算发布完成。腾讯云旧镜像位于 `cloudbase-proxy/`，不作为默认同步发布目标。

## 目录

- `app/`：页面、组件、接口和当前研究数据。
- `lib/`：评分、数据接入、认证及计算逻辑。
- `scripts/`：采集、核验、评级更新、导出与发布脚本。
- `tests/`：现有回归检查。
- `docs/`：数据来源、接入说明与评级规则版本。
- `deliverables/`：研究证据、评分工作簿、历史备份和页面核验材料。
- `wrangler.deploy.jsonc`：Cloudflare Worker、静态资源及 D1 绑定配置。

## 数据与评分记录规则

宏观及金融数据按“官方原始发布 → 万得 Wind → 财新数据 API”的顺序获取与核验。记录统计期、单位、口径和来源；无法可靠核验的点保留为空。

评分记录默认全部保留。更新通过 `appendMacroRatingRecord` 向当前 `app/data/macro-rating-history.json` 追加独立快照，拒绝重复截止日及版本。只有用户明确指定时才删除记录，并先保留可恢复备份。完整维护要求见 `AGENTS.md`。

## 自动更新

- 上证指数收盘行情：Cloudflare Cron 在工作日北京时间 15:10 触发 Worker `scheduled`，三源交叉核验（腾讯/新浪/东方财富，偏差上限 0.2%）后写入 D1；本机 LaunchAgent 15:20 兜底。
- 官方宏观序列：本机 LaunchAgent 每月 16 日、26 日运行 `scripts/refresh-official-macro.mjs`（或 `collector-run.mjs --mode=apply`），只抓取与比对，结构不兼容时自动回滚并留下待人工合并的副本。
- 编排与新鲜度：`scripts/collector-run.mjs`（默认 audit，不写 `app/data`）+ GitHub Actions `data-refresh.yml`；报告见 `output/collector-last-run.json`。详情 `docs/AUTOMATION.md`。
- 指数抓取单测：`npm run test:automation`；安装定时任务：`npm run launchd:install`。
- 数据新鲜度：`/api/health` 返回 `asOf`、`ageHours`、`stale`，可直接接入监控。

自动化设计、验证命令与失败处理见 [`docs/AUTOMATION.md`](docs/AUTOMATION.md)。
