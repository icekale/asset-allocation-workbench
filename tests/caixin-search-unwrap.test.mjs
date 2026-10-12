import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCaixinCountry, searchCaixinSeries, unwrapCaixinSearchSeries } from "../lib/caixin.ts";

test("unwraps nested search payload used by cxdata.053727.xyz", () => {
  const rows = unwrapCaixinSearchSeries({
    query: "消费者信心指数",
    mode: "fts",
    series: [
      { series_id: "5198401", name: "消费者信心指数", unit: "点", frequency: "M", source: "国家统计局", has_data: true },
      { series_id: "5198501", name: "消费者信心指数:满意", unit: "点", frequency: "M", source: "国家统计局", has_data: true },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].series_id, "5198401");
});

test("unwraps a bare array for backward compatibility", () => {
  assert.equal(unwrapCaixinSearchSeries([{ series_id: "1", name: "x" }]).length, 1);
  assert.deepEqual(unwrapCaixinSearchSeries(null), []);
  assert.deepEqual(unwrapCaixinSearchSeries({ series: null }), []);
});

test("maps ISO country codes to 中国 for the Caixin API", () => {
  assert.equal(normalizeCaixinCountry("CN"), "中国");
  assert.equal(normalizeCaixinCountry("chn"), "中国");
  assert.equal(normalizeCaixinCountry("中国"), "中国");
  assert.equal(normalizeCaixinCountry(undefined), undefined);
});

test("searchCaixinSeries returns an array even when upstream nests series", async () => {
  const result = await searchCaixinSeries("消费者信心指数", {
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      data: { query: "消费者信心指数", mode: "fts", series: [{ series_id: "5198401", name: "消费者信心指数" }] },
      meta: { request_id: "req-search" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  }, { country: "CN" });
  assert.equal(Array.isArray(result.series), true);
  assert.equal(result.series[0].series_id, "5198401");
});
