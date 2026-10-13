# AAW 备份与恢复（DMIT）

## 范围
每日备份（上海时区非整点，默认 **03:17**）：
- 本地 Miniflare D1 sqlite（`.wrangler/state/v3/d1/...`）
- `app/data`（含评分草稿、证据、确认日志等）
- `output/` 下健康与告警 JSON
- `.dev.vars` / `.env.caixin` / `.collector.env`：单独用 **age** 加密后放入包内（私钥只在 `/root/.config/aaw-backup/age.key`，**不入库**）

本地保留 **14** 份于 `/var/backups/aaw/`。整包再经 age 加密为 `aaw-YYYYMMDD-HHMMSS.tgz.age`。

## 命令
```bash
/root/bin/aaw-backup.sh                 # 备份
/root/bin/aaw-backup.sh --list
/root/bin/aaw-backup.sh --restore /var/backups/aaw/aaw-….tgz.age /tmp/aaw-restore-test
```

## 异地副本（需你补充）
当前 DMIT 上的 `vpush_arm_pull` **不能**登录 Oracle ARM（`ubuntu@167.234.213.74`）或其他主机；`.dev.vars` 中也没有 R2/S3 凭证。因此异地推送**尚未启用**。

任选其一后即可打开：
1. **SSH 推送**：把 DMIT 公钥 `/root/.ssh/vpush_arm_pull.pub` 写入目标机 `authorized_keys`，然后：
   ```bash
   # 例如写入 /etc/aaw-backup.env（chmod 600）
   AAW_OFFSITE_CMD='scp -i /root/.ssh/vpush_arm_pull -o StrictHostKeyChecking=accept-new "$1" ubuntu@167.234.213.74:~/aaw-offsite-backups/'
   ```
2. **Cloudflare R2**：提供 `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`，再配一条 `AAW_OFFSITE_CMD`（用 `aws s3 cp` 或 `wrangler r2`）。
3. **Box 拉取**：若允许，可在 `/home/box/backups/hosts.json` 增加 `aaw` 主机条目由 box 拉取（你此前标明 box cron 拉取不可行，故默认不做）。

恢复演练只需本地 age 私钥；异地恢复还需要目标机上的密文包 + 同一私钥副本（请离线保管私钥，不要提交到 git）。
