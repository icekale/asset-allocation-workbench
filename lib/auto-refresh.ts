/**
 * 自动更新编排：抓取行情 → 与 D1 中最新 payload 合并 → 复用 savePayload 校验写入。
 *
 * 只在 Worker 中运行（依赖 cloudflare:workers 绑定），由 Cron 触发器调用。
 */

import { latestPayload, savePayload } from "./database";
import { fetchIndexQuote } from "./index-quote";
import { isQuoteApplied, mergeIndexQuote } from "./index-refresh";

export type IndexRefreshResult = {
  updated: boolean;
  asOf: string;
  value?: number;
  changePct?: number;
  crossChecked?: boolean;
  versionId?: number;
  checksum?: string;
};

export async function refreshIndexFromSources(): Promise<IndexRefreshResult> {
  const current = await latestPayload();
  const quote = await fetchIndexQuote();
  if (isQuoteApplied(current, quote)) {
    return { updated: false, asOf: current.asOf, value: quote.value, changePct: quote.changePct, crossChecked: quote.crossChecked };
  }
  const saved = await savePayload(mergeIndexQuote(current, quote));
  return {
    updated: true,
    asOf: quote.observedAt.slice(0, 10),
    value: quote.value,
    changePct: quote.changePct,
    crossChecked: quote.crossChecked,
    versionId: saved.id,
    checksum: saved.checksum.slice(0, 12),
  };
}
