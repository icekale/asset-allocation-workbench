import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visually joins composite parent, indented children and a separate result strip without changing score data", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const name of ["macro-score-parent-row", "macro-score-component-row", "macro-score-formula-row", "macro-score-composition"]) {
    assert.ok(source.includes(name), `${name} markup`);
    assert.ok(css.includes(`.${name}`), `${name} layout`);
  }
  assert.match(css, /\.macro-score-parent-row > td:first-child \{[^}]*border-left: 3px solid var\(--navy\)/);
  assert.match(css, /\.macro-score-component-row > td:first-child \{[^}]*padding-left: 38px;[^}]*border-left: 3px solid var\(--navy\)/);
  assert.match(css, /\.macro-score-formula-row > td \{[^}]*max-width: none;[^}]*border-left: 3px solid var\(--navy\);[^}]*border-bottom: 10px solid #fff/);
  assert.match(css, /\.macro-score-composition p \{[^}]*overflow-wrap: anywhere/);
});

test("keeps the advisory portal password protected", async () => {
  const [page, login, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LoginForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /isAuthorized/);
  assert.match(page, /<LoginForm/);
  assert.match(login, /访问密码/);
  assert.match(login, /数据仅供授权人员查看/);
  assert.match(layout, /资产配置工作台/);
});

test("keeps the five-layer framework and the complete allocation engine", async () => {
  const source = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
  for (const label of ["宏观", "大类资产", "中观", "微观", "资产配置"]) assert.match(source, new RegExp(label));
  for (const label of ["配置总览", "市场因子", "细分配置", "情景压力", "参数与方法"]) assert.match(source, new RegExp(label));
  assert.match(source, /currentHoldings|item\.current/);
  assert.doesNotMatch(source, /纪律化决策支持，不构成个人化投资建议|数据与观点均标注时间口径/);
});

test("uses four macro sections after removing the independent indicator library without removing charts or meetings", async () => {
  const source = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
  const macroStart = source.indexOf("function MacroView()");
  const macroEnd = source.indexOf("function AssetView()", macroStart);
  const macroView = source.slice(macroStart, macroEnd);
  assert.match(macroView, /\["宏观概览", "宏观图谱", "宏观评级", "资产传导"\]/);
  assert.doesNotMatch(macroView, /宏观指标|INDICATOR LIBRARY|setPillar|setStatus/);
  assert.match(macroView, /<MacroOverviewHeader \/>/);
  assert.match(source, /评分指标、评分标准与本期结果统一在“宏观评级”中查看/);
  assert.match(source, /中国宏观四维概览/);
  assert.doesNotMatch(macroView, /旧版综合初评（不同口径，仅供回溯）/);
  assert.doesNotMatch(macroView, /Excel 之外必须补看的宏观层/);
  assert.doesNotMatch(macroView, /情景与政策|SCENARIO MAP|POLICY INTELLIGENCE/);
  assert.match(source, /<MacroPolicyCharts section="货币政策" \/>/);
  assert.match(source, /<MacroPolicyCharts section="财政政策" \/>/);
});

test("isolates the overview reading guide with two left-aligned text levels and a narrow-screen layout", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const sharedHeader = source.slice(source.indexOf("function ResearchHeader("), source.indexOf("function MacroOverviewHeader("));
  const overviewHeader = source.slice(source.indexOf("function MacroOverviewHeader("), source.indexOf("const display ="));
  assert.match(sharedHeader, /<div className="research-header">/);
  assert.match(sharedHeader, /<p>\{note\}<\/p>/);
  assert.match(overviewHeader, /<header className="research-header macro-overview-header">/);
  assert.match(overviewHeader, /aria-label="宏观概览阅读说明"/);
  assert.match(overviewHeader, /className="macro-overview-guide-lead">先看四个维度的判断与关键证据/);
  assert.match(overviewHeader, /className="macro-overview-guide-detail">点击卡片进入相关图表；评分指标、评分标准与本期结果统一在“宏观评级”中查看。/);
  assert.match(css, /\.macro-overview-guide \{[^}]*width: 100%;[^}]*max-width: 480px;[^}]*min-width: 0;[^}]*text-align: left/);
  assert.match(css, /@media \(max-width: 1100px\) \{\s*\.macro-overview > \.macro-overview-header \{[^}]*flex-direction: column/);
  assert.match(css, /\.macro-overview-guide \{ max-width: none; padding-left: 0; border-left: 0; \}/);
  assert.match(css, /\.research-header > p \{[^}]*text-align: right/);
});

