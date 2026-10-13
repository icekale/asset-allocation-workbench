# 数据源健康与告警

## 生成
```bash
node scripts/source-health.mjs
# 写出 output/source-health.json 与 output/alerts.json
```
采集包装脚本在 stale-check 之后也会尝试刷新。

## 门户
登录后打开 `/ops`：展示每源最近成功、预期下次发布、过期/超窗标记与告警列表。

## 外部通知（需你提供配置）
当前**只**写本地 JSON + 门户展示，**不会**发邮件或 Telegram。
若要外发，请提供其一：
- 邮件：SMTP 或事务邮件 API + 收件人
- Telegram：Bot token + chat_id

提供后另开任务接线；密钥仍不入库。

## 组合数据日
`portfolio.asOf`：读 `/api/health` 的 `asOf`。若落后超过 **3 个交易日**（或 `status=seed`），在 `/ops` 告警。重建门户不得清空 `/var/lib/aaw/wrangler-state`。
