# 定时数据采集与发布运行手册

目标：更新网页所需的市场输入，并让访问者在 60 秒轮询周期内看到最新结果。任何分数必须可追溯；数据缺失时保留上一期分数或记 0，不允许猜测。

## 自动化现状

| 数据 | 触发 | 入口 |
| --- | --- | --- |
| 上证指数收盘行情 | Cloudflare Cron，工作日北京时间 15:10（本地 LaunchAgent 15:20 兜底） | Worker `scheduled` → `lib/auto-refresh.ts`；本地 `scripts/refresh-index.mjs --publish` |
| 官方宏观序列（统计局/人民银行/海关总署） | macOS LaunchAgent，每月 16 日、26 日 09:40 | `scripts/refresh-official-macro.mjs` |
| Wind 宏观候选、财新序列候选 | 手工 | `scripts/refresh-wind-macro.mjs`、`scripts/caixin-sync.mjs` |
| 19 项大类因子、6 项风格因子评分 | 手工研究后发布 | 见下文"人工复核" |

自动化细节、验证命令与失败处理见 `docs/AUTOMATION.md`。

## 指数行情（已自动）

1. 抓取与交叉核验：腾讯财经、新浪财经、东方财富三源并发，两个及以上源成功时点位偏差必须 ≤ 0.2%，否则整体拒绝写入，线上保留上一期数据。
2. 写入：只替换 `index`、`asOf`、`collectedAt`、来源记录与提示语；19 项大类因子、6 项风格因子、现仓和评分原样保留。同一交易日同一收盘点位不会重复入库。
3. 手工核对（可选）：`node --experimental-strip-types scripts/fetch-shanghai-index.mjs` 只抓取不写入；
   `node --experimental-strip-types scripts/refresh-index.mjs --baseline=collector/latest-payload.json --output=/tmp/payload.json`
   可在不联网写库的前提下复核合并与校验结果。
4. 节假日/周末行情源返回上一交易日快照，幂等判断会跳过，无需维护交易日历。

## 官方宏观序列（自动抓取，默认人工确认发布）

1. 运行 `PYTHON=/path/to/python3 node scripts/refresh-official-macro.mjs`（LaunchAgent 已按月触发）。第三方依赖见 `scripts/requirements.txt`；缺依赖的采集器会被跳过并在报告中说明，不计为抓取失败。
2. 脚本运行前整目录备份 `app/data`，运行后逐文件比对：新结果若丢了原有顶层字段、`rows` 明显变短或不是合法 JSON，会自动回滚该文件并把采集结果留在 `output/official-macro-refresh/pending/`。
3. 报告在 `output/official-macro-refresh/<时间戳>/report.md`。有 `pending/` 文件时人工合并后，再运行 `bash scripts/deploy-cloudflare.sh` 发布；加 `--deploy` 参数可在无失败、无 pending 时自动发布。

## 人工复核（评分与 Wind/财新）

1. 对到期因子采集最新证据：周度因子每周至少复核一次；月度因子只在官方月度数据发布后复核；事件因子仅在政策或重大事件发生时调整。
2. Wind 与财新只产出候选：`node --experimental-strip-types scripts/refresh-wind-macro.mjs`、`node --experimental-strip-types scripts/caixin-sync.mjs`；映射、口径与单位确认后才写进 payload。
3. 更新 payload：`node scripts/download-current.mjs` 取上一期基线，改完写回 `collector/latest-payload.json`，
   运行 `node scripts/validate-payload.mjs collector/latest-payload.json`，通过后 `node scripts/publish-data.mjs collector/latest-payload.json`。
4. 腾讯云旧镜像（`cloudbase-proxy/`）不是默认发布目标：只有用户明确要求同步国内镜像时才运行
   `node scripts/publish-data-cloudbase.mjs collector/latest-payload.json`，并以线上 `/api/health` 的数据指纹一致为成功标准。

## 来源优先级

- 中国行情：腾讯财经或交易所行情；点位可双源交叉核验。
- 中国宏观与政策：国家统计局、中国人民银行、财政部、国务院或证监会等官方来源。
- 利率与资金：人民银行、全国银行间同业拆借中心、中债或交易所官方数据。
- 美国利率与实际利率：Federal Reserve / FRED；美元指数使用可审计的指数或权威行情来源。
- 波动率：CBOE；商品供需优先行业组织或政府统计；黄金优先上海黄金交易所或 World Gold Council 的可核验材料。
- 市场资金、估值和趋势：交易所、指数公司、官方披露或可直接验证的行情序列。

禁止把搜索摘要、转载文章或无链接的二手结论当成唯一证据。每条已核验因子至少关联一个 `sourceId`；重大方向变化尽量使用两个独立来源。

## 评分纪律（-2 至 +2，可用 0.5 分）

- `+2`：多项证据同向且强度处于显著有利区间。
- `+1`：证据偏有利但尚未形成极端状态。
- `0`：中性、相互抵消或证据不足。
- `-1`：证据偏不利。
- `-2`：多项证据同向且处于显著不利区间。

因子方向以工作簿口径为准。例如“增长环境”对债券的正分代表增长下行利多债券；“美元与实际利率”对商品的正分代表美元与实际利率下行。不要把指标涨跌方向直接等同于资产分数。

## 19 项大类因子

- 股票：盈利趋势；政策与流动性；估值赔率；趋势与资金；情绪与尾部风险。
- 债券：增长环境；通胀环境；货币政策；估值与期限利差；信用与趋势。
- 商品：通胀与再通胀；全球需求；美元与实际利率；供给与地缘；价格趋势。
- 另类：分散化需求；波动与趋势机会；Alpha与价差机会；成本与流动性。

## 6 项股票风格因子

长端利率下行、盈利扩散改善、风险偏好上升、科技产业政策增强、成长相对赔率改善、股息替代吸引力上升。沿用上一期暴露矩阵，只更新评分、证据、来源与核验状态。

## 质量门槛

- 当前仓位合计必须为 100%，不得由采集任务擅自改动客户现仓。
- 每个大类因子权重合计必须为 100%。
- 已核验因子必须有来源；证据和来源时间必须匹配。
- 新旧评分若变化超过 1 分，在 `notes` 写明变更原因。
- 发布失败时保留本地 payload 和错误信息，不覆盖上一期线上数据。
- 国内站点发布失败不影响已经验证成功的原站数据；保留本地 payload，报告 CloudBase 的具体错误并等待凭据恢复后重试。
