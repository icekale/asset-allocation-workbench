import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMappingScale,
  enabledCaixinMappings,
  parseCaixinSeriesConfig,
} from "../lib/caixin-series-config.ts";
import { readFile } from "node:fs/promises";

test("example whitelist parses and enables approved mappings", async () => {
  const raw = JSON.parse(await readFile("config/caixin-series.example.json", "utf8"));
  const config = parseCaixinSeriesConfig(raw);
  const enabled = enabledCaixinMappings(config);
  assert.equal(enabled.length, 7);
  const keys = enabled.map((row) => row.targetKey).sort();
  assert.deepEqual(keys, ["M11", "M12", "M13", "M20", "M43", "M62", "M63"]);
  const trade = enabled.find((row) => row.targetKey === "M43");
  assert.equal(trade.id, "6094301");
  assert.equal(trade.scale, 0.01);
});

test("applyMappingScale converts 百万美元 to 亿美元", () => {
  assert.equal(applyMappingScale(119085, 0.01), 1190.85);
  assert.equal(applyMappingScale(null, 0.01), null);
});

test("rejects incomplete mappings", () => {
  assert.throws(() => parseCaixinSeriesConfig({ series: [{ id: "1", enabled: true }] }), /targetKey/);
});
