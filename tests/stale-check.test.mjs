import assert from "node:assert/strict";
import test from "node:test";
import { daysBetween, parseYmd, shanghaiToday } from "../lib/stale-check.mjs";
import { checkMacroStaleness } from "../lib/stale-check.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("parseYmd handles Chinese and ISO periods", () => {
  assert.equal(parseYmd("2026-08"), "2026-08-01");
  assert.equal(parseYmd("2026年08月份"), "2026-08-01");
  assert.equal(parseYmd("2026-09-24"), "2026-09-24");
  assert.equal(parseYmd("2026-07（最近已核验）"), "2026-07-01");
});

test("daysBetween and shanghaiToday are stable", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-12"), 11);
  assert.match(shanghaiToday(new Date("2026-10-12T01:00:00Z")), /^2026-10-1[12]$/);
});

test("checkMacroStaleness returns structured report against live app/data", async () => {
  const report = await checkMacroStaleness(root, { now: new Date("2026-10-12T12:00:00+08:00") });
  assert.equal(report.today, "2026-10-12");
  assert.ok(report.summary.checked >= 6);
  assert.ok(Array.isArray(report.items));
  const ids = report.items.map((item) => item.id);
  assert.ok(ids.includes("advisory.M62"));
  assert.ok(ids.includes("macro-policy.updated"));
});
