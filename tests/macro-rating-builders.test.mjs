import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as P from "../lib/rating-evidence-parse.mjs";
import { BUILDERS } from "../lib/macro-rating-builders.mjs";
import { buildDraft, loadDraftData, MANUAL_REASONS, AUTO_MAPPERS, rulesHash } from "../lib/macro-rating-draft.mjs";
import { scoreIndicator } from "../lib/macro-rating.mjs";

const fx = (f) => fs.readFileSync(new URL(`./fixtures/rating-evidence/${f}`, import.meta.url), "utf8");
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const framework = read("app/data/macro-rating-v1.json"), current = read("app/data/macro-rating-current.json");
const lock = read("config/macro-rating-rules-lock-v1.21.json");

test("every indicator is either auto (mapper/builder) or an explained manual item", () => {
  for (const r of framework.indicators) assert.ok(AUTO_MAPPERS[r.id] || BUILDERS[r.id] || MANUAL_REASONS[r.id], r.id);
  assert.deepEqual(Object.keys(MANUAL_REASONS).sort(), ["F09", "F10", "P02E", "P03A", "P03B", "P04A", "P04B"]);
  assert.equal(rulesHash(framework), lock.sha256);
});

test("parsers read official fixtures", () => {
  const c = P.parseCustomsSummary(P.pageText(fx("customs-2026-08.html")).spaced);
  assert.equal(c.releaseDate, "2026-09-18");
  assert.deepEqual(c.rows["2026-08"], { exportMonth: 401441, exportYtd: 2923839, exportMonthYoy: 25, exportYtdYoy: 19.3 });
  const a = P.parseAfreStock(P.pageText(fx("afre-2026.htm")).spaced);
  assert.deepEqual(a["2026-08"], { totalStock: 464.8, governmentBondStock: 103.69 });
  assert.deepEqual(P.parseOmo(P.pageText(fx("omo-2026-09-29.html")).compact), { date: "2026-09-29", rate: 1.4 });
  const m = P.parseMprLoanRate("\f".repeat(13) + fx("mpr-2026q2-table.txt"));
  assert.deepEqual(m, { period: "2026-06", value: 3.04, table: "表4，PDF第14页" });
});

test("G10 built from customs fixture reproduces V1.21 score", () => {
  const t = P.parseCustomsSummary(P.pageText(fx("customs-2026-08.html")).spaced);
  const customs = Object.fromEntries(Object.entries(t.rows).map(([k, r]) => [k, { ...r, sourceUrl: current.observations.G10.sourceUrl, releaseDate: t.releaseDate }]));
  const rule = framework.indicators.find((r) => r.id === "G10");
  const o = BUILDERS.G10({ ev: { customs }, template: current.observations.G10, asOf: current.asOf }, "2026-08");
  assert.equal(scoreIndicator(rule, o, current.asOf, framework.freshness), scoreIndicator(rule, current.observations.G10, current.asOf, framework.freshness));
});

const evidencePath = new URL("../app/data/macro-rating-evidence.json", import.meta.url);
test("back-test: builders reproduce V1.21 from collected evidence", { skip: !fs.existsSync(evidencePath) && "no collected evidence" }, () => {
  const { ev, data } = loadDraftData(read);
  for (const [id, build] of Object.entries(BUILDERS)) {
    if (id === "G10" && !Object.keys(ev.customs || {}).length) continue;
    const rule = framework.indicators.find((r) => r.id === id), ref = current.observations[id];
    const o = build({ ev, data, template: ref, asOf: current.asOf }, ref.period);
    assert.ok(o, `${id} no evidence`);
    assert.equal(o.value, ref.value, id);
    assert.equal(scoreIndicator(rule, o, current.asOf, framework.freshness), scoreIndicator(rule, ref, current.asOf, framework.freshness), id);
  }
  const d = buildDraft({ framework, current, lock, data: { ...data, ev }, asOf: current.asOf });
  assert.equal(d.counts.autoRejected, 0);
  assert.equal(d.after.score, d.before.score);
});
