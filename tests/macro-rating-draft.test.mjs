import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDraft, publishDraft, reproduceSnapshot, rulesHash, nextVersion } from "../lib/macro-rating-draft.mjs";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const framework = read("app/data/macro-rating-v1.json"), current = read("app/data/macro-rating-current.json");
const history = read("app/data/macro-rating-history.json"), lock = read("config/macro-rating-rules-lock-v1.21.json");
const emptyData = { prices: { rows: [] }, money: { rows: [] } };

test("V1.21 snapshot reproduces exactly from frozen rules", () => {
  const snap = history.snapshots.find((s) => s.version === "V1.21");
  const res = reproduceSnapshot(read("app/data/macro-rating-v1.json"), current, snap);
  assert.deepEqual(res.mismatches, []);
  assert.equal(res.indicatorCount, 38);
  assert.equal(Number(res.total.toFixed(2)), 2.77);
});

test("rules lock matches V1.21 and detects any rule change", () => {
  assert.equal(lock.rulesVersion, "V1.21");
  assert.equal(rulesHash(framework), lock.sha256);
  const tampered = structuredClone(framework); tampered.indicators[0].weight += 0.001;
  assert.throws(() => buildDraft({ framework: tampered, current, lock, data: emptyData, asOf: "2026-10-13" }), /冻结/);
});

test("no new data: draft equals current, all carried", () => {
  const d = buildDraft({ framework, current, lock, data: emptyData, asOf: "2026-10-13" });
  assert.equal(d.totalDelta, 0); assert.equal(d.notable, false); assert.equal(d.counts.auto, 0);
});

test("new CPI auto-maps with frozen curve and diff is consistent", () => {
  const data = { money: { rows: [] }, prices: { rows: [{ period: "2026-09", cpi: 3.5, cpiUrl: "https://www.stats.gov.cn/sj/zxfb/202610/t20261015_1.html" }] } };
  const d = buildDraft({ framework, current, lock, data, asOf: "2026-10-16" });
  const row = d.rows.find((r) => r.id === "E02");
  assert.equal(row.source, "auto"); assert.equal(row.newPeriod, "2026-09");
  const sum = d.rows.reduce((s, r) => s + (r.contributionDelta ?? 0), 0);
  assert.ok(Math.abs(sum - d.totalDelta) < 1e-12);
  assert.equal(current.observations.E02.period, "2026-08", "current untouched");
});

test("publish appends V1.22 and keeps rules + old snapshots", () => {
  const data = { money: { rows: [] }, prices: { rows: [{ period: "2026-09", cpi: 1.0, cpiUrl: "https://www.stats.gov.cn/sj/zxfb/202610/t20261015_1.html" }] } };
  const draft = buildDraft({ framework, current, lock, data, asOf: "2026-10-16" });
  const out = publishDraft({ framework, current, history, lock, draft });
  assert.equal(out.current.version, "V1.22"); assert.equal(nextVersion("V1.9"), "V1.10");
  assert.equal(rulesHash(out.framework), lock.sha256);
  assert.deepEqual(out.history.snapshots.slice(0, -1), history.snapshots);
  assert.equal(out.history.snapshots.length, history.snapshots.length + 1);
  assert.throws(() => publishDraft({ framework: out.framework, current: out.current, history: out.history, lock, draft }), /重新生成/);
});

test("stale carried data is flagged missing, not reweighted", () => {
  const d = buildDraft({ framework, current, lock, data: emptyData, asOf: "2027-06-30" });
  assert.ok(d.counts.missing > 0); assert.equal(d.after.score, null); assert.equal(d.notable, true);
});
