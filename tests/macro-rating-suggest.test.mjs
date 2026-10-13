import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDraft, rulesHash } from "../lib/macro-rating-draft.mjs";
import { buildSuggestions, JUDGEMENT_IDS } from "../lib/macro-rating-suggest.mjs";
import { parseRrrNotice, parseToolTable, parseLeverageReport, classifyPolicy, parseLocalBondMonthly, parseToolRows, extractPolicyFinanceFacts, classifyBody, parseAnnualTargets, parseNewsList, attachmentLinks, parseSpecialBondUseStatements } from "../lib/macro-rating-judgement-parse.mjs";

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

test("special-bond, structural-tool and policy-finance parsers", () => {
  const t = "2026年8月，全国发行新增地方政府债券6440亿元，其中一般债券1227亿元、专项债券5213亿元。全国发行再融资债券5505亿元，其中一般债券1798亿元、专项债券3707亿元。全国发行地方政府债券合计11945亿元，其中一般债券3025亿元、专项债券8920亿元。2026年1-8月，全国发行新增地方政府债券34957亿元，其中一般债券5664亿元、专项债券29293亿元。全国发行再融资债券43077亿元，其中一般债券13715亿元、专项债券29362亿元。截至2026年8月末，全国地方政府债务余额598955亿元。其中，一般债务179194亿元，专项债务419761亿元";
  const r = parseLocalBondMonthly(t);
  assert.deepEqual([r.period, r.month.newSpecial, r.ytd.newSpecial, r.balance.special], ["2026-08", 5213, 29293, 419761]);
  const old = parseLocalBondMonthly("2025年11月，全国发行新增地方政府债券5338亿元，其中一般债券416亿元、专项债券4922亿元。全国发行再融资债券3789亿元，其中一般债券2346亿元、专项债券1443亿元。合计，全国发行地方政府债券9127亿元，其中一般债券2762亿元、专项债券6365亿元。");
  assert.equal(old.month.specialTotal, 6365);
  assert.equal(parseToolRows("抵押补充贷款（PSL） 0 14 -14 其他结构性货币政策工具 6016 6580 -564").psl.netInjection, -14);
  const f = extractPolicyFinanceFacts("无关导航。记者获悉，国开新型政策性金融工具已投放资金608.5亿元，支持项目153个。今年的政府工作报告明确，2026年发行新型政策性金融工具8000亿元，带动更多社会资本参与投资。");
  assert.deepEqual(f.filter((x) => !x.isQuotaRestate).map((x) => x.amounts), [[608.5]]);
  assert.equal(f.find((x) => x.isQuotaRestate)?.amounts[0], 8000);
  assert.deepEqual(classifyBody("上市公司分红…上市公司回购…资本市场"), ["capitalMarketInstitution"]);
});

test("annual targets, news lists and attachment links", () => {
  assert.deepEqual(parseAnnualTargets("拟发行超长期特别国债1.3万亿元，持续支持。拟安排地方政府专项债券4.4万亿元，完善。发行新型政策性金融工具8000亿元，带动"),
    { specialBondQuota: 44000, policyFinanceToolQuota: 8000, ultraLongSpecialTreasury: 13000 });
  const l = parseNewsList('<a href="./202609/t20260924_13583.html">国开新型政策性金融工具9月以来已投放超600亿元</a><a href="./info/news/202609/t20260906_77538.html"><h4>财政部将向中国进出口银行注资</h4><h5>2026-09-06</h5></a>', "https://www.cdb.com.cn/xwzx/khdt/");
  assert.deepEqual(l.map((x) => [x.date, x.title]), [["2026-09-24", "国开新型政策性金融工具9月以来已投放超600亿元"], ["2026-09-06", "财政部将向中国进出口银行注资"]]);
  assert.deepEqual(attachmentLinks('<a href="/files/a.PDF">x</a><a href="b.wps">', "https://x.gov.cn/p/"), ["https://x.gov.cn/files/a.PDF", "https://x.gov.cn/p/b.wps"]);
});

test("special-bond use statements and cleaner policy-finance facts", () => {
  const f = extractPolicyFinanceFacts("分享到：无关。记者9月24日从国家开发银行获悉，9月以来，国开新型政策性金融工具已投放资金608.5亿元，支持项目153个，涉及项目总投资1.4万亿元。今年的政府工作报告明确，2026年发行新型政策性金融工具8000亿元，带动更多社会资本参与投资。");
  assert.equal(f[0].amounts[0], 608.5);
  assert.equal(f.find((x) => x.isQuotaRestate)?.amounts[0], 8000);
  const u = parseSpecialBondUseStatements("上半年各地累计发行新增专项债券2.07万亿元，发行进度47%，支持建设项目超1.7万个，其中用于项目资本金超1700亿元。截至7月末，发行新增专项债券2.41万亿元，支持建设项目超1.8万个。指导督促各地加快资金拨付使用进度，尽快形成实物工作量。", { sourceUrl: "https://mof.example/a", releaseDate: "2026-07-22", publisher: "财政部" });
  assert.ok(u.some((x) => x.kind === "issuance" && x.issuedYi === 20700 && x.progressPct === 47 && x.capitalYi === 1700));
  assert.ok(u.some((x) => x.kind === "issuance-asof" && x.asOfMonth === 7 && x.issuedYi === 24100));
  const d = parseSpecialBondUseStatements("新增专项债券方面，今年一季度全国共发行11599亿元，较去年同期增加1996亿元，增长20.8%；拨付专项债券资金6723亿元，较去年同期增加2096亿元，有力推动形成实物工作量。用于置换存量隐性债务的专项债券方面，一季度全国共发行9604亿元，完成全年限额2万亿元的48%，拨付专项债券资金5904亿元，有力支持地方置换存量隐性债务。截至9月20日，全国新增专项债发行3.1万亿元，完成全年限额的70%。", { sourceUrl: "https://mof.example/q1", releaseDate: "2026-04-24", publisher: "财政部" });
  assert.ok(d.some((x) => x.kind === "disbursement" && x.disbursedYi === 6723 && !x.isSwap));
  assert.ok(d.some((x) => x.kind === "disbursement-swap" && x.disbursedYi === 5904));
  assert.ok(d.some((x) => x.kind === "issuance" && x.issuedYi === 11599));
  assert.ok(d.some((x) => x.kind === "issuance-asof-date" && x.asOfMonth === 9 && x.asOfDay === 20 && x.issuedYi === 31000 && x.progressPct === 70));
  const eom = parseSpecialBondUseStatements("发挥地方政府专项债券带动作用，截至7月底全国已发行2026年新增专项债券2.4万亿元，支持建设项目超过1.8万个。", { sourceUrl: "https://mof.example/scio", releaseDate: "2026-08-21", publisher: "财政部" });
  assert.ok(eom.some((x) => x.kind === "issuance-asof" && x.asOfMonth === 7 && x.issuedYi === 24000 && x.projectsWan === 1.8));
  assert.ok(eom.some((x) => x.kind === "issuance" && x.issuedYi === 24000));
});
