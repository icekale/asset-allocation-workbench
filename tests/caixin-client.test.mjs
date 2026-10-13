import assert from "node:assert/strict";
import test from "node:test";
import { CaixinApiError, getCaixinObservations, normalizeSeries } from "../lib/caixin.ts";

function response(body, status = 200, headers = { "content-type": "application/json" }) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("normalizes valid observations without exposing credentials", () => {
  const result = normalizeSeries({
    series_id: "7028101",
    name: "测试指标",
    unit: "点",
    frequency: "M",
    source: "测试来源",
    observations: [["2026-08-01", 12.5], ["2026-09-01", null]],
  });
  assert.deepEqual(result.observations, [{ date: "2026-08-01", value: 12.5 }, { date: "2026-09-01", value: null }]);
});

test("does not retry no_data and preserves request id", async () => {
  let calls = 0;
  await assert.rejects(
    getCaixinObservations("6406901", { apiKey: "test-key", fetchImpl: async () => {
      calls += 1;
      return response({ ok: false, error: { code: "no_data", message: "no data" }, meta: { request_id: "req-test" } }, 404);
    } }),
    (error) => error instanceof CaixinApiError && error.code === "no_data" && error.requestId === "req-test",
  );
  assert.equal(calls, 1);
});

test("retries 429 and honors eventual success", async () => {
  let calls = 0;
  const result = await getCaixinObservations("7028101", { apiKey: "test-key", maxRetries: 1, fetchImpl: async () => {
    calls += 1;
    return calls === 1
      ? response({ ok: false, error: { code: "rate_limited" }, meta: { request_id: "req-rate" } }, 429, { "content-type": "application/json", "retry-after": "0" })
      : response({ ok: true, data: { series_id: "7028101", name: "测试指标", observations: [["2026-09-01", 1]] }, meta: { request_id: "req-ok" } });
  } });
  assert.equal(calls, 2);
  assert.equal(result.series.observations[0].value, 1);
});

test("treats HTML challenge pages as an upstream error", async () => {
  await assert.rejects(
    getCaixinObservations("7028101", { apiKey: "test-key", maxRetries: 0, fetchImpl: async () => new Response("<!doctype html><html>challenge</html>", { status: 403, headers: { "content-type": "text/html" } }) }),
    (error) => error instanceof CaixinApiError && error.code === "upstream_html",
  );
});

test("retries Cloudflare gateway 504 JSON that is not a Caixin envelope", async () => {
  let calls = 0;
  const result = await getCaixinObservations("5198401", { apiKey: "test-key", maxRetries: 2, fetchImpl: async () => {
    calls += 1;
    return calls < 3
      ? new Response(JSON.stringify({ type: "https://developers.cloudflare.com/", title: "Error 504: Gateway time-out", status: 504 }), { status: 504, headers: { "content-type": "application/json" } })
      : response({ ok: true, data: { series_id: "5198401", name: "消费者信心指数", observations: [["2026-08-01", 89.5]] }, meta: { request_id: "req-ok" } });
  } });
  assert.equal(calls, 3);
  assert.equal(result.series.observations[0].value, 89.5);
});
