import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tradingDaysBetween } from "../lib/source-health.mjs";

test("tradingDaysBetween counts weekdays only", () => {
  // Fri 2026-10-09 → Mon 2026-10-12 = 1 trading day (Mon)
  assert.equal(tradingDaysBetween("2026-10-09", "2026-10-12"), 1);
  // Mon → Thu = 3
  assert.equal(tradingDaysBetween("2026-10-12", "2026-10-15"), 3);
  // same day = 0
  assert.equal(tradingDaysBetween("2026-10-13", "2026-10-13"), 0);
  // seed-era far behind
  assert.ok(tradingDaysBetween("2026-07-28", "2026-10-13") > 3);
});

test("portal-run uses persist-to outside dist", () => {
  const sh = fs.readFileSync(new URL("../collector/dmit/aaw-portal-run.sh", import.meta.url), "utf8");
  assert.match(sh, /--persist-to/);
  assert.match(sh, /\/var\/lib\/aaw\/wrangler-state/);
  assert.doesNotMatch(sh, /persist-to.*dist/);
});

test("backup prefers AAW_WRANGLER_PERSIST path", () => {
  const sh = fs.readFileSync(new URL("../scripts/aaw-backup.sh", import.meta.url), "utf8");
  assert.match(sh, /AAW_WRANGLER_PERSIST/);
  assert.match(sh, /\/var\/lib\/aaw\/wrangler-state/);
});

test("shanghai cron helper is DST-safe gate", () => {
  const sh = fs.readFileSync(new URL("../collector/dmit/aaw-cron-shanghai.sh", import.meta.url), "utf8");
  assert.match(sh, /TZ=Asia\/Shanghai/);
  assert.match(sh, /Vixie/);
});
