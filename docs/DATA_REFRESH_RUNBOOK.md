# 宏观数据自动刷新 Runbook

面向值班：如何打开定时任务、配密钥、读报告、人工合并。抓取策略细节见 `docs/AUTOMATION.md`。

## 优先级

**官方原始发布 →（可选）Wind → 财新 API**。当前自动化默认 **跳过 Wind**；财新只用白名单只读审计/补缺（`config/caixin-series.example.json`）。

## 一键命令

```bash
# 只读体检（CI 同款）
npm run collector:audit
# 或
node --experimental-strip-types scripts/collector-run.mjs --mode=audit

# 本机真抓取（需能访问统计局/央行等；不部署、不写 D1）
npm run collector:apply

# 仅过期检查（过期退出码 2）
npm run stale:check
```

报告：`output/collector-last-run.json`。

## GitHub Actions

1. 合并含 `.github/workflows/data-refresh.yml` 的 PR。
2. 仓库 **Settings → Actions → General**：允许 workflow。
3. **Settings → Secrets**：至少可选配置 `CAIXIN_API_KEY`（及可选 BASE_URL / USER_AGENT）。
4. Actions 页手动 **Run workflow** 验证；之后按 cron 跑。
5. 红灯且日志写 stale：在国内网络机器 `collector:apply`，检查 `app/data` diff，人工开数据 PR；**不要**在 Actions 里自动 push 数据。

## 本机定时

- macOS：`bash scripts/install-launchd.sh`，或按 `launchd/com.asset-allocation.collector-run.plist.example` 安装编排器。
- 密钥：`.env.caixin`（gitignore），勿提交。

## 明确不做的事

- 不自动改宏观评分 / `macro-rating-*.json`
- 不自动写 D1、不自动 `deploy-cloudflare`
- 不在 CI 提交密钥或 `config/caixin-series.json`
