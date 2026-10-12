import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDraft, rulesHash } from "../lib/macro-rating-draft.mjs";
import { buildSuggestions, JUDGEMENT_IDS } from "../lib/macro-rating-suggest.mjs";
import { parseRrrNotice, parseToolTable, parseLeverageReport, classifyPolicy } from "../lib/macro-rating-judgement-parse.mjs";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const framework = read("app/data/macro-rating-v1.json"), current = read("app/data/macro-rating-current.json");
const lock = read("config/macro-rating-rules-lock.json");
const asOf = current.asOf;
const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2025, 9 + i, 1)); return d.toISOString().slice(0, 7); });
const jev = {
  toolTables: Object.fromEntries(months.map((m) => [m, { period: m, title: `${m}中央银行各项工具流动性投放情况`, tool: "调整法定存款准备金率", unit: "亿元", injection: "-", withdrawal: "-", netInjection: "-", tableComplete: true,
    sourceUrl: `https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/5727710/${m.replace("-", "")}/index.html`, releaseDate: `${m === "2026-09" ? "2026-10" : months[months.indexOf(m) + 1]}-05` }])),
  rrrNotices: {}, rrrNoticeScan: { listUrl: "https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html", scannedItems: 261, oldestDate: "2025-09-22" },
  policyDocs: { a: { title: "关于推动设备更新的通知", url: "https://www.gov.cn/zhengce/x.htm", releaseDate: "2026-10-10", publisher: "国务院", themes: ["industrySupport"] } },
  bis: { dsrPrivate: { sourceUrl: "https://stats.bis.org/x", retrievedAt: asOf, rows: [{ period: "2025-Q1", value: 18.9 }, { period: "2026-Q1", value: 19.1 }] } },
};
const ev = { mpr: { "2025-12": { period: "2025-12", reportUrl: "https://www.pbc.gov.cn/r4/index.html", releaseDate: "2026-02-10" },
  "2026-03": { period: "2026-03", reportUrl: "https://www.pbc.gov.cn/r1/index.html", releaseDate: "2026-05-11" }, "2026-06": { period: "2026-06", reportUrl: "https://www.pbc.gov.cn/r2/index.html", releaseDate: "2026-08-12" } } };
const data = { prices: { rows: [] }, money: { rows: [] }, ev, jev };
const draft = (entries) => buildDraft({ framework, current, lock, data: { ...data, confirmations: { entries } }, asOf });

test("suggestions exist for all 7 judgement items but are never applied without a decision", () => {
  const d = draft([]);
  assert.equal(rulesHash(framework), lock.sha256);
  for (const id of JUDGEMENT_IDS) {
    const row = d.rows.find((r) => r.id === id);
    assert.equal(row.source, "manual-carry", id);
    assert.equal(row.suggestion.label, "建议(待确认)");
    assert.deepEqual(d.observations[id], current.observations[id], id);
  }
  assert.equal(d.counts.pendingSuggestions, 7);
  assert.equal(d.after.score, d.before.score);
});

test("P02E suggestion is unusable until the user attests, then becomes a valid ledger", () => {
  const s = buildSuggestions({ framework, current, jev, ev, asOf }).P02E;
  assert.equal(s.suggestedValue, 0);
  assert.ok(s.candidate.rrrActionLedger.monthlyChecks.every((c) => c.policyReviewComplete === false));
  const d = draft([{ id: "P02E", action: "confirm", key: s.key, at: "2026-10-13T08:00:00+08:00" }]);
  const row = d.rows.find((r) => r.id === "P02E");
  assert.equal(row.source, "manual-confirmed", JSON.stringify(row.decision));
  assert.ok(d.observations.P02E.rrrActionLedger.monthlyChecks.every((c) => c.policyReviewComplete === true));
  assert.equal(d.observations.P02E.rrrActionLedger.attestation.confirmedAt, "2026-10-13T08:00:00+08:00");
  assert.equal(row.newScore, 3);
});

test("edit / keep / stale decisions", () => {
  const all = buildSuggestions({ framework, current, jev, ev, asOf });
  const d = draft([
    { id: "P03B", action: "edit", value: 3, note: "测试改档", key: all.P03B.key, at: "t1" },
    { id: "P04A", action: "edit", value: 4.5, key: all.P04A.key, at: "t1" },
    { id: "F09", action: "keep", key: all.F09.key, at: "t1" },
    { id: "P03A", action: "confirm", key: "stale", at: "t0" },
  ]);
  const row = (id) => d.rows.find((r) => r.id === id);
  assert.equal(row("P03B").source, "manual-edited");
  assert.equal(d.observations.P03B.value, 3);
  assert.equal(d.observations.P03B.policyReview.direction, "中性或混合");
  assert.equal(row("P04A").source, "manual-carry");
  assert.match(row("P04A").decision.error, /不支持/);
  assert.equal(row("F09").source, "manual-kept");
  assert.equal(row("P03A").decision.stale, true);
  assert.equal(row("P03A").source, "manual-carry");
});

test("judgement parsers", () => {
  assert.equal(parseRrrNotice("中国人民银行决定于2025年5月15日下调金融机构存款准备金率0.5个百分点（不含已执行5%存款准备金率的金融机构）。").signedChangeBp, -50);
  assert.equal(parseToolTable("单位：亿元 工具类型 准备金 调整法定存款准备金率 - - - 公开市场业务 x").injection, "-");
  const r = parseLeverageReport("2026 年二季度宏观杠杆率下降 1.1 个百分点，从一季度的 309.3%下降至\n308.2%。其中，居民部门杠杆率下降 1.3 个百分点，从一季度的 59.0%下降至\n57.7%；非金融企业杠杆率下降 0.5 个百分点，从一季度的 180.0%下降至 179.5%；居民部门债务同比增长-1.3%，企业部门债务同比增长 7.8%", "2026年二季度宏观杠杆率报告");
  assert.deepEqual([r.period, r.household.value, r.corporate.value, r.householdDebtGrowth, r.corporateDebtGrowth], ["2026-Q2", 57.7, 179.5, -1.3, 7.8]);
  assert.deepEqual(classifyPolicy("关于进一步提高上市公司质量的意见"), ["capitalMarketInstitution"]);
});
