#!/usr/bin/env node
// Back-test: rebuild each auto indicator for the V1.21 period from collected evidence and compare with V1.21.
import fs from "node:fs";
import { scoreIndicator } from "../lib/macro-rating.mjs";
import { BUILDERS } from "../lib/macro-rating-builders.mjs";
import { loadDraftData } from "../lib/macro-rating-draft.mjs";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const framework = read("app/data/macro-rating-v1.json");
const current = read("app/data/macro-rating-current.json");
const { ev, data } = loadDraftData((f) => read(f));
const asOf = current.asOf;
const rows = [];
for (const [id, build] of Object.entries(BUILDERS)) {
  const rule = framework.indicators.find((r) => r.id === id);
  const ref = current.observations[id];
  const refScore = scoreIndicator(rule, ref, asOf, framework.freshness);
  let built = null, error = null;
  try { built = build({ ev, data, template: ref, asOf }, ref.period); } catch (e) { error = e.message; }
  const score = built ? scoreIndicator(rule, built, asOf, framework.freshness) : null;
  const status = !built ? "no-evidence" : score === null ? "rejected" : Math.abs(score - refScore) < 1e-9 ? "match" : "differs";
  rows.push({ id, period: ref.period, status, refValue: ref.value, builtValue: built?.value ?? null, refScore, score, error });
}
const out = { asOf, generatedAt: new Date().toISOString(), rows, summary: rows.reduce((s, r) => ({ ...s, [r.status]: (s[r.status] || 0) + 1 }), {}) };
if (process.argv.includes("--write")) fs.writeFileSync(new URL("../output/rating-builder-backtest.json", import.meta.url), JSON.stringify(out, null, 2));
for (const r of rows) console.log(`${r.id.padEnd(5)} ${r.period} ${r.status.padEnd(11)} ref=${r.refValue} built=${r.builtValue} score ${r.refScore?.toFixed?.(4)} → ${r.score?.toFixed?.(4) ?? r.score}${r.error ? " ERR " + r.error : ""}`);
console.log(JSON.stringify(out.summary));
