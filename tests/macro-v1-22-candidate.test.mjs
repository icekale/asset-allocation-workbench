import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rulesHash, reproduceSnapshot } from "../lib/macro-rating-draft.mjs";
import { scoreIndicator } from "../lib/macro-rating.mjs";
import { buildCandidate, cnbsObservations, CURVES } from "../scripts/macro-v1-22-candidate.mjs";
import { interp } from "../lib/macro-leverage-curve.mjs";
import { machineAttestP02E } from "../lib/macro-rating-suggest.mjs";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url)));
const fw = read("app/data/macro-rating-v1.21.json"), lock = read("config/macro-rating-rules-lock.json");

test("V1.22 is the active locked rule set; V1.21 is frozen and still reproduces its snapshot", () => {
  const v122 = read("app/data/macro-rating-v1.22.json"), v121 = read("app/data/macro-rating-v1.21.json"), l121 = read("config/macro-rating-rules-lock-v1.21.json");
  assert.equal(lock.rulesVersion, "V1.22");
  assert.equal(rulesHash(v122), lock.sha256);
  assert.equal(rulesHash(v121), l121.sha256);
  assert.equal(l121.sha256, "33630d6fd616822af98291fa43fb0543e708431e2b656a865984d090206c594b");
  assert.equal(lock.previous.sha256, l121.sha256);
  const cur = read("app/data/macro-rating-current.json"), hist = read("app/data/macro-rating-history.json");
  if (cur.version === "V1.21") {
    const snap = hist.snapshots.find((x) => x.version === "V1.21" && x.asOf === cur.asOf);
    assert.equal(reproduceSnapshot(v121, cur, snap).ok, true);
  }
  for (const r of v122.indicators) {
    const o = v121.indicators.find((x) => x.id === r.id);
    assert.equal(r.weight, o.weight);
    if (!["F09", "F10"].includes(r.id)) assert.deepEqual(r, o);
    else assert.deepEqual({ l: r.scoring.levelAnchors, y: r.scoring.yoyAnchors, w: r.scoring.levelWeight }, { l: CURVES[r.id].levelAnchors, y: CURVES[r.id].yoyAnchors, w: 0.5 });
  }
  assert.deepEqual(v122.pillars, v121.pillars);
  assert.deepEqual(v122.ratingBands, v121.ratingBands);
  assert.equal(read("config/macro-rating-rules-lock-candidates.json").candidates["V1.22-candidate"].status, "promoted-to-V1.22");
});

test("curve scores interpolate, and a missing year-ago value scores null (no neutral fill)", () => {
  assert.equal(interp([[0, 1], [10, 5]], 5), 3);
  assert.equal(interp([[0, 1], [10, 5]], 99), 5);
  const cand = buildCandidate(fw), rule = cand.indicators.find((r) => r.id === "F09");
  const cnbs = { "2025-Q2": { household: { value: 61.1, previous: 61.5 }, corporate: { value: 174, previous: 173.7 }, sourceUrl: "http://www.nifd.cn/SeriesReport/Details/4728", releaseDate: "2025-07-30" },
    "2026-Q2": { household: { value: 57.7, previous: 59 }, corporate: { value: 179.5, previous: 180 }, sourceUrl: "http://www.nifd.cn/SeriesReport/Details/4976", releaseDate: "2026-07-30" } };
  const rows = cnbsObservations(cnbs, "F09");
  assert.equal(scoreIndicator(rule, rows[0].obs, "2025-07-30", cand.freshness), null);
  const s = scoreIndicator(rule, rows[1].obs, "2026-07-30", cand.freshness);
  assert.ok(Math.abs(s - (0.5 * 2.825 + 0.5 * 1.8)) < 1e-9);
});

test("P02E machine attestation only when the cross-check is fully consistent", () => {
  const candidate = { value: 0, rrrActionLedger: { monthlyChecks: [{ policyReviewComplete: false }], attestation: null } };
  assert.equal(machineAttestP02E({ candidate, machineCheck: { consistent: false, reasons: ["x"] } }, "2026-10-13"), null);
  assert.equal(machineAttestP02E({ candidate: null, machineCheck: { consistent: true } }, "2026-10-13"), null);
  const o = machineAttestP02E({ candidate, machineCheck: { consistent: true, reasons: [], windowStart: "2025-10-01", windowEnd: "2026-09-30" } }, "2026-10-13");
  assert.equal(o.rrrActionLedger.attestation.type, "machine-attested");
  assert.equal(o.rrrActionLedger.monthlyChecks[0].policyReviewComplete, true);
  assert.equal(candidate.rrrActionLedger.monthlyChecks[0].policyReviewComplete, false);
});
