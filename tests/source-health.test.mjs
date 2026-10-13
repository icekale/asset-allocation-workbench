import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSourceHealth, writeSourceHealth } from "../lib/source-health.mjs";
import { attributeHistory, attributeSnapshots } from "../lib/macro-rating-attribution.mjs";
import { simulateRating } from "../lib/macro-rating-simulate.mjs";
import { adviseAllocation, backtestAllocationSignal } from "../lib/allocation-advisory.mjs";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

test("source health builds summary and writes alerts without secrets", async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const health = await buildSourceHealth(root);
  assert.ok(health.summary.total >= 5);
  assert.equal(health.notification.status, "portal-only");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-h-"));
  fs.mkdirSync(path.join(tmp, "output"), { recursive: true });
  // write into tmp by monkeypatching: call write on real root is fine for CI; use real output
  await writeSourceHealth(root, health);
  const alerts = JSON.parse(fs.readFileSync(path.join(root, "output/alerts.json"), "utf8"));
  assert.ok(Array.isArray(alerts.alerts));
  assert.ok(!JSON.stringify(alerts).includes("cxk_"));
});

test("attribution lists drivers between V1.20 and V1.21", () => {
  const history = read("app/data/macro-rating-history.json");
  const all = attributeHistory(history);
  assert.ok(all.length >= 1);
  const last = all.at(-1);
  assert.equal(last.current.version, "V1.21");
  assert.ok(last.drivers.length >= 1);
  const direct = attributeSnapshots(history.snapshots.find((s) => s.version === "V1.20"), history.snapshots.find((s) => s.version === "V1.21"));
  assert.ok(Math.abs(direct.totalDelta - (direct.current.score - direct.previous.score)) < 1e-9);
});

test("simulate never claims write and responds to an override", () => {
  const framework = read("app/data/macro-rating-v1.json");
  const current = read("app/data/macro-rating-current.json");
  const id = framework.indicators.find((r) => r.scoring?.method === "piecewise-linear")?.id;
  assert.ok(id);
  const baseVal = current.observations[id].value;
  const out = simulateRating({ framework, current, overrides: { [id]: { value: baseVal } } });
  assert.equal(out.write, false);
  assert.equal(out.scenario.status, out.base.status);
});

test("allocation advisory is labelled and back-test documents limitations", () => {
  const advice = adviseAllocation({ grade: "III档 条件中性", pillars: [{ name: "金融信贷", observedScore: 2.2 }] });
  assert.equal(advice.available, true);
  assert.match(advice.label, /仅供参考/);
  assert.ok(advice.ranges.权益[1] <= 0.5); // tilt down from III base
  const bt = backtestAllocationSignal({ history: read("app/data/macro-rating-history.json"), macroHistory: read("app/data/advisory.json").macroHistory });
  assert.match(bt.limitation, /不构成统计显著/);
  assert.ok(bt.rows.length >= 1);
});
