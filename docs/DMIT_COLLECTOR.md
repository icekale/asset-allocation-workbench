# DMIT 采集机说明（179.255.150.134）

仓库：`/root/aaw`（分支 `main`（默认分支））  
密钥：`/root/aaw/.env.caixin`（chmod 600，gitignore；勿提交）  
门户本地密钥：`/root/aaw/.dev.vars`（chmod 600；勿提交）  
生产装载：`dist/server/.dev.vars` → 符号链接到 `.dev.vars`（`wrangler dev` 读取；勿提交 `dist/`）  
包装脚本：`/root/bin/aaw-collector.sh`、`/root/bin/aaw-index-refresh.sh`  
门户启动：`/root/bin/aaw-portal-run.sh`  
日志：`/var/log/aaw/collector-*.log`、`/var/log/aaw/index-refresh-*.log`（`collector-last.log` 指向最近一次）、`/var/log/aaw/vinext-prod.log`、`/var/log/aaw/vinext-build.log`
包装脚本会清理 45 天前的 collector 日志，并对超过 20MB 的 `vinext-prod.log` 做轮转。

## Cron（`CRON_TZ=Asia/Shanghai`）

| 时间 | 模式 | 说明 |
| --- | --- | --- |
| 工作日 09:30 | `audit-light` | 跳过重采集；财新白名单审计 + 过期检查（**不写** `app/data`） |
| 工作日 15:10 | `index-refresh` | 上证指数收盘后同步到本地 D1（与 CF Worker cron `10 7 * * 1-5` UTC 对齐）；只改 `index`/`asOf`/`collectedAt` |
| 每月 16、26 日 09:40 | `apply` | 官方采集写入 `app/data` + 财新审计 + 过期检查；成功或数据有变更时自动重启门户 |

`apply` 使用 `--fail-on-stale=false`：官方稿未出导致的软过期**不会**让 cron 失败；真正的采集硬失败仍非 0 退出。  
宏观 `apply` **不写** D1 / 评分 / 打分记录；只刷新宏观 / 政策 / 咨询类 JSON。  
指数刷新会写本地 Miniflare D1（`wrangler --local`），**不**改 19 项大类因子、6 项风格因子或宏观评分。

### 手动模式

```bash
# 仅审计（暂存，不写 app/data）
AAW_MODE=audit /root/bin/aaw-collector.sh

# 轻量审计（与工作日 cron 相同）
AAW_MODE=audit-light /root/bin/aaw-collector.sh

# 写入 app/data 并在成功/有变更时重启门户
AAW_MODE=apply /root/bin/aaw-collector.sh
```


## 指数行情（本地 D1）

包装脚本：`/root/bin/aaw-index-refresh.sh`（源：`collector/dmit/aaw-index-refresh.sh`）  
日志：`/var/log/aaw/index-refresh-*.log`（`index-refresh-last.log` 指向最近一次）  
密钥：优先读 `/root/aaw/.collector.env`（`SITE_URL` + `UPDATE_TOKEN`，gitignore）；若缺省则从 `.dev.vars` 的 `UPDATE_TOKEN` 生成，默认 `SITE_URL=http://[::1]:8788`。

```bash
# 手动同步到最新交易日收盘
/root/bin/aaw-index-refresh.sh

# 只抓取不写库
cd /root/aaw && node --experimental-strip-types scripts/fetch-shanghai-index.mjs

# 验证
curl -sS http://[::1]:8788/api/health
# 期望 asOf 为最近交易日，stale=false（收盘后数小时内）
```

节假日行情源返回上一交易日快照时幂等跳过，无需维护交易日历。

## 门户（生产构建）

本仓库依赖 `cloudflare:workers`，**不能**用裸 `vinext start`（会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME: cloudflare:`）。

DMIT 做法：

1. `cd /root/aaw && NODE_OPTIONS=--max-old-space-size=1536 npm run build`（`vinext build` → `dist/`）
2. `systemctl start aaw-portal` → `wrangler dev --config dist/server/wrangler.json --port 8788 --ip ::1 --local`
3. 上游链：`[::1]:8788` ← socat sock/proxy ← Docker `aaw-edge` ← `vpush-caddy`

回滚开发模式（仅应急）：

```bash
# ExecStart=.../vinext dev -p 8788 --host ::1
# 备份单元：/etc/systemd/system/aaw-portal.service.bak-dev-*
```

- 域名：`https://aaw.053727.xyz/`；备用 `https://aaw.179-255-150-134.sslip.io/`
- 密码：仅存 `/root/aaw/.dev.vars`，勿入库
- 构建产物 `dist/`、`.wrangler/` 已在 `.gitignore`


## 软失败（GDP 平减指数）

`collect-nbs-gdp-deflator.py` 对国家统计局 SDDS 页做最多 4 次退避重试。若仍失败（偶发空页/WAF），`refresh-official-macro` 记为 **软失败**：保留现有 `macro-gdp-deflator-history.json`，**整次 apply 仍 exit 0**，避免 cron 长期报警。其它采集器失败仍为硬失败。

门户顶部「N 天前更新」读取 `app/data/data-revision.json` 的 `refreshedAt`（官方宏观写入戳），不再误用 D1 种子组合的 `collectedAt`。


## 每日备份

包装脚本：`/root/bin/aaw-backup.sh`（源：`collector/dmit/aaw-backup.sh` / `scripts/aaw-backup.sh`）  
Cron（上海时区非整点）：`17 3 * * *` → `/root/bin/aaw-backup.sh`  
详情见 `docs/AAW_BACKUP.md`。异地副本需你提供 SSH 授权或 R2 凭证后启用。

## 健康与告警

`node scripts/source-health.mjs` → `output/source-health.json` / `output/alerts.json`；门户 `/ops`。
