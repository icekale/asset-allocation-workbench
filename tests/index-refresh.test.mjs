import assert from "node:assert/strict";
import test from "node:test";
import { seedPayload } from "../lib/seed.ts";
import { isQuoteApplied, mergeIndexQuote, quoteAsOf } from "../lib/index-refresh.ts";

const quote = {
  code: "000001.SH",
  name: "上证指数",
  value: 3797.24,
  changePct: -0.43,
  observedAt: "2026-10-12T16:14:00+08:00",
  sourceId: "tencent-sh000001-20261012",
  sourceUrl: "https://qt.gtimg.cn/q=sh000001",
  publisher: "腾讯财经",
  crossChecked: true,
  crossCheck: { publisher: "东方财富", value: 3797.24, sourceUrl: "https://push2.eastmoney.com/api/qt/stock/get" },
};

test("merges the quote without touching factor scores or holdings", () => {
  const next = mergeIndexQuote(seedPayload, quote);
  assert.equal(next.asOf, "2026-10-12");
  assert.equal(next.collectedAt, "2026-10-12T16:14:00+08:00");
  assert.equal(next.status, "partial");
  assert.equal(next.index.value, 3797.24);
  assert.deepEqual(next.factors, seedPayload.factors);
  assert.deepEqual(next.styleFactors, seedPayload.styleFactors);
  assert.deepEqual(next.currentHoldings, seedPayload.currentHoldings);
  assert.equal(next.sources[0].id, "tencent-sh000001-20261012");
  assert.match(next.sources[0].note, /东方财富/);
  assert.equal(next.notes.filter((note) => note.startsWith("指数截至 ")).length, 1);
});

test("keeps one index note across repeated merges", () => {
  const once = mergeIndexQuote(seedPayload, quote);
  const twice = mergeIndexQuote(once, quote);
  assert.equal(twice.notes.filter((note) => note.startsWith("指数截至 ")).length, 1);
  assert.equal(twice.sources.filter((source) => source.id === quote.sourceId).length, 1);
});

test("detects snapshots that are already stored", () => {
  assert.equal(quoteAsOf(quote), "2026-10-12");
  assert.equal(isQuoteApplied({ ...seedPayload, asOf: "2026-10-12", index: { ...seedPayload.index, value: 3797.24 } }, quote), true);
  assert.equal(isQuoteApplied({ ...seedPayload, asOf: "2026-10-12", index: { ...seedPayload.index, value: 3700 } }, quote), false);
  assert.equal(isQuoteApplied({ ...seedPayload, asOf: "2026-10-11", index: { ...seedPayload.index, value: 3797.24 } }, quote), false);
});

test("marks an uncross-checked snapshot in the source note", () => {
  const next = mergeIndexQuote(seedPayload, { ...quote, crossChecked: false, crossCheck: undefined });
  assert.match(next.sources[0].note, /未完成交叉核验/);
});
