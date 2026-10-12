/**
 * 把抓到的指数行情合并进现有 payload 的纯函数：保留 19 项大类因子、6 项风格因子、
 * 现仓与评分，只替换 `index`、`asOf`、`collectedAt` 和对应的来源记录。
 *
 * 只做类型导入，因此本地采集脚本（Node 类型剥离）与 Worker 可以共用同一份实现。
 */

import type { IndexQuote } from "./index-quote";
import type { MarketInputPayload, SourceEvidence } from "./types";

/** 行情快照对应的数据日（北京时间）。 */
export function quoteAsOf(quote: IndexQuote) {
  return quote.observedAt.slice(0, 10);
}

/** 该快照是否已经写入：同一天同一收盘点位视为已更新，避免 D1 中堆积无意义版本。 */
export function isQuoteApplied(payload: MarketInputPayload, quote: IndexQuote) {
  return payload.index?.value === quote.value && payload.asOf === quoteAsOf(quote);
}

function evidenceFor(quote: IndexQuote): SourceEvidence {
  const note = quote.crossChecked && quote.crossCheck
    ? `收盘后抓取；与 ${quote.crossCheck.publisher}（${quote.crossCheck.sourceUrl}）的同口径点位交叉核验一致。`
    : "收盘后抓取；本次仅单一行情源可用，未完成交叉核验。";
  return {
    id: quote.sourceId,
    title: `${quote.name}行情快照`,
    publisher: quote.publisher,
    url: quote.sourceUrl,
    observedAt: quote.observedAt,
    note,
  };
}

export function mergeIndexQuote(payload: MarketInputPayload, quote: IndexQuote): MarketInputPayload {
  const asOf = quoteAsOf(quote);
  const evidence = evidenceFor(quote);
  const notes = [
    `指数截至 ${asOf}；19 项大类因子与 6 项风格因子未随本次行情更新，评分沿用上一期研究快照。`,
    ...(payload.notes ?? []).filter((note) => !note.startsWith("指数截至 ")),
  ];
  return {
    ...payload,
    asOf,
    collectedAt: quote.observedAt,
    status: "partial",
    index: {
      name: "上证指数",
      code: "000001.SH",
      value: quote.value,
      changePct: quote.changePct,
      observedAt: quote.observedAt,
      sourceId: quote.sourceId,
    },
    sources: [evidence, ...(payload.sources ?? []).filter((source) => source.id !== evidence.id)],
    notes,
  };
}
