import assert from "node:assert/strict";
import test from "node:test";
import {
  EASTMONEY_QUOTE_URL,
  SINA_QUOTE_URL,
  TENCENT_QUOTE_URL,
  fetchIndexQuote,
  parseEastmoneyQuote,
  parseSinaQuote,
  parseTencentQuote,
} from "../lib/index-quote.ts";

// 2026-10-12 收盘快照（截取自真实响应，仅保留已使用字段）。
const TENCENT_SAMPLE =
  'v_sh000001="1~上证指数~000001~3797.24~3813.79~3806.98~461448981~0~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~~20261012161400~-16.55~-0.43~3828.22~3791.00~3797.24/461448981/714909910722";';
const SINA_SAMPLE =
  'var hq_str_sh000001="上证指数,3806.9786,3813.7913,3797.2424,3828.2162,3790.9954,0,0,461448981,714909910722,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-10-12,16:19:55,00,";';
const EASTMONEY_SAMPLE = JSON.stringify({
  rc: 0,
  data: { f43: 379724, f57: "000001", f58: "上证指数", f59: 2, f86: 1791792720, f169: -1655, f170: -43 },
});

function mockFetch(bodies) {
  return async (url) => {
    const body = bodies[url];
    if (body === undefined) return new Response("upstream down", { status: 502 });
    return new Response(body);
  };
}

test("parses Tencent quote into a Beijing-time snapshot", () => {
  const quote = parseTencentQuote(TENCENT_SAMPLE);
  assert.equal(quote.code, "000001.SH");
  assert.equal(quote.value, 3797.24);
  assert.equal(quote.changePct, -0.43);
  assert.equal(quote.observedAt, "2026-10-12T16:14:00+08:00");
  assert.equal(quote.sourceId, "tencent-sh000001-20261012");
  assert.equal(quote.crossChecked, false);
});

test("parses Sina quote and derives the change from the previous close", () => {
  const quote = parseSinaQuote(SINA_SAMPLE);
  assert.equal(quote.value, 3797.2424);
  assert.equal(quote.changePct, -0.43);
  assert.equal(quote.observedAt, "2026-10-12T16:19:55+08:00");
  assert.equal(quote.sourceId, "sina-sh000001-20261012");
});

test("parses Eastmoney quote with its own scale factor", () => {
  const quote = parseEastmoneyQuote(EASTMONEY_SAMPLE);
  assert.equal(quote.value, 3797.24);
  assert.equal(quote.changePct, -0.43);
  assert.equal(quote.observedAt.slice(0, 10), "2026-10-12");
  assert.equal(quote.sourceId, "eastmoney-1.000001-20261012");
  assert.equal(quote.publisher, "东方财富");
});

test("rejects incomplete quote payloads", () => {
  assert.throws(() => parseTencentQuote('v_sh000001="1~上证指数~000001~3797.24";'), /字段不完整|格式/);
  assert.throws(() => parseSinaQuote('var hq_str_sh000001="上证指数,1,2,3";'), /字段不完整/);
  assert.throws(() => parseEastmoneyQuote(JSON.stringify({ data: { f43: 379724, f59: 2 } })), /时间戳/);
  assert.throws(() => parseEastmoneyQuote(JSON.stringify({ data: {} })), /缺少点位字段/);
});

test("cross-checks every available source and marks the snapshot verified", async () => {
  const quote = await fetchIndexQuote({
    fetchImpl: mockFetch({
      [TENCENT_QUOTE_URL]: TENCENT_SAMPLE,
      [SINA_QUOTE_URL]: SINA_SAMPLE,
      [EASTMONEY_QUOTE_URL]: EASTMONEY_SAMPLE,
    }),
  });
  assert.equal(quote.crossChecked, true);
  assert.equal(quote.publisher, "腾讯财经");
  assert.equal(quote.value, 3797.24);
  // 精确一致（同一点位）的源优先作为见证，其次才取任一成功源。
  assert.equal(quote.crossCheck.publisher, "东方财富");
});

test("cross-checks against the second source when the first one is throttled", async () => {
  const quote = await fetchIndexQuote({
    fetchImpl: mockFetch({ [SINA_QUOTE_URL]: SINA_SAMPLE, [EASTMONEY_QUOTE_URL]: EASTMONEY_SAMPLE }),
  });
  assert.equal(quote.publisher, "新浪财经");
  assert.equal(quote.crossChecked, true);
  assert.equal(quote.crossCheck.publisher, "东方财富");
});

test("refuses the snapshot when two sources disagree", async () => {
  const quote = await fetchIndexQuote({
    fetchImpl: mockFetch({
      [TENCENT_QUOTE_URL]: TENCENT_SAMPLE,
      [EASTMONEY_QUOTE_URL]: JSON.stringify({ data: { f43: 390000, f59: 2, f86: 1791792720, f170: -43 } }),
    }),
  }).catch((error) => error);
  assert.match(quote.message, /行情源不一致/);
});

test("falls back to the surviving source and reports it as uncross-checked", async () => {
  const quote = await fetchIndexQuote({ fetchImpl: mockFetch({ [TENCENT_QUOTE_URL]: TENCENT_SAMPLE }) });
  assert.equal(quote.crossChecked, false);
  assert.equal(quote.value, 3797.24);
});

test("throws when every source fails", async () => {
  await assert.rejects(() => fetchIndexQuote({ fetchImpl: mockFetch({}) }), /行情源全部失败/);
});