test("keeps the rating summary compact and responsive without hiding incomplete-evidence alerts", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const summary = source.slice(source.indexOf("export function MacroRatingSummary()"), source.indexOf("export function MacroRatingHistory()"));
  for (const name of ["macro-summary-header", "macro-summary-meta", "macro-summary-score-grid", "macro-summary-pillars"]) assert.match(summary, new RegExp(name));
  assert.match(summary, /className="macro-summary-alert" role="status"/);
  assert.doesNotMatch(summary, /macro-summary-details|<details/);
  assert.doesNotMatch(summary, /本期观察、来源与局限|宏观调控分项 · 财政、货币、产业、制度|同截止日的版本比较|评级方法、发布门槛与适用范围/);
  assert.match(summary, /<p className="macro-summary-observation">观察重点：结合四维差异理解综合分，政策支持不等于经济复苏。<\/p>/);
  assert.match(summary, /已保留评分记录 \{snapshots\.length\} 期/);
  assert.match(css, /\.macro-summary-score-grid \{[^}]*grid-template-columns: 1\.2fr 1fr 1fr/);
  assert.match(css, /\.macro-summary-pillars \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.macro-summary-alert \{[^}]*display: grid;[^}]*background: #fff8ef/);
  assert.match(css, /\.macro-summary-pillar-score small \{ display: inline/);
  assert.match(css, /\.macro-summary-pillars article > small \{ display: block/);
  assert.doesNotMatch(css, /\.macro-summary-pillars small \{ display: block/);
  const narrowStart = css.lastIndexOf("@media (max-width: 720px)");
  const medium = css.slice(css.indexOf("@media (max-width: 1100px)"), narrowStart);
  const narrow = css.slice(narrowStart);
  assert.match(medium, /\.macro-summary-pillars \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(narrow, /\.macro-summary-score-grid, \.macro-summary-pillars \{ grid-template-columns: 1fr; \}/);
  assert.match(narrow, /\.macro-summary-meta \{ justify-content: flex-start; \}/);
});

test("moves overview details to records and standards without duplicating scoring or dropping evidence", async () => {
  const rating = await readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
  const standards = rating.slice(rating.indexOf("export function MacroRatingIndicators("), rating.indexOf("export function MacroRatingSummary()"));
  const summary = rating.slice(rating.indexOf("export function MacroRatingSummary()"), rating.indexOf("export function MacroRatingHistory()"));
  const archive = rating.slice(rating.indexOf("export function MacroRatingHistory()"));
  const currentReview = rating.slice(rating.indexOf("function MacroCurrentReviewDetails()"), rating.indexOf("function MacroRatingMethodDetails()"));
  const methods = rating.slice(rating.indexOf("function MacroRatingMethodDetails()"), rating.indexOf("export function MacroRatingWorkbook()"));
  assert.match(archive, /<details className="macro-rating-help"><summary>本期观察、来源与局限<\/summary><MacroCurrentReviewDetails \/><\/details>/);
  assert.match(archive, /<details className="macro-rating-help"><summary>同截止日的版本比较<\/summary>/);
  for (const field of ["currentDetails.reviewSummary", "currentDetails.sourceStatus", "currentDetails.evidenceLimitations", "currentDetails.gaps"]) assert.ok(currentReview.includes(field), field);
  assert.match(currentReview, /本期宏观观察 · \{current\.asOf[^}]*\} · \{framework\.version\}/);
  assert.match(currentReview, /<MacroResearchAssessment assessment=/);
  assert.match(standards, /<details className="macro-rating-help"><summary>评级方法、发布门槛与适用范围<\/summary><MacroRatingMethodDetails \/><\/details>/);
  for (const value of ["framework.purpose", "macroRatingTimelinessNote", "macroRatingScopeNote", "100% 权重核验后才发布正式总分和档位", "总覆盖至少 85%、每支柱至少 70%", "缺项不按中性分补齐"]) assert.ok(methods.includes(value), value);
  assert.match(standards, /<MacroPillarWeights pillar=\{pillar\} \/>/);
  assert.doesNotMatch(summary, /MacroCurrentReviewDetails|MacroRatingMethodDetails|MacroPolicyMethod|MacroPillarWeights|currentDetails\.(?:reviewSummary|sourceStatus|evidenceLimitations|gaps)/);
  assert.doesNotMatch(archive, /<MacroRatingMethodDetails \/>|<MacroPillarWeights/);
  assert.doesNotMatch(standards, /<MacroCurrentReviewDetails \/>/);
  // The moved disclosure helpers only read the existing results/evidence;
  // they must not independently evaluate, rescore, or append a snapshot.
  assert.doesNotMatch(currentReview + methods, /evaluateMacroRating\(|evaluateMacroResearchRating\(|scoreIndicator\(|\.push\(|writeFile/);
});

test("uses compact macro-chart guidance and keeps full statistical instructions available", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /<MacroChartHeader kicker="MACRO ATLAS" title="宏观图谱"/);
  assert.match(source, /按维度查看趋势，点按图表查看各期读数/);
  assert.match(source, /最新读数显示在图表右上角；不同统计期与口径分开观察/);
  assert.match(source, /<details className="macro-chart-help"><summary>图表口径与操作说明<\/summary><p>\{intrayear\.note\}<\/p>/);
  assert.match(source, /<details className="macro-chart-help"><summary>年度比较口径<\/summary><p>\{advisory\.macroHistory\.note\}<\/p>/);
  assert.match(source, /aria-pressed=\{item === group\}/);
  assert.match(source, /className="research-stack macro-research"/);
  assert.match(css, /\.macro-research > \.research-subtabs \{[^}]*width: fit-content;[^}]*flex-wrap: wrap/);
  assert.match(css, /\.macro-chart-guide, \.macro-rating-guide \{[^}]*min-width: 0;[^}]*text-align: left/);
  assert.match(css, /\.macro-chart-header, \.macro-rating-page-header \{ flex-direction: column/);
  assert.match(css, /\.macro-research > \.research-subtabs, \.macro-rating-sheets \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("centers PMI charts on 50 and consumer confidence on 100", async () => {
  const source = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function IntrayearChart(");
  const end = source.indexOf("function IndustrialLineChart(", start);
  const chart = source.slice(start, end);
  assert.match(chart, /metric === "消费者信心指数" \? 100 : metric\.includes\("PMI"\) \? 50 : null/);
  assert.match(chart, /benchmark - halfRange/);
  assert.match(chart, /benchmark \+ halfRange/);
  assert.match(chart, /benchmark === null \? \[low, \(low \+ high\) \/ 2, high\] : \[low, benchmark, high\]/);
});

test("shows a sourced macro overview paragraph rather than a slogan", async () => {
  const [source, advisory] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(source, /当前宏观简评/);
  assert.match(source, /macroBrief\.summary/);
  assert.ok(advisory.macroBrief.summary.length >= 100 && advisory.macroBrief.summary.length <= 200);
  assert.match(advisory.macroBrief.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(advisory.macroBrief.sources.every((item) => /^https:\/\/(www\.stats\.gov\.cn|www\.pbc\.gov\.cn)\//.test(item.url)));
});

test("places the sourced core-meeting tracker beside macro regulation", async () => {
  const [dashboard, component, raw, original, rollingOriginal, updatesOriginal, css] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/CoreMeetingTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/core-meetings.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/core-meetings-workbook.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/core-meeting-rolling-analysis.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/core-meeting-comparison-updates.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const tracker = JSON.parse(raw);
  const workbook = JSON.parse(original);
  const rolling = JSON.parse(rollingOriginal);
  const updates = JSON.parse(updatesOriginal);
  assert.match(dashboard, /"宏观调控", "核心会议"/);
  assert.match(dashboard, /<CoreMeetingTracker \/>/);
  assert.deepEqual(tracker.meetings.map((meeting) => meeting.name), ["五年规划", "中央经济工作会议", "全国两会", "中央政治局会议", "中央金融工作会议", "杰克逊霍尔年会"]);
  for (const meeting of tracker.meetings) {
    assert.match(meeting.latest.sourceUrl, /^https:\/\//);
    assert.match(meeting.latest.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(meeting.latest.facts.length >= 1);
    assert.ok(meeting.latest.followUp.length >= 1);
  }
  for (const label of ["官方事实", "政策信号", "投资传导", "跨年对比矩阵"]) assert.match(component, new RegExp(label));
  assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), ["使用说明", "总览", "五年规划", "中央经济工作会议", "全国两会", "中央政治局会议", "中央金融工作会议", "杰克逊霍尔年会", "跨年对比矩阵"]);
  assert.deepEqual(workbook.sheets.map((sheet) => sheet.grid.length), [23, 27, 20, 28, 42, 24, 18, 15, 14]);
  for (const sheet of workbook.sheets) assert.ok(sheet.grid.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string")));
  for (const name of ["五年规划", "中央经济工作会议", "全国两会", "中央政治局会议", "中央金融工作会议", "杰克逊霍尔年会"]) {
    const cells = workbook.sheets.find((sheet) => sheet.name === name).grid.flat();
    assert.ok(cells.some((cell) => cell.includes("投研映射")));
    assert.ok(cells.some((cell) => cell.includes("演进趋势") || cell.includes("变化趋势")));
  }
  assert.match(component, /<OriginalSheet sheet=\{selectedSheet\}/);
  assert.match(component, /<MeetingOverview sheet=\{selectedSheet\}/);
  assert.match(component, /政策层级与会议衔接/);
  assert.match(component, /chosen\.length < 2/);
  assert.match(component, /酒红色重点仅帮助阅读，不代表内容已核验/);
  assert.equal(workbook.sheets.find((sheet) => sheet.name === "总览").grid.slice(10).filter((row) => row[0]?.trim()).length, 12);
  assert.match(component, /最近三次对照依据用户原稿整理/);
  assert.match(component, /const recentIndices = periodIndices\.sort\([^;]+\)\.slice\(-3\)/);
  assert.match(component, /appendVerifiedComparisons\(sheet\)/);
  assert.ok(updates.updates && typeof updates.updates === "object");
  for (const entries of Object.values(updates.updates)) {
    assert.ok(Array.isArray(entries));
    for (const entry of entries) {
      assert.match(entry.sourceUrl, /^https:\/\//);
      assert.ok(entry.header);
      assert.ok([entry.cells, entry.trends, entry.mappings].every(Array.isArray));
    }
  }
  assert.match(component, /sheet\.grid\.slice\(headerRow\)\.some\(\(row\) => Boolean\(row\[index\]\?\.trim\(\)\)\)/);
  assert.deepEqual(rolling.fiveYear.periods, ["十三五（2016-2020）", "十四五（2021-2025）", "十五五（2026-2030）"]);
  assert.equal(rolling.fiveYear.rows.length, 16);
  assert.ok(rolling.fiveYear.rows.every((row) => row.trend && row.mapping && !/十二五/.test(row.trend + row.mapping)));
  assert.match(css, /\.core-meetings-layout \{ display: grid; gap: 13px; min-width: 0; \}/);
  assert.match(css, /\.core-meetings-nav \{ display: flex;[^}]*overflow-x: auto/);
  assert.doesNotMatch(css, /\.core-meetings-layout \{[^}]*grid-template-columns/);
  assert.match(css, /\.core-workbook-table td:first-child \{[^}]*text-align: center; vertical-align: middle/);
  assert.match(css, /\.core-workbook-table \.core-workbook-label-row td \{[^}]*text-align: center; vertical-align: middle/);
  assert.match(component, /const columnCount = Math\.max\(1, \.\.\.displaySheet\.grid\.map\(\(row\) => row\.length\)\)/);
  assert.match(component, /<colgroup>/);
  assert.match(css, /\.core-workbook-table \{ width: 100%;[^}]*table-layout: fixed/);
  assert.doesNotMatch(css, /\.core-workbook-scroll \{[^}]*max-height/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.core-workbook-table \{ min-width: 900px; \}/);
  assert.match(css, /\.core-overview-layer-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.core-meetings-focus \{[^}]*color: var\(--teal\); font-weight: 800/);
});

test("tracks industry policy and institution building as sourced theme timelines", async () => {
  const [dashboard, component, tracker] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PolicyTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-policy-tracker.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(dashboard, /<PolicyTracker \/>/);
  assert.match(component, /最新动态|后续验证|投资传导|查看官方原文/);
  assert.deepEqual(new Set(tracker.topics.map((topic) => topic.category)), new Set(["产业政策", "制度建设"]));
  assert.equal(tracker.topics.filter((topic) => topic.category === "产业政策").length, 15);
  assert.equal(tracker.topics.filter((topic) => topic.category === "制度建设").length, 15);
  assert.deepEqual(tracker.taxonomy["产业政策"], ["增量成长", "供给侧改革", "传统升级", "基础供给与内需"]);
  assert.deepEqual(tracker.taxonomy["制度建设"], ["市场基础制度", "要素与创新制度", "财税金融制度", "企业治理制度", "生态与民生制度", "开放与监管"]);
  assert.equal(tracker.topics.filter((topic) => topic.track === "生态与民生制度").length, 3);
  for (const id of ["resource-circularity", "carbon-market-institutions", "medical-payment-access", "pension-long-term-capital", "platform-competition-rules"]) {
    assert.ok(tracker.topics.some((topic) => topic.id === id));
  }
  assert.deepEqual(tracker.industryLenses.map((lens) => lens.title), ["资金与项目落地", "供给、价格与盈利", "标准、准入与竞争规则", "需求与商业兑现"]);
  assert.match(tracker.futureWatchlist.description, /量子科技.*6G/);
  assert.match(component, /跨主线核验/);
  assert.match(component, /futureWatchlist\.title/);
  assert.match(component, /activeTrack/);
  assert.match(component, /marketImpact/);
  for (const topic of tracker.topics) {
    assert.ok(topic.title && topic.phase && topic.focus && topic.observation);
    assert.ok(tracker.taxonomy[topic.category].includes(topic.track));
    assert.ok(topic.marketImpact.length >= 3);
    assert.ok(topic.events.length > 0);
    for (const event of topic.events) {
      assert.match(event.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(event.kind && event.agency && event.title);
      assert.match(event.url, /^https:\/\//);
    }
  }
});

test("removes the legacy provisional score from macro rating without recycling it into the current framework", async () => {
  const [source, ratingComponent, advisory] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const dimensions = advisory.macroFramework.pillars.map((pillar) => {
    const rows = advisory.macroIndicators.filter((item) => item.primary === pillar.name);
    const scored = rows.filter((item) => typeof item.score === "number");
    return { weight: Number.parseFloat(pillar.weight) / 100, score: scored.reduce((sum, item) => sum + item.score, 0) / scored.length, count: scored.length, total: rows.length };
  });
  const total = dimensions.reduce((sum, item) => sum + item.score * item.weight, 0);
  assert.equal(Number(total.toFixed(2)), 2.68);
  assert.equal(dimensions.reduce((sum, item) => sum + item.count, 0), 48);
  assert.equal(dimensions.reduce((sum, item) => sum + item.total, 0), 62);
  assert.doesNotMatch(source, /旧版综合初评（不同口径，仅供回溯）/);
  assert.doesNotMatch(source, /与新版 30\/30\/20\/20 规则不可直接比较/);
  assert.match(ratingComponent, /本期旧版分数不参与新评级/);
  assert.match(source, /macroRatingHeadline/);
  assert.doesNotMatch(source, /macroScorecard\.rating\.state/);
});

test("preserves all four rating sheets after removing only the original indicator library page", async () => {
  const [dashboard, rating] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /tab === "宏观评级" \? <section[^\n]*<MacroRatingWorkbook \/>/);
  assert.doesNotMatch(dashboard, /tab === "宏观指标"|宏观指标资料库/);
  assert.match(dashboard, /new Map\(advisory\.macroIndicators\.map/);
  assert.match(rating, /\["评分总览", "评分指标", "评分标准", "评分记录"\]/);
  assert.doesNotMatch(rating, /辅助观察/);
  for (const component of ["MacroRatingSummary", "MacroRatingInputs", "MacroRatingIndicators", "MacroRatingHistory"]) assert.match(rating, new RegExp(component));
});

test("exposes macro-policy conditions and trial limits in both rating inputs and standards", async () => {
  const rating = await readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
  assert.equal((rating.match(/<MacroPillarWeights pillar=\{pillar\} \/>/g) || []).length, 2);
  assert.equal((rating.match(/pillar === "宏观调控" \? <MacroPolicyMethod \/>/g) || []).length, 1);
  assert.match(rating, /summary\.count/);
  assert.match(rating, /formatTotalWeight\(summary\.weight\)/);
  assert.match(rating, /framework\.policyMethod\.highScore/);
  assert.match(rating, /framework\.policyMethod\.continuity/);
  assert.match(rating, /此链接不代表已录入本期数据/);
  assert.match(rating, /原文研判不是自动量化结果/);
  assert.match(rating, /并非跨资产回测最优值/);
  assert.match(rating, /支持加码不等于经济复苏/);
});

test("separates macro conditions and policy response while keeping evidence gates visible", async () => {
  const [rating, summary, framework] = await Promise.all([
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/macro-rating-summary.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(rating, /<h3>综合评级<\/h3>/);
  assert.match(rating, /基本面与信用/);
  assert.match(rating, /<h3>政策支持<\/h3>/);
  assert.match(rating, /政策高分不自动判定实际经济改善/);
  assert.match(rating, /macroRatingScopeNote/);
  assert.match(summary, /股票、债券、商品须分别分析/);
  assert.match(summary, /不由宏观总分直接生成买卖或仓位/);
  assert.match(rating, /macroRatingTimelinessNote/);
  assert.match(summary, /月度3个月、季度6个月/);
  assert.match(summary, /上限，并非承诺已取到最新发布/);
  assert.match(rating, /<MacroRuleRequirements item=\{item\} \/>/);
  assert.match(rating, /item\.definition/);
  assert.match(rating, /item\.requirements/);
  assert.match(rating, /录入与核验要求/);
  assert.match(rating, /新指标独立编号，不继承旧指标数值/);
  assert.doesNotMatch(rating, /辅助观察|7天逆回购利率与 DR007/);
  assert.ok(framework.ratingBands.every((band) => !/复苏|改善|下行/.test(band.label)));
});

test("links every scoring indicator to its matching standard and shows shared basis and threshold status", async () => {
  const [rating, framework] = await Promise.all([
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(rating, /setSelectedRuleId\(ruleId\)/);
  assert.match(rating, /setSheet\("评分标准"\)/);
  assert.match(rating, /onViewStandard\(item\.id\)/);
  assert.match(rating, /查看评分标准/);
  assert.match(rating, /selectedRuleId=\{selectedRuleId\}/);
  assert.match(rating, /framework\.indicators\.find\(\(item\) => item\.id === selectedRuleId\)\?\.pillar/);
  assert.match(rating, /id=\{`macro-rule-\$\{item\.id\}`\}/);
  assert.match(rating, /selected\.open = true/);
  assert.match(rating, /selected\.scrollIntoView/);
  assert.match(rating, /<MacroRuleBasis item=\{item\} \/>/);
  assert.match(rating, /item\.scoringBasis/);
  assert.match(rating, /item\.thresholdStatus/);
  assert.match(rating, /评分依据/);
  assert.match(rating, /阈值状态/);
  assert.match(rating, /与“评分指标”共享同一套规则/);
  assert.match(rating, /网页暂不提供直接写入/);
  for (const rule of framework.indicators) {
    assert.ok(typeof rule.scoringBasis === "string" && rule.scoringBasis.trim(), rule.id);
    assert.ok(typeof rule.thresholdStatus === "string" && rule.thresholdStatus.trim(), rule.id);
  }
});

test("all 38 standards link their scoring basis, five grades and nonempty recording requirements to one rule", async () => {
  const [rating, framework] = await Promise.all([
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(framework.indicators.length, 38);
  for (const rule of framework.indicators) {
    assert.ok(Array.isArray(rule.requirements) && rule.requirements.length > 0, `${rule.id}: recording requirements`);
    assert.ok(rule.requirements.every((entry) => typeof entry === "string" && entry.trim()), `${rule.id}: nonempty requirement strings`);
    assert.ok(typeof rule.scoringBasis === "string" && rule.scoringBasis.trim(), `${rule.id}: scoring basis`);
    assert.ok(typeof rule.thresholdStatus === "string" && rule.thresholdStatus.trim(), `${rule.id}: threshold status`);
    assert.equal(rule.grades.length, 5, `${rule.id}: five grades`);
    assert.ok(rule.grades.every((grade) => typeof grade === "string" && grade.trim()), `${rule.id}: grade boundaries`);
  }
  const detailBody = rating.slice(rating.indexOf('<div className="macro-v1-details">'), rating.indexOf('</details>;', rating.indexOf('<div className="macro-v1-details">')));
  assert.match(detailBody, /<MacroRuleBasis item=\{item\} \/>/);
  assert.match(detailBody, /<MacroRuleRequirements item=\{item\} \/>/);
  assert.match(detailBody, /<MacroRuleScoring item=\{item\} observation=\{observation\} \/>/);
  assert.match(rating, /五档评分标准/);
  assert.match(rating, /item\.grades\.map/);
  assert.match(rating, /const requirements = "requirements" in item \? item\.requirements : undefined/);
  assert.match(rating, /displayRequirements\.join\("；"\)/);
  assert.match(rating, /if \(!displayRequirements\.length\) return null/);
});

test("the current workbook presents the 12-month RRR action rule and retains all scoring revisions", async () => {
  const [rating, framework, current, history] = await Promise.all([
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-rating-current.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-rating-history.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(framework.version, "V1.21");
  assert.equal(current.version, framework.version);
  assert.equal(framework.indicators.length, 38);
  const rule = framework.indicators.find((item) => item.id === "P02E");
  assert.equal(rule.weight, .005);
  assert.equal(rule.unit, "基点");
  assert.match(rule.name, /近12完整月普遍.*准备金率调整净累计/);
  assert.match(rule.definition, /亿元.*不能.*0基点/);
  assert.match(rule.scoringBasis, /0为3分/);
  assert.match(rule.thresholdStatus, /试行/);
  assert.ok(rule.requirements.some((item) => /rrrActionLedger\.monthlyChecks.*12期/.test(item)));
  assert.ok(rule.requirements.some((item) => /rrrActionLedger\.crossChecks/.test(item)));
  assert.equal(framework.indicators.some((item) => ["P01A", "P02B"].includes(item.id)), false);
  assert.equal(framework.researchAssessmentPolicy.enabled, false);
  assert.deepEqual(framework.researchAssessmentPolicy.allowedIndicators, []);
  assert.deepEqual(current.researchAssessments, {});
  assert.deepEqual(history.snapshots.map((item) => item.version), ["V1.18", "V1.19", "V1.20", "V1.21"]);
  assert.equal(history.snapshots[0].type, "正式评级");
  assert.equal(history.snapshots[0].coverage, 1);
  assert.equal(history.snapshots[0].research.count, 0);
  assert.deepEqual(history.snapshots[0].researchEvidence, {});
  assert.match(rating, /history\.snapshots/);
  assert.match(rating, /\{ratedCount\} \/ \{framework\.indicators\.length\} 项核验/);
  assert.match(rating, /item\.name/);
  assert.match(rating, /item\.requirements/);
  assert.doesNotMatch(rating, /macro-rating-history-before-v1-14|deliverables\//);
});

test("uses one responsive weight-summary format across every scoring pillar", async () => {
  const [rating, css] = await Promise.all([
    readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(rating, /summarizePillarWeights\(framework, pillar\)/);
  assert.match(rating, /formatTotalWeight\(group\.weight\)/);
  assert.match(rating, /不是组内百分比/);
  assert.match(css, /\.macro-v1-weight-groups \{[^}]*repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
  assert.match(css, /max-width: 720px[^\n]*macro-v1-weight-groups[^\n]*repeat\(2/);
  assert.match(css, /max-width: 420px[^\n]*macro-v1-weight-groups[^\n]*minmax\(0, 1fr\)/);
});

test("groups finance credit and keeps each source-backed frequency separate", async () => {
  const [source, credit, social, money, leverage, advisory] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-finance-credit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-social-financing.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-money-supply.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-leverage.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  for (const label of ["信贷结构", "社会融资", "货币供给", "FinanceCreditCharts", "SocialFinancingCharts", "MoneySupplyCards"]) assert.match(source, new RegExp(label));
  assert.equal(credit.rows.length, 44);
  assert.equal(credit.rows[0].period, "2023-01");
  assert.equal(credit.rows.at(-1).period, "2026-08");
  for (const row of credit.rows) {
    assert.match(row.url, /^https:\/\/www\.pbc\.gov\.cn\//);
    for (const field of ["householdShort", "householdLong", "enterpriseShort", "enterpriseLong"]) assert.ok(Number.isFinite(row[field]) && Number.isFinite(row[`${field}Ytd`]));
    const index = credit.rows.indexOf(row);
    const previous = index > 0 && credit.rows[index - 1].period.slice(0, 4) === row.period.slice(0, 4) ? credit.rows[index - 1] : null;
    for (const field of ["householdShort", "householdLong", "enterpriseShort", "enterpriseLong"]) assert.equal(row[field], row[`${field}Ytd`] - (previous?.[`${field}Ytd`] ?? 0));
  }
  assert.equal(social.rows.length, 109);
  assert.equal(social.rows[0].period, "2017-01");
  assert.deepEqual(social.rows.at(-1), { period: "2026-08", total: 7.2, rmbLoan: 5.0, sourceUrl: "https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/2026091414593871200/index.html" });
  assert.ok(social.rows.every((row) => Number.isFinite(row.total) && Number.isFinite(row.rmbLoan) && /^https:\/\/www\.pbc\.gov\.cn\//.test(row.sourceUrl)));
  assert.match(social.basis, /缺口/);
  assert.equal(social.flowComponents.provider, "Wind EDB");
  assert.deepEqual([social.flowComponents.governmentBondCode, social.flowComponents.rmbLoanCode], ["M6179492", "M5206731"]);
  assert.equal(social.flowComponents.rows.length, 8);
  assert.deepEqual(social.flowComponents.rows.at(-1), { period: "2026-08", governmentBond: 10097, rmbLoan: 552 });
  assert.equal(social.flowComponents.rows.reduce((sum, row) => sum + row.governmentBond, 0), 87669);
  assert.equal(social.flowComponents.rows.reduce((sum, row) => sum + row.rmbLoan, 0), 102261);
  assert.match(source, /社会融资规模当月增量/);
  assert.equal(social.monthlyIncrement.coverageStart, "2020-01");
  assert.equal(social.monthlyIncrement.coverageEnd, "2026-04");
  assert.equal(social.monthlyIncrement.rows.length, 76);
  assert.equal(money.rows.length, 116);
  assert.equal(money.rows[0].period, "2017-01");
  assert.deepEqual([money.rows.at(-1).m0, money.rows.at(-1).m1, money.rows.at(-1).m2, money.rows.at(-1).scissors], [11.2, 4.1, 7.5, -3.4]);
  assert.equal(new Set(money.rows.map((row) => row.period)).size, money.rows.length);
  assert.match(source, /const displayRows = rows\.filter\(\(row\) => row\.period >= "2024-01"\)/);
  assert.match(source, /2024年1月以来/);
  assert.match(source, /M1－M2 剪刀差/);
  assert.doesNotMatch(source, /finance-money-latest/);
  assert.match(source, /const chinaLatest = latestBySeries\[0\]/);
  assert.match(source, /M0 \{latest\.m0\.toFixed\(1\)\}%/);
  assert.doesNotMatch(source, /<strong>最新数据<\/strong>/);
  assert.match(source, /M1采用央行新口径及其回溯可比序列/);
  assert.match(source, /unit=" 个百分点" axisMode="zero-centered"/);
  assert.match(source, /全社会杠杆率（不含金融）/);
  assert.match(source, /row\.corporate \+ row\.household \+ row\.government/);
  assert.match(source, /start: "2014-Q2", end: "2026-Q1"/);
  assert.equal(leverage.china.at(-1).period, "2026-Q2");
  assert.equal(leverage.china.at(-1).corporate, 179.5);
  assert.equal(leverage.china.at(-1).household, 57.7);
  for (const entry of Object.values(leverage.bis)) {
    assert.equal(entry.rows.at(-1).period, "2026-Q1");
    assert.match(entry.url, /^https:\/\/stats\.bis\.org\//);
  }
  const indicator = (id) => advisory.macroIndicators.find((item) => item.id === id);
  assert.equal(indicator("M49").secondary, "社会融资");
  assert.equal(indicator("M53").secondary, "货币供给");
});

test("groups macro regulation into sourced monetary and fiscal charts", async () => {
  const [source, advisory, policy] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-policy.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  for (const name of ["宏观调控", "货币政策", "财政政策", "MacroPolicyCharts"]) assert.match(source, new RegExp(name));
  assert.ok(advisory.macroPillars.some((item) => item.name === "宏观调控"));
  assert.ok(policy.lpr.rows.length >= 80);
  assert.equal(policy.bond.rows.length, 129);
  assert.equal(policy.fiscal.rows.length, 18);
  assert.equal(policy.fiscal.rows[0].period, "2025-02");
  assert.equal(policy.fiscal.rows.at(-1).period, "2026-08");
  assert.equal(policy.fiscal.rows.at(-1).income, 5.7);
  assert.equal(policy.fiscal.rows.at(-1).expense, 1.2);
  assert.deepEqual(policy.fundingRate.rows.map((row) => row.dr007), [1.51, 1.49, 1.44, 1.35, 1.35, 1.45, 1.43, 1.40]);
  assert.ok(policy.fundingRate.rows.every((row) => row.policyRate === 1.4));
  assert.deepEqual([policy.fundingRate.dr007Code, policy.fundingRate.policyRateCode], ["R0633988", "M0041371"]);
  assert.doesNotMatch(source, /7天逆回购利率与 DR007/);
  assert.deepEqual(policy.specialBondIssuance.rows.map((row) => row.amount), [8242, 11599, 13343, 14951, 20667, 24080, 29293]);
  assert.ok(policy.specialBondIssuance.rows.every((row) => row.url.startsWith("https://zwgls.mof.gov.cn/")));
  assert.match(source, /新增地方专项债发行/);
  assert.match(policy.specialBondIssuance.basis, /发行不等于资金已支出/);
  assert.equal(policy.deficitTarget.rows.at(-1).target, 4.0);
  assert.ok(policy.imfDeficit.rows.some((row) => row.year === 2026));
  assert.match(policy.mlfNote.text, /多重价位中标/);
});

test("publishes dated, source-backed advisory content", async () => {
  const data = JSON.parse(await readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8"));
  assert.match(data.dataThrough, /\d{4}-\d{2}-\d{2}/);
  assert.equal(data.macroPillars.length, 4);
  assert.equal(data.macroIndicators.length, 62);
  assert.equal(data.macroFramework.totalIndicators, 62);
  assert.equal(data.macroFramework.verifiedIndicators, 62);
  assert.ok(data.macroIndicators.every((item) => item.status === "已核验"));
  assert.ok(data.macroIndicators.every((item) => !["M01", "M30", "M32", "M59", "M67"].includes(item.id)));
  const indicator = (id) => data.macroIndicators.find((item) => item.id === id);
  assert.equal(indicator("M02").currentValue, "4.3%");
  assert.match(indicator("M02").period, /Q2（单季同比）/);
  assert.equal(indicator("M04").currentValue, "约1.5%");
  assert.match(indicator("M04").period, /单季同比，推算/);
  assert.equal(indicator("M22").currentValue, "17.6%");
  assert.equal(indicator("M22").period, "2026年1—7月累计");
  assert.equal(indicator("M27").period, "2026年1—8月累计");
  assert.equal(indicator("M49").period, "2026-08（月末）");
  assert.equal(indicator("M60").period, "2026-09-20");
  assert.ok(data.macroIndicators.some((item) => item.scoreRules?.score5));
  assert.deepEqual(data.macroHistory.periods, ["2022", "2023", "2024", "2025"]);
  assert.equal(data.macroHistory.series.length, 12);
  assert.ok(data.macroHistory.series.every((item) => item.values.length === 4 && item.values.every(Number.isFinite)));
  assert.ok(data.macroHistory.series.every((item) => !item.latestIndicatorId || indicator(item.latestIndicatorId)));
  assert.ok(data.macroHistory.annualSources.every((source) => source.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.macroHistory.series.some((item) => item.metric === "社融存量增速" && item.latestIndicatorId === "M49"));
  assert.ok(data.macroHistory.series.some((item) => item.metric === "新建商品房销售面积" && item.latestIndicatorId === "M26"));
  assert.ok(data.macroHistory.series.every((item) => ["经济运行", "增长动力", "金融信贷", "宏观调控"].includes(item.group)));
  assert.ok(data.macroHistory.series.every((item) => !item.latestIndicatorId || item.group === indicator(item.latestIndicatorId).primary));
  assert.ok(data.macroHistory.leadingSignals.some((item) => item.label === "制造业 PMI 新订单"));
  assert.ok(data.assetViews.length >= 8);
  assert.ok(data.assetScorecards.length >= 8);
  assert.equal(data.memoEvolution.length, 3);
  assert.deepEqual(data.memoEvolution.map((item) => item.period), ["2025 Q3", "2025 Q4", "2026 中期"]);
  assert.ok(data.equityValuations.some((item) => item.name === "中证A500"));
  assert.ok(data.styleValuations.some((item) => item.style === "红利"));
  assert.ok(data.industries.some((item) => item.name === "信息技术" && Number.isFinite(item.profitGrowth)));
  assert.ok(data.regionalIndicators.some((item) => item.region === "日本"));
  assert.ok(data.regionalIndicators.some((item) => item.region === "韩国"));
  assert.equal(data.productRatingModels.length, 3);
  assert.ok(data.etfCandidates.every((item) => item.score === null));
  assert.equal(data.privateStrategyMatrix.length, 11);
  assert.ok(data.policyMeetings.every((item) => item.url.startsWith("https://")));
});

test("puts verified within-year macro paths before annual context", async () => {
  const [source, data, advisory] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-intrayear.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(source, /<MacroChartHeader kicker="MACRO ATLAS" title="宏观图谱"/);
  assert.match(source, /history-annual-details/);
  assert.match(source, /<IntrayearChart/);
  assert.match(source, /onPointerMove=.*nearestIndex/);
  assert.match(source, /onClick=.*setSelectedIndex/);
  assert.match(source, /intrayear-tooltip/);
  assert.equal(data.series.length, 27);
  assert.ok(data.series.every((item) => item.periods.length === item.values.length && item.values.length >= (item.metric === "GDP 平减指数" ? 2 : 6)));
  assert.ok(data.series.every((item) => item.values.every(Number.isFinite)));
  const gdp = data.series.find((item) => item.metric === "GDP 单季实际增速");
  assert.equal(gdp.values.at(-1), 4.3);
  assert.equal(gdp.alternate.label, "单季实际环比");
  assert.deepEqual(gdp.alternate.periods, gdp.periods);
  assert.deepEqual(gdp.alternate.values, [1.1, 1.2, 1.1, 1.1, 1.3, 0.9]);
  assert.notEqual(gdp.alternate.breakOnYearChange, true);
  assert.equal(data.gdpQuarterlySources.length, 1);
  assert.equal(data.gdpQuarterlySources[0].url, gdp.alternate.url);
  assert.deepEqual(data.series.find((item) => item.metric === "规模以上工业增加值").periods.slice(0, 2), ["1—2月", "3月"]);
  assert.equal(data.series.find((item) => item.metric === "规模以上工业企业利润").periods.at(-1), "1—7月");
  assert.deepEqual(data.series.find((item) => item.metric === "核心 CPI").values, [0.8, 1.8, 1.1, 1.2, 1.1, 1.0, 0.9, 1.0]);
  const cpi = data.series.find((item) => item.metric === "CPI");
  const ppi = data.series.find((item) => item.metric === "PPI");
  const coreCpi = data.series.find((item) => item.metric === "核心 CPI");
  assert.deepEqual(cpi.alternate.values, [0.2, 1.0, -0.7, 0.3, -0.1, -0.3, -0.1, 0.4]);
  assert.deepEqual(ppi.alternate.values, [0.4, 0.4, 1.0, 1.7, 0.5, -0.3, -0.7, 0.4]);
  assert.deepEqual(coreCpi.alternate.values, [0.3, 0.7, -0.7, 0.2, -0.1, -0.1, 0.3, 0.1]);
  assert.deepEqual([cpi, ppi, coreCpi].map((item) => item.cumulativeLatest.value), [0.9, 2.0, 1.1]);
  assert.ok([cpi, ppi, coreCpi].every((item) => item.alternate.periods.length === item.alternate.values.length));
  assert.equal(data.priceSources.length, 8);
  const priceGap = data.series.find((item) => item.metric === "PPI－CPI 剪刀差");
  assert.deepEqual(priceGap.periods, cpi.periods);
  assert.deepEqual(priceGap.periods, ppi.periods);
  assert.deepEqual(priceGap.values, ppi.values.map((value, index) => Number((value - cpi.values[index]).toFixed(1))));
  assert.equal(priceGap.unit, "个百分点");
  assert.deepEqual(priceGap.derivedFrom, ["PPI", "CPI"]);
  assert.match(source, /"CPI", "PPI", "核心 CPI", "PPI－CPI 剪刀差"/);
  assert.deepEqual(data.series.find((item) => item.metric === "民间固定资产投资").values, [-2.6, -2.2, -5.2, -7.1, -8.5, -9.4, -10.1]);
  assert.deepEqual(data.series.find((item) => item.metric === "制造业投资").values, [3.1, 4.1, 1.2, -0.4, -1.2, -1.7, -2.3]);
  assert.deepEqual(data.series.find((item) => item.metric === "基础设施投资").values, [11.4, 8.9, 4.3, 0.6, -2.4, -3.6, -4.0]);
  assert.equal(data.investmentStructureSources.length, 7);
  assert.ok(data.investmentStructureSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.deepEqual(data.series.find((item) => item.metric === "服务零售额").values, [5.6, 5.5, 5.6, 5.4, 5.3, 5.0, 4.9]);
  assert.equal(data.series.find((item) => item.metric === "服务零售额").sourceUrls.length, 7);
  assert.deepEqual(data.series.find((item) => item.metric === "制造业 PMI 新订单").values, [49.2, 48.6, 51.6, 50.6, 49.9, 51.2, 48.5, 50.6]);
  assert.equal(data.series.find((item) => item.metric === "制造业 PMI 新订单").group, "增长动力");
  assert.equal(data.series.find((item) => item.metric === "制造业 PMI 新订单").subgroup, "工业生产");
  assert.equal(data.nonManufacturingPmiSources.length, 8);
  assert.ok(data.nonManufacturingPmiSources.at(-1).url.startsWith("https://www.stats.gov.cn/"));
  assert.match(source, /服务零售按年初累计同比/);
  assert.deepEqual(data.series.find((item) => item.metric === "社融存量增速").values, [8.2, 8.2, 7.9, 7.8, 7.7, 7.4, 7.4, 7.2]);
  assert.deepEqual(data.series.find((item) => item.metric === "GDP 平减指数").values, [-0.1, 1.5]);
  assert.deepEqual(data.series.find((item) => item.metric === "GDP 平减指数").alternate.values, [-0.1, 0.7]);
  assert.match(source, /aria-label=\{`\$\{displayMetric\}统计口径`\}/);
  assert.match(source, /\{alternateLabel\}<\/button>/);
  assert.match(source, /breakOnYearChange/);
  assert.match(source, /chartRight = 550/);
  const economic = data.series.filter((item) => item.group === "经济运行");
  assert.deepEqual([...new Set(economic.map((item) => item.subgroup))].sort(), ["经济增长", "物价水平", "国际收支", "景气指数", "就业市场"].sort());
  assert.equal(economic.find((item) => item.metric === "GDP 平减指数").subgroup, "经济增长");
  assert.equal(economic.find((item) => item.metric === "非制造业 PMI").subgroup, "景气指数");
  assert.equal(economic.find((item) => item.metric === "外汇储备").subgroup, "国际收支");
  const compositePmi = economic.find((item) => item.metric === "综合 PMI 产出指数");
  assert.deepEqual(compositePmi.values, [49.8, 49.5, 50.5, 50.1, 50.5, 50.6, 49.3, 49.5]);
  assert.equal(compositePmi.subgroup, "景气指数");
  assert.equal(compositePmi.values.at(-1).toFixed(1), advisory.macroIndicators.find((item) => item.id === "M18").currentValue);
  const consumerConfidence = economic.find((item) => item.metric === "消费者信心指数");
  // Jan–Jul from Wind history; Aug+ appended from Caixin 5198401 (original source NBS).
  assert.deepEqual(consumerConfidence.periods.slice(0, 7), ["1月", "2月", "3月", "4月", "5月", "6月", "7月"]);
  assert.deepEqual(consumerConfidence.values.slice(0, 7), [90.6, 91.6, 90, 89, 89.9, 89.4, 89.2]);
  assert.equal(consumerConfidence.subgroup, "景气指数");
  assert.equal(consumerConfidence.unit, "点");
  assert.equal(consumerConfidence.values.at(-1).toFixed(1), advisory.macroIndicators.find((item) => item.id === "M20").currentValue);
  assert.match(consumerConfidence.source, /Wind EDB M0012303|财新|5198401/);
  assert.match(source, /metric === "消费者信心指数" \? 100 : metric.includes\("PMI"\) \? 50/);
  assert.match(source, /按五类查看/);
  assert.deepEqual(data.series.find((item) => item.metric === "非制造业 PMI").values, [49.4, 49.5, 50.1, 49.4, 50.1, 50.2, 49.0, 49.0]);
  assert.deepEqual(data.series.find((item) => item.metric === "外汇储备").values, [33991, 34278, 33421, 34105, 34422, 34163, 34188, 34383]);
  assert.equal(data.reserveHistory.periods.length, 57);
  assert.equal(data.reserveHistory.values.length, 57);
  assert.equal(data.reserveHistory.periods[0], "2022-01");
  assert.equal(data.reserveHistory.periods[12], "2023-01");
  assert.equal(data.reserveHistory.periods[23], "2023-12");
  assert.equal(data.reserveHistory.periods.at(-1), "2026-09");
  assert.equal(data.reserveHistory.values.at(-1), 34002.51);
  assert.equal(data.reserveHistory.sources.length, 5);
  assert.match(source, /2022 年以来 · 月末存量/);
  assert.deepEqual(data.series.find((item) => item.metric === "国际收支货物贸易差额").values, [1004, 703, 678, 741, 859, 1188, 1103]);
  assert.deepEqual(data.series.find((item) => item.metric === "国际收支服务贸易差额").values, [-176, -184, -243, -148, -180, -193, -191]);
  assert.deepEqual(data.tradeTotal.values, [828, 519, 434, 593, 679, 995, 912]);
  assert.deepEqual(data.tradeTotal.periods, data.series.find((item) => item.metric === "国际收支货物贸易差额").periods);
  assert.equal(data.tradeSources.length, data.tradeTotal.values.length);
  assert.ok(data.tradeTotal.values.every((value, index) => Math.abs(value - data.series.find((item) => item.metric === "国际收支货物贸易差额").values[index] - data.series.find((item) => item.metric === "国际收支服务贸易差额").values[index]) <= 1));
  assert.equal(data.tradeQuarterly.periods.length, 34);
  assert.equal(data.tradeQuarterly.values.length, 34);
  assert.equal(data.tradeQuarterly.periods[0], "2018-Q1");
  assert.equal(data.tradeQuarterly.periods.at(-1), "2026-Q2");
  assert.equal(data.tradeQuarterly.values.at(-1), 2233.9);
  assert.equal(data.tradeQuarterly.goodsValues.length, 34);
  assert.equal(data.tradeQuarterly.servicesValues.length, 34);
  assert.equal(data.tradeQuarterly.goodsValues[0], 486);
  assert.equal(data.tradeQuarterly.servicesValues[0], -735.5);
  assert.equal(Number((data.tradeQuarterly.goodsValues[33] + data.tradeQuarterly.servicesValues[33]).toFixed(1)), data.tradeQuarterly.values[33]);
  assert.match(data.tradeQuarterly.source, /季度BOP（美元）/);
  assert.match(source, /国际收支贸易差额频率/);
  const tradeChart = source.slice(source.indexOf("function ExternalBalanceChart("), source.indexOf("function MacroHistoryView(", source.indexOf("function ExternalBalanceChart(")));
  assert.match(tradeChart, /const left = 90/);
  assert.match(tradeChart, /x=\{left - 30\}/);
  assert.doesNotMatch(source, /BusinessExpectationsChart|企业预期指数/);
  assert.equal("businessExpectations" in data, false);
  assert.match(source, /setView\("quarterly"\)/);
  assert.doesNotMatch(source, /季度辅助趋势/);
  assert.equal(data.series.filter((item) => item.section === "外部收支").length, 3);
  assert.match(source, /国际收支观察：外储与贸易差额/);
  assert.match(source, /className="intrayear-more intrayear-external" open/);
  assert.match(source, /<ExternalBalanceChart goods=\{goods\} services=\{services\}/);
  assert.match(source, /external-balance-chart/);
  const growth = data.series.filter((item) => item.group === "增长动力");
  assert.deepEqual([...new Set(growth.map((item) => item.subgroup))].sort(), ["投资", "消费", "工业生产", "房地产"].sort());
  assert.ok(growth.every((item) => item.subgroup));
  assert.ok(!growth.some((item) => item.metric === "货物进出口总额"));
  assert.match(source, /<GoodsTradeCards/);
  assert.match(source, /<ConsumerCategoryChart/);
  assert.deepEqual(data.consumerCategoryRows.map((row) => row.period), ["1—2月", "3月", "4月", "5月", "6月", "7月", "8月"]);
  assert.deepEqual(data.consumerCategoryRows.slice(-1).map((row) => [row.autoAmount, row.autoYoy, row.autoCumulativeYoy, row.applianceAmount, row.applianceYoy, row.applianceCumulativeYoy]), [[3279, -18.5, -13.9, 858, 2.3, -5.6]]);
  assert.equal(data.consumerCategorySources.length, data.consumerCategoryRows.length);
  assert.ok(data.consumerCategorySources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.match(source, /名义同比，未扣除价格因素；首期为 1—2 月合并发布/);
  assert.match(source, /累计同比只作辅助读数，不与当月同比混画/);
  assert.match(source, /<PopulationStructureChart/);
  assert.match(source, /<InwardFdiChart/);
  for (const [metric, indicatorId] of [["核心 CPI", "M07"], ["民间固定资产投资", "M38"], ["社融存量增速", "M49"]]) {
    const latest = data.series.find((item) => item.metric === metric).values.at(-1);
    assert.equal(`${latest.toFixed(1)}%`, advisory.macroIndicators.find((item) => item.id === indicatorId).currentValue);
  }
  assert.deepEqual([...new Set(data.series.map((item) => item.group))].sort(), ["经济运行", "增长动力", "金融信贷", "宏观调控"].sort());
  assert.match(source, /"经济运行", "增长动力", "金融信贷", "宏观调控"/);
  assert.doesNotMatch(source, /后续候选曲线/);
  assert.doesNotMatch(source, /当期领先观察/);
  assert.equal(data.series.find((item) => item.metric === "制造业 PMI").role, "领先观察");
  assert.equal(data.series.find((item) => item.metric === "规模以上工业企业利润").role, "滞后验证");
  assert.ok(data.activitySources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.fiscalSources.every((item) => item.url.includes("mof.gov.cn/")));
  assert.equal(data.coreCpiSources.length, 8);
  assert.equal(data.privateInvestmentSources.length, 7);
  assert.equal(data.creditSources.length, 8);
  assert.equal(data.deflatorSources.length, 3);
  assert.equal(data.nonManufacturingPmiSources.length, 8);
  assert.equal(data.reserveSources.length, 8);
  assert.equal(data.tradeSources.length, 7);
  assert.ok(data.nonManufacturingPmiSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.reserveSources.every((item) => item.url.startsWith("https://www.safe.gov.cn/")));
  assert.ok(data.tradeSources.every((item) => item.url.startsWith("https://www.safe.gov.cn/")));
  assert.ok(data.coreCpiSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.privateInvestmentSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.creditSources.every((item) => item.url.startsWith("https://www.pbc.gov.cn/")));
  assert.deepEqual(data.planned, []);
});

test("keeps population, inward FDI and four goods-trade views source-backed and separate", async () => {
  const data = JSON.parse(await readFile(new URL("../app/data/macro-additional.json", import.meta.url), "utf8"));
  const source = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.equal(data.population.rows.length, 36);
  assert.deepEqual(data.population.rows.map((row) => row[0]), Array.from({ length: 36 }, (_, index) => 1990 + index));
  assert.ok(data.population.rows.every((row) => Math.abs(row[1] + row[2] + row[3] - 100) <= 0.11));
  const counts = data.population.latestCountsWan;
  assert.equal(counts.age0to14 + counts.age15to64 + counts.age65plus, counts.total);
  assert.ok(data.population.rows.at(-1).slice(1).every((share, index) => Math.abs(share - [counts.age0to14, counts.age15to64, counts.age65plus][index] / counts.total * 100) < .001));
  assert.match(data.population.yearbookUrl, /^https:\/\/www\.stats\.gov\.cn\//);
  assert.match(source, /人口结构占比/);
  assert.match(source, /population\.rows\.filter\(\(item\) => item\[0\] >= 2015\)/);
  assert.match(source, /2015—2025 年末，按年龄组统计/);
  assert.deepEqual(data.demographics.rows.map((row) => row.year), Array.from({ length: 16 }, (_, index) => 2010 + index));
  assert.deepEqual(data.demographics.rows.at(-1) && [data.demographics.rows.at(-1).populationWan, data.demographics.rows.at(-1).naturalRatePermille, data.demographics.rows.at(-1).urbanizationRate], [140489, -2.41, 67.89]);
  assert.ok(data.demographics.rows.every((row) => row.url.startsWith("https://www.stats.gov.cn/") && row.urbanizationRate >= 49 && row.urbanizationRate < 70));
  assert.ok(data.demographics.rows.filter((row) => row.year >= 2021).every((row) => row.populationWan > 140000 && row.naturalRatePermille > -5 && row.naturalRatePermille < 5));
  assert.deepEqual(data.demographics.naturalHistory.map((row) => row.year), Array.from({ length: 20 }, (_, index) => 2006 + index));
  assert.deepEqual([data.demographics.naturalHistory[0].rate, data.demographics.naturalHistory.at(-1).rate], [5.28, -2.41]);
  assert.deepEqual([data.demographics.naturalHistory[0].populationWan, data.demographics.naturalHistory.at(-1).populationWan], [131448, 140489]);
  assert.ok(data.demographics.naturalHistory.every((row) => row.url.startsWith("https://www.stats.gov.cn/") && (!row.populationUrl || row.populationUrl.startsWith("https://www.stats.gov.cn/")) && row.populationWan > 130000 && row.populationWan < 142000 && row.rate > -5 && row.rate < 10));
  assert.deepEqual(data.demographics.naturalHistory.slice(-5).map((row) => row.populationWan), data.demographics.rows.slice(-5).map((row) => row.populationWan));
  assert.match(data.demographics.basis, /2019—2020年以虚线标记口径衔接/);
  assert.match(source, /2015—2025 年同一时间轴/);
  assert.match(source, /naturalHistory\.filter\(\(item\) => item\.year >= 2015\)/);
  assert.match(source, /demographics\.rows\.filter\(\(item\) => item\.year >= 2015\)/);
  assert.match(source, /demographic-urban-transition/);
  assert.match(source, /人口总量与自然增长率/);
  assert.match(source, /常住人口城镇化率/);
  assert.match(source, /employment-grid-cards[\s\S]*?<UrbanizationChart \/><PopulationChangeChart \/><PopulationStructureChart \/>/);
  assert.match(source, /subgroup === "就业市场" \? "4 项月度与年度指标"/);
  assert.doesNotMatch(source, /年度序列独立成组；按人口变化、城镇化、年龄结构依次查看/);
  assert.match(css, /\.employment-grid-cards \.urbanization-card \.demographic-chart \{ max-width: 560px; margin-inline: auto; \}/);
  assert.match(css, /@media \(min-width: 801px\) \{\s*\.employment-grid-cards > \.intrayear-card:not\(\.demographic-card\) \.intrayear-card-top \{ flex-wrap: nowrap; \}/);
  const unemployment = JSON.parse(await readFile(new URL("../app/data/macro-intrayear.json", import.meta.url), "utf8")).series.find((row) => row.metric === "城镇调查失业率");
  assert.equal(unemployment.periods[0], "2025-01");
  assert.equal(unemployment.periods.at(-1), "2026-08");
  assert.equal(unemployment.values.length, unemployment.periods.length);
  assert.equal(unemployment.sourceUrls.length, unemployment.periods.length);
  assert.ok(unemployment.sourceUrls.every((url) => url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(!unemployment.periods.includes("2026-01"));
  assert.match(source, /实际使用外资/);
  assert.equal(data.inwardFdi.rows.length, 8);
  assert.ok(data.inwardFdi.rows.every((row, index, rows) => index === 0 || row.amount > rows[index - 1].amount));
  assert.deepEqual([data.inwardFdi.rows.at(-1).amount, data.inwardFdi.rows.at(-1).yoy], [4799.5, -5.3]);
  assert.ok(data.inwardFdi.rows.every((row) => row.url.includes("mofcom.gov.cn/")));
  assert.deepEqual(data.inwardFdi.annualRows.map((row) => row.year), [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(data.inwardFdi.annualRows.map((row) => row.yoy), [0.9, 5.8, 6.2, 14.9, 6.3, -8, -27.1, -9.5]);
  assert.ok(data.inwardFdi.annualRows.every((row) => row.url.includes("mofcom.gov.cn/")));
  assert.match(data.inwardFdi.annualBasis, /年度同比.*不与月度累计同比混用/);
  assert.match(source, /const \[annualActive, setAnnualActive\] = useState\(annualRows\.length - 1\)/);
  assert.match(source, /onPointerEnter=\{\(\) => setAnnualActive\(index\)\} onClick=\{\(\) => setAnnualActive\(index\)\}/);
  assert.match(source, /实际使用外资：\{selectedAnnual\.amount\.toLocaleString/);
  assert.match(source, /href=\{selectedAnnual\.url\}/);
  assert.match(source, /annualY = \(value: number\) => 108 - \(value \/ annualLimit\) \* 72/);
  assert.match(source, /\[-annualLimit, 0, annualLimit\]/);
  assert.match(source, /zeroAxis=\{\(item\.unit === "%" && \/同比\|环比\/\.test\(active\.basis\)\)/);
  assert.match(source, /precision=\{1\} zeroCentered \/>/);
  assert.match(source, /const axes = \[low, 0, high\]/);
  assert.match(source, /const zeroLimit = Math\.max\(5, Math\.ceil\(Math\.max\(\.\.\.rows\.flatMap/);
  assert.match(source, /年度同比/);
  assert.equal(data.goodsTrade.rows.length, 8);
  assert.ok(data.goodsTrade.rows.every((row) => Math.abs(row.export - row.import - row.surplus) <= .02));
  assert.deepEqual([data.goodsTrade.rows.at(-1).export, data.goodsTrade.rows.at(-1).import, data.goodsTrade.rows.at(-1).surplus], [4014.41, 2823.56, 1190.85]);
  assert.match(data.goodsTrade.sourceUrl, /^https:\/\/data\.mofcom\.gov\.cn\//);
  assert.equal(data.ccfi.rows.length, 8);
  assert.equal(data.ccfi.rows.at(-1).value, 1835.55);
  assert.ok(data.ccfi.rows.every((row) => row.url.startsWith("https://www.mot.gov.cn/")));
  for (const label of ["出口金额与增速", "进口金额与增速", "货物贸易顺差", "出口集装箱运价指数（CCFI）"]) assert.match(source, new RegExp(label.replace(/[()]/g, "\\$&")));
});

test("adds verified long-run housing supply and clearly labelled price comparisons", async () => {
  const [data, history, source] = await Promise.all([
    readFile(new URL("../app/data/macro-real-estate.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-real-estate-supply-history.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(data.supply.rows.length, 18);
  assert.equal(history.rows.length, 139);
  assert.equal(history.rows[0].period, "2014-02");
  assert.equal(history.rows.at(-1).period, "2026-08");
  assert.equal(history.rows.filter((row) => row.officialPressUrl).length, 18);
  assert.equal(history.rows.at(-1).salesCumulative, 49879.77);
  assert.equal(history.rows.at(-1).unsoldEnd, 75349);
  assert.ok(history.rows.every((row, index, rows) => index === 0 || row.period > rows[index - 1].period));
  assert.ok(data.supply.rows.every((row) => {
    const historicalPeriod = `${row.period.slice(0, 4)}-${row.period.match(/—(\d+)月/)[1].padStart(2, "0")}`;
    const historical = history.rows.find((item) => item.period === historicalPeriod);
    return historical && Math.round(historical.salesCumulative) === row.salesCumulative && historical.unsoldEnd === row.unsoldEnd && historical.officialPressUrl === row.url;
  }));
  assert.equal(data.prices.rows.length, 8);
  assert.deepEqual([data.supply.rows.at(-1).salesCumulative, data.supply.rows.at(-1).unsoldEnd], [49880, 75349]);
  assert.deepEqual([data.prices.rows.at(-1).city70Yoy, data.prices.rows.at(-1).city70Mom, data.prices.rows.at(-1).tier1Yoy, data.prices.rows.at(-1).tier1Mom], [-3.29, -0.17, -0.9, 0.1]);
  assert.ok(data.supply.rows.every((row, index, rows) => row.url.startsWith("https://www.stats.gov.cn/") && row.salesCumulative > 0 && row.unsoldEnd > 0 && (index === 0 || row.period.slice(0, 4) !== rows[index - 1].period.slice(0, 4) || row.salesCumulative > rows[index - 1].salesCumulative)));
  assert.ok(data.prices.rows.every((row) => row.tableUrl.startsWith("https://www.stats.gov.cn/") && row.tier1Url.startsWith("https://www.stats.gov.cn/") && [row.city70Yoy, row.city70Mom, row.tier1Yoy, row.tier1Mom].every(Number.isFinite)));
  assert.match(data.prices.basis, /非统计局加权总指数/);
  assert.match(data.supply.basis, /年初至当期累计/);
  assert.match(source, /<RealEstateCharts \/>/);
  assert.match(source, /当月同比<\/button>/);
  assert.match(source, /当月环比<\/button>/);
});

test("keeps export partner shares and product-upgrading proxies on comparable annual bases", async () => {
  const [data, source] = await Promise.all([
    readFile(new URL("../app/data/macro-intrayear.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(data.exportPartnerRows.map((row) => row.year), [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.ok(data.exportPartnerRows.every((row) => row.markets.length === 3 && row.markets.every((market) => market.share > 0 && market.amount > 0)));
  assert.equal(data.exportPartnerRows[0].markets[0].share, 12.2);
  assert.equal(data.exportPartnerRows[0].markets[2].share, 18.4);
  assert.deepEqual(data.exportPartnerRows.at(-1).markets.map((market) => market.share), [17.6, 14.8, 11.1]);
  assert.deepEqual(data.exportProductRows.map((row) => row.year), [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.ok(data.exportProductRows.every((row) => row.total > row.mechanical && row.total > row.highTech && row.total > row.laborIntensive));
  assert.deepEqual(data.exportProductRows.slice(0, 2).map((row) => row.laborIntensive), [null, null]);
  assert.ok(data.exportProductRows.slice(2).every((row) => row.laborIntensive > 0));
  assert.ok(data.exportStructureSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.deepEqual(data.exportStructureSources.map((item) => item.year), data.exportPartnerRows.map((row) => row.year));
  assert.match(source, /中国出口贸易伙伴占比/);
  assert.match(source, /出口结构升级观察/);
  assert.match(source, /未列示/);
  assert.match(source, /2016—2017留空/);
  assert.match(source, /分类有交叉/);
});

test("keeps the two export charts full width with crisp, separately styled series", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.export-observation-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.export-partner-line,\s*\.export-product-line\s*\{[^}]*fill:\s*none\s*!important/);
  assert.match(css, /\.export-partner-line\.export-partner-eu[^}]*stroke-dasharray/);
  assert.match(css, /\.export-product-line\.export-product-labor[^}]*stroke-dasharray/);
});

test("renders the auto and appliance comparison under growth-driver consumption", async () => {
  const [source, data] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-intrayear.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const growthStart = source.indexOf('if (pillar === "增长动力")');
  const growthEnd = source.indexOf('const primaryRows = group === "全部" ? pillarRows.filter', growthStart);
  assert.ok(growthStart >= 0 && growthEnd > growthStart);
  assert.match(source.slice(growthStart, growthEnd), /subgroup === "消费" \? <ConsumerCategoryChart \/> : null/);
  assert.equal(data.consumerCategoryRows.length, 7);
  assert.deepEqual([data.consumerCategoryRows.at(-1).autoYoy, data.consumerCategoryRows.at(-1).autoCumulativeYoy, data.consumerCategoryRows.at(-1).applianceYoy, data.consumerCategoryRows.at(-1).applianceCumulativeYoy], [-18.5, -13.9, 2.3, -5.6]);
});

test("uses the wine, ochre and warm-gray palette across the workbench", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--teal: #741918;/);
  assert.match(css, /--commodity: #bc9157;/);
  assert.match(css, /--bond: #818a7d;/);
  assert.match(css, /--canvas: #f7f5f1;/);
  for (const selector of [".login-shell", ".topbar", ".research-summary", ".intrayear-line", ".annual-sparkline polyline", ".allocation-intro", ".scenario-fill", ".rating-policy"]) assert.ok(css.includes(selector));
  assert.match(css, /\.intrayear-line[^\n]*stroke: var\(--teal\)/);
  assert.match(css, /\.annual-sparkline polyline[^\n]*stroke: var\(--teal\)/);
  assert.doesNotMatch(css, /--teal: #1f7a7a|--navy: #102a43/);
});

test("keeps the domestic mirror password protected and feature complete", async () => {
  const [html, client, handler, publisher] = await Promise.all([
    readFile(new URL("../cloudbase-proxy/public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../cloudbase-proxy/public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../cloudbase-proxy/index.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/publish-data-cloudbase.mjs", import.meta.url), "utf8"),
  ]);
  for (const label of ["宏观", "大类资产", "中观", "微观", "资产配置"]) assert.match(html, new RegExp(label));
  for (const label of ["配置总览", "市场因子", "细分配置", "情景压力", "参数与方法"]) assert.match(client, new RegExp(label));
  for (const label of ["67-INDICATOR LIBRARY", "三份内参的观点演变", "VALUATION & ODDS", "PRIVATE STRATEGIES", "INTERNAL RATING"]) assert.match(client, new RegExp(label));
  assert.match(handler, /if \(!isAuthorized\(event\)\) return json\(401/);
  assert.match(handler, /advisory = JSON\.parse/);
  assert.match(publisher, /app", "data", "advisory\.json/);
});
