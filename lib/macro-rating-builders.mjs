// Build rating observations from collected official evidence, using the V1.21 observation as a
// structural template (labels, scope notes). Scoring code is NOT touched: every built observation
// must still pass scoreIndicator() unchanged. Builders return null when evidence is incomplete.
const NBS = "国家统计局", PBC = "中国人民银行", MOF = "财政部";
const clone = (x) => structuredClone(x);
const monthAdd = (p, n) => { let [y, m] = p.split("-").map(Number); m += n; while (m < 1) { m += 12; y -= 1; } while (m > 12) { m -= 12; y += 1; } return `${y}-${String(m).padStart(2, "0")}`; };
const quarterAdd = (p, n) => { let [y, q] = [Number(p.slice(0, 4)), Number(p.slice(6))]; q += n; while (q < 1) { q += 4; y -= 1; } while (q > 4) { q -= 4; y += 1; } return `${y}-Q${q}`; };
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const latestKey = (obj, ok = () => true) => Object.keys(obj || {}).sort().filter((k) => ok(obj[k], k)).at(-1) ?? null;
const auto = (text) => `草稿自动采集：${text}（官方原页解析，待人工复核；规则冻结沿用，未改曲线与权重）。`;

function base(template, { value, period, releaseDate, sourceUrl, asOf }) {
  const o = clone(template);
  delete o.rationale;
  Object.assign(o, { value, period, latestAvailablePeriod: period, releaseDate, sourceUrl, verifiedAt: asOf, verified: true });
  return o;
}
const meta = (publisher, { period, releaseDate, sourceUrl, asOf }) => ({ period, latestAvailablePeriod: period, originalPublisher: publisher, verified: true, verifiedAt: asOf, releaseDate, sourceUrl });

// ---------- simple NBS single-value indicators ----------
const simple = (kind, field) => (ctx, period) => {
  const p = period ?? latestKey(ctx.ev[kind], (r) => fin(r[field]));
  const r = ctx.ev[kind]?.[p];
  if (!r || !fin(r[field])) return null;
  const o = base(ctx.template, { value: r[field], period: p, releaseDate: r.releaseDate, sourceUrl: r.url, asOf: ctx.asOf });
  o.rationale = auto(`${p} ${ctx.template.basis} ${r[field]}${ctx.template.unit}`);
  return o;
};

// ---------- dual (monthly + YTD) official rows ----------
function dual(ctx, period, { kind, month, ytd, extra }) {
  const p = period ?? latestKey(ctx.ev[kind], (r) => fin(r[month]) && fin(r[ytd]));
  const r = ctx.ev[kind]?.[p];
  if (!r || !fin(r[month]) || !fin(r[ytd])) return null;
  const m = { period: p, releaseDate: r.releaseDate, sourceUrl: r.url, asOf: ctx.asOf };
  const o = base(ctx.template, { ...m, value: r[month] });
  const y = clone(ctx.template.scoringInputs.yearToDateGrowth);
  Object.assign(y, meta(NBS, m), { value: r[ytd], periodScope: `${p.slice(0, 4)}-01—${p}` });
  y.rawEvidence = { ...y.rawEvidence, reportedMonthlyYoyPct: r[month], reportedCumulativeYoyPct: r[ytd], ...(extra ? extra(r) : {}) };
  o.scoringInputs = { ...o.scoringInputs, yearToDateGrowth: y };
  o.rationale = auto(`${p} 当月${r[month]}%、年初累计${r[ytd]}%`);
  return o;
}

// ---------- PMI three-month means ----------
function pmi(series) {
  return (ctx, period) => {
    const p = period ?? latestKey(ctx.ev.pmi);
    const rel = ctx.ev.pmi?.[p];
    if (!rel) return null;
    const months = [-5, -4, -3, -2, -1, 0].map((n) => monthAdd(p, n));
    const vals = months.map((mm) => rel.table?.[mm]?.[series]);
    if (vals.some((v) => !fin(v))) return null;
    const comp = (mm, v, withVerify) => ({ period: mm, value: v, unit: "指数点", basis: "季调当月指数", series, originalPublisher: NBS,
      ...(withVerify ? { verified: true, verifiedAt: ctx.asOf } : {}), releaseDate: rel.releaseDate, sourceUrl: rel.url });
    const latest = vals.slice(3), prior = vals.slice(0, 3);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const m = { period: p, releaseDate: rel.releaseDate, sourceUrl: rel.url, asOf: ctx.asOf };
    const o = base(ctx.template, { ...m, value: Number(mean(latest).toFixed(6)) });
    o.components = months.slice(3).map((mm, i) => ({ period: mm, series, value: latest[i], unit: "指数点", basis: "季调当月指数", releaseDate: rel.releaseDate, originalPublisher: NBS, sourceUrl: rel.url }));
    const si = clone(ctx.template.scoringInputs);
    Object.assign(si.level, meta(NBS, m), { value: mean(latest) });
    si.level.rawEvidence = { components: months.slice(3).map((mm, i) => comp(mm, latest[i], true)) };
    Object.assign(si.nonOverlappingThreeMonthChange, meta(NBS, m), { value: mean(latest) - mean(prior) });
    si.nonOverlappingThreeMonthChange.rawEvidence = { components: months.map((mm, i) => comp(mm, vals[i], true)), latestMean: mean(latest), precedingMean: mean(prior), series };
    o.scoringInputs = si;
    o.rationale = auto(`${months[3]}—${p} 季调均值${mean(latest).toFixed(2)}，较前3月${(mean(latest) - mean(prior)).toFixed(2)}`);
    return o;
  };
}

// ---------- G18 capacity utilisation YoY ----------
function capacity(ctx, period) {
  const p = period ?? latestKey(ctx.ev.capacity, (_, k) => ctx.ev.capacity[quarterAdd(k, -4)]);
  const cur = ctx.ev.capacity?.[p], prev = ctx.ev.capacity?.[quarterAdd(p || "2000-Q1", -4)];
  if (!cur || !prev) return null;
  const part = (r) => ({ period: r.period, value: r.value, unit: "%", basis: "季度工业产能利用率", series: "industrialCapacityUtilization", originalPublisher: NBS, sourceUrl: r.url, releaseDate: r.releaseDate });
  const o = base(ctx.template, { value: Number((cur.value - prev.value).toFixed(6)), period: p, releaseDate: cur.releaseDate, sourceUrl: cur.url, asOf: ctx.asOf });
  o.components = [part(prev), part(cur)];
  o.rationale = auto(`${p} ${cur.value}% 较上年同季 ${prev.value}%`);
  return o;
}

// ---------- G02 profit growth & quality ----------
function profitGrowth(ctx, period) {
  const ok = (r) => ["ytdYoy", "monthYoy", "profitMargin", "profitMarginYoyChange", "receivablesDays", "receivablesDaysYoyChange"].every((k) => fin(r[k]));
  const p = period ?? latestKey(ctx.ev.profit, ok);
  const r = ctx.ev.profit?.[p];
  if (!r || !ok(r)) return null;
  const m = { period: p, releaseDate: r.releaseDate, sourceUrl: r.url, asOf: ctx.asOf };
  const o = base(ctx.template, { ...m, value: r.ytdYoy });
  const src = { originalPublisher: NBS, sourceUrl: r.url, releaseDate: r.releaseDate };
  const q = clone(ctx.template.profitQuality);
  q.period = p;
  q.profitMargin = { ...q.profitMargin, value: r.profitMargin, period: p, ...src };
  q.receivables = { ...q.receivables, value: r.receivablesDays, period: p, ...src };
  const declines = [...(r.majorText || "").matchAll(/([\u4e00-\u9fa5、]+?业)下降(\d+(?:\.\d+)?)%/g)].map((x) => ({ name: x[1], value: -Number(x[2]) })).sort((a, b) => a.value - b.value);
  q.counterEvidence = {
    summary: `自动采集的客观反证：应收账款平均回收期同比${r.receivablesDaysYoyChange >= 0 ? "增加" : "减少"}${Math.abs(r.receivablesDaysYoyChange)}天${declines.length ? `；${declines.length}个主要行业累计利润下降` : ""}。总体利润增速不代表全行业盈利质量同步改善（待人工复核）。`,
    evidence: [{ metric: "应收账款平均回收期同比变动", period: p, value: r.receivablesDaysYoyChange, unit: "天", ...src },
      ...declines.slice(0, 2).map((d) => ({ metric: `${d.name}利润总额累计同比`, period: p, value: d.value, unit: "%", ...src }))],
  };
  o.profitQuality = q;
  const si = clone(ctx.template.scoringInputs);
  const set = (key, value, raw) => { Object.assign(si[key], meta(NBS, m), { value }); si[key].rawEvidence = { ...si[key].rawEvidence, ...raw }; };
  const mo = Number(p.slice(5));
  set("cumulativeComparableProfitGrowth", r.ytdYoy, { reportedYoyPct: r.ytdYoy, aggregation: `1—${mo}月累计` });
  set("officialCurrentMonthComparableProfitGrowth", r.monthYoy, { reportedYoyPct: r.monthYoy, aggregation: `${mo}月单月` });
  set("reportedProfitMarginYoyChange", r.profitMarginYoyChange, { currentProfitMargin: r.profitMargin, reportedYoyChange: r.profitMarginYoyChange, aggregation: `1—${mo}月累计` });
  set("reportedReceivablesDaysYoyChange", r.receivablesDaysYoyChange, { currentReceivablesDays: r.receivablesDays, reportedYoyChange: r.receivablesDaysYoyChange });
  o.scoringInputs = si;
  o.rationale = auto(`${p} 累计利润可比同比${r.ytdYoy}%、当月${r.monthYoy}%、利润率${r.profitMargin}%（同比${r.profitMarginYoyChange}pp）、回收期${r.receivablesDays}天（同比${r.receivablesDaysYoyChange}天）`);
  return o;
}

// ---------- G19 industry profit breadth ----------
function profitBreadth(ctx, period) {
  const p = period ?? latestKey(ctx.ev.profit, (r) => r.industries?.length === 41);
  const r = ctx.ev.profit?.[p];
  if (!r || r.industries?.length !== 41) return null;
  const t = ctx.template;
  const names = t.rawEvidence.industries.map((x) => x.name);
  const common = { period: p, latestAvailablePeriod: p, scope: t.scope, basis: "年初累计行业利润可比同比", originalPublisher: NBS, sourceUrl: r.url, releaseDate: r.releaseDate, verifiedAt: ctx.asOf, verified: true };
  const rows = [];
  for (const name of names) {
    const row = r.industries.find((x) => x.name === name);
    if (!row) return null;
    const profit = Number(row.profit);
    if (/^-?\d/.test(row.profitYoy)) {
      rows.push({ name, profit, profitUnit: "亿元", officialYoyPct: Number(row.profitYoy), priorProfitSign: "positive", officialSpecialChange: null,
        sourceTableRow: { name, profit: row.profit, profitYoy: row.profitYoy }, ...common });
      continue;
    }
    // Special notes: only accept an explicit sentence naming the industry in the same release.
    const sentence = (r.majorText || "").split(/[，。]/).find((s) => s.includes(name) && /由亏转盈|扭亏为盈|减亏|增亏|由盈转亏/.test(s));
    if (!sentence) return null;
    const type = /由亏转盈|扭亏为盈/.test(sentence) ? "turnaround" : /减亏/.test(sentence) ? "lossReduction" : /增亏/.test(sentence) ? "lossIncrease" : "turnToLoss";
    rows.push({ name, profit, profitUnit: "亿元", officialYoyPct: null, priorProfitSign: type === "turnToLoss" ? "positive" : "negative",
      officialSpecialChange: { type, originalText: `${sentence.replace(/^.*?(?=[\u4e00-\u9fa5、]*$)/, "")}。`.replace(/^/, ""), period: p, sourceUrl: r.url, releaseDate: r.releaseDate },
      sourceTableRow: { name, profit: row.profit, profitYoy: row.profitYoy }, ...common });
  }
  // fix originalText to exactly "<name>由亏转盈。" style sentence fragment
  for (const row of rows) if (row.officialSpecialChange) {
    const s = (r.majorText || "").split(/[，。]/).find((x) => x.includes(row.name));
    row.officialSpecialChange.originalText = `${s.slice(s.indexOf(row.name))}。`;
  }
  let improving = 0, flat = 0;
  for (const row of rows) {
    const d = fin(row.officialYoyPct) ? Math.sign(row.officialYoyPct) : ["turnaround", "lossReduction"].includes(row.officialSpecialChange.type) ? 1 : -1;
    improving += d === 1 ? 1 : 0; flat += d === 0 ? 1 : 0;
  }
  const value = (improving + 0.5 * flat) / 41 * 100;
  const o = base(t, { value, period: p, releaseDate: r.releaseDate, sourceUrl: r.url, asOf: ctx.asOf });
  o.rawEvidence = { ...clone(t.rawEvidence), aggregation: `1—${Number(p.slice(5))}月累计`, sourceTable: r.tableTitle || t.rawEvidence.sourceTable, industries: rows };
  delete o.rawEvidence.growthContribution; // context only; not collected automatically
  o.rationale = auto(`${p} 41个行业中改善${improving}个、持平${flat}个，广度${value.toFixed(2)}%`);
  return o;
}

// ---------- P01E / P01F fiscal ----------
function fiscal(key) {
  return (ctx, period) => {
    const F = ctx.ev.fiscal || {};
    const ok = (k) => [k, monthAdd(k, -1), monthAdd(k, -12), monthAdd(k, -13)].every((x) => F[x]?.[key]?.amount && fin(F[x][key].yoy)) && Number(k.slice(5)) > 2;
    const p = period ?? latestKey(F, (_, k) => ok(k));
    if (!p || !ok(p)) return null;
    const t = ctx.template;
    const item = (x) => {
      const r = F[x], ti = t.scoringInputs.latestMonthGrowth.rawEvidence.currentYear.current;
      return { ...clone(ti), value: r[key].amount, reportedYoyPct: r[key].yoy, period: x, latestAvailablePeriod: x, periodScope: `${x.slice(0, 4)}-01—${x}`,
        verifiedAt: ctx.asOf, sourceUrl: r.url, retrievalUrl: r.url, releaseDate: r.releaseDate };
    };
    const cur = F[p];
    const curMonth = cur[key].amount - F[monthAdd(p, -1)][key].amount;
    const prevMonth = F[monthAdd(p, -12)][key].amount - F[monthAdd(p, -13)][key].amount;
    const growth = (curMonth / prevMonth - 1) * 100;
    const m = { period: p, releaseDate: cur.releaseDate, sourceUrl: cur.url, asOf: ctx.asOf };
    const o = base(t, { ...m, value: cur[key].yoy });
    o.source = `财政部国库司《${cur.title}》`;
    o.fiscalExpenditure = { ...clone(t.fiscalExpenditure), period: p, cumulativeExpenditure: cur[key].amount, reportedYoyPct: cur[key].yoy, sourceUrl: cur.url, releaseDate: cur.releaseDate };
    const lm = clone(t.scoringInputs.latestMonthGrowth);
    Object.assign(lm, meta(MOF, m), { value: Number(growth.toFixed(6)), periodScope: p, retrievalUrl: cur.url });
    lm.rawEvidence = { ...lm.rawEvidence, currentYear: { preceding: item(monthAdd(p, -1)), current: item(p) }, previousYear: { preceding: item(monthAdd(p, -13)), current: item(monthAdd(p, -12)) },
      currentMonthAmount: curMonth, previousYearMonthAmount: prevMonth, computedYoyPctUnrounded: growth };
    o.scoringInputs = { ...o.scoringInputs, latestMonthGrowth: lm };
    o.rationale = auto(`${p} 累计${cur[key].amount}亿元、同比${cur[key].yoy}%；当月${curMonth}亿元对上年${prevMonth}亿元`);
    return o;
  };
}

// ---------- G15 second-hand prices (existing collector file) ----------
function secondhand(ctx, period) {
  const rows = ctx.data.secondhand?.monthly || [];
  const p = period ?? rows.map((r) => r.period).sort().at(-1);
  const months = [monthAdd(p, -2), monthAdd(p, -1), p].map((x) => rows.find((r) => r.period === x));
  if (months.some((r) => !r || r.cities?.length !== 70 || !r.releaseDate)) return null;
  const last = months[2];
  const tpl = ctx.template.components[0];
  const o = base(ctx.template, { value: Number((months.reduce((s, r) => s + r.medianMomPct, 0) / 3).toFixed(6)), period: p, releaseDate: last.releaseDate, sourceUrl: last.sourceUrl, asOf: ctx.asOf });
  o.components = months.map((r) => ({ ...clone(tpl), period: r.period, value: r.medianMomPct, sourceUrl: r.sourceUrl, releaseDate: r.releaseDate, cities: clone(r.cities) }));
  o.rationale = auto(`${months[0].period}—${p} 70城二手住宅环比中位数均值`);
  return o;
}

// ---------- E01 / E07 GDP (existing deflator collector) ----------
function gdpRows(ctx) {
  const rows = ctx.data.gdp?.rows || [];
  const vintage = rows.at(-1)?.vintage;
  return { rows: rows.filter((r) => r.vintage === vintage), vintage, releaseDate: /^\d{4}-\d{2}-\d{2}/.exec(vintage || "")?.[0] };
}
function gdpGrowth(ctx, period) {
  const { rows, vintage, releaseDate } = gdpRows(ctx);
  const p = period ?? rows.at(-1)?.period;
  const cur = rows.find((r) => r.period === p), pre = rows.find((r) => r.period === quarterAdd(p || "2000-Q1", -1));
  if (!cur || !pre || !releaseDate) return null;
  const g = (r) => Number((r.realGdpIndex - 100).toFixed(6));
  const m = { period: p, releaseDate, sourceUrl: cur.sourceUrl, asOf: ctx.asOf };
  const o = base(ctx.template, { ...m, value: g(cur) });
  o.revisionVersion = vintage;
  const si = clone(ctx.template.scoringInputs);
  const lv = (r) => ({ ...clone(si.level), ...meta(NBS, { ...m, period: r.period }), value: g(r), revisionVersion: vintage });
  si.level = lv(cur);
  si.quarterYoyChange = { ...si.quarterYoyChange, ...meta(NBS, m), revisionVersion: vintage, value: g(cur) - g(pre),
    rawEvidence: { ...si.quarterYoyChange.rawEvidence, current: { ...clone(si.quarterYoyChange.rawEvidence.current), ...meta(NBS, m), value: g(cur), revisionVersion: vintage },
      preceding: { ...clone(si.quarterYoyChange.rawEvidence.preceding), ...meta(NBS, { ...m, period: pre.period }), latestAvailablePeriod: undefined, value: g(pre), revisionVersion: vintage } } };
  delete si.quarterYoyChange.rawEvidence.preceding.latestAvailablePeriod;
  o.scoringInputs = si;
  o.rationale = auto(`${p} 单季实际同比${g(cur)}%，前季${g(pre)}%（版次${vintage}）`);
  return o;
}
function deflatorEvidence(ctx, r, prior, vintage, releaseDate, tpl) {
  const ref = tpl.gdpDeflatorEvidence;
  const put = (x, value, period) => ({ ...clone(x), period, value, revisionVersion: vintage, releaseDate, sourceUrl: r.sourceUrl, ...(x.verifiedAt ? { verifiedAt: ctx.asOf } : {}) });
  return { period: r.period, revisionVersion: vintage, currentNominal: put(ref.currentNominal, r.nominalGdp, r.period),
    priorNominal: put(ref.priorNominal, r.priorYearNominalGdp, prior), realGrowth: put(ref.realGrowth, Number((r.realGdpIndex - 100).toFixed(6)), r.period),
    realYoyIndex: put(ref.realYoyIndex, r.realGdpIndex, r.period) };
}
function gdpDeflator(ctx, period) {
  const { rows, vintage, releaseDate } = gdpRows(ctx);
  const p = period ?? rows.at(-1)?.period;
  const need = [p, quarterAdd(p || "2000-Q1", -1), quarterAdd(p || "2000-Q1", -2)].map((x) => rows.find((r) => r.period === x));
  if (need.some((r) => !r || !fin(r.nominalGdp) || !fin(r.priorYearNominalGdp) || !fin(r.realGdpIndex)) || !releaseDate) return null;
  const level = (r) => ((r.nominalGdp / r.priorYearNominalGdp) / (r.realGdpIndex / 100) - 1) * 100;
  const t = ctx.template;
  const o = base(t, { value: Number(level(need[0]).toFixed(6)), period: p, releaseDate, sourceUrl: need[0].sourceUrl, asOf: ctx.asOf });
  o.revisionVersion = vintage;
  o.gdpDeflatorEvidence = deflatorEvidence(ctx, need[0], quarterAdd(p, -4), vintage, releaseDate, t);
  const si = clone(t.scoringInputs);
  const sub = (key, r) => { const x = si[key]; Object.assign(x, { value: level(r), period: r.period, latestAvailablePeriod: r.period, releaseDate, verifiedAt: ctx.asOf, revisionVersion: vintage, sourceUrl: r.sourceUrl });
    x.gdpDeflatorEvidence = deflatorEvidence(ctx, r, quarterAdd(r.period, -4), vintage, releaseDate, x); };
  sub("previousQuarterPriceLevel", need[1]); sub("twoQuartersAgoPriceLevel", need[2]);
  o.scoringInputs = si;
  o.rationale = auto(`${p} GDP平减指数单季同比${level(need[0]).toFixed(3)}%（版次${vintage}）`);
  return o;
}

// ---------- F01 / F02 loans (existing PBC credit collector) ----------
function loans(id) {
  const plan = id === "F01" ? { series: "householdLong", bounds: [50.5, 101] } : { series: "enterpriseLong", bounds: [100, 200] };
  return (ctx, period) => {
    const rows = ctx.data.credit?.rows || [];
    const dates = ctx.ev.pbcReleaseDates || {};
    const row = (x) => rows.find((r) => r.period === x);
    const p = period ?? rows.map((r) => r.period).sort().filter((x) => Number(x.slice(5)) > 1).at(-1);
    if (!p || Number(p.slice(5)) <= 1) return null;
    const ps = [p, monthAdd(p, -1), monthAdd(p, -12), monthAdd(p, -13)];
    const tplCur = ctx.template.scoringInputs.yearToDateMoreIncrease.rawEvidence.current;
    const ep = (x) => {
      const r = row(x), v = r?.[`${plan.series}Ytd`];
      const releaseDate = dates[r?.url]; // PubDate of the original page; URL digits are upload ids, not release dates
      if (!fin(v) || !releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return null;
      const currentYear = x.slice(0, 4) === p.slice(0, 4);
      return { ...clone(tplCur), period: x, value: v, sourceUrl: r.url, releaseDate, verifiedAt: ctx.asOf, latestAvailablePeriod: x,
        periodScope: `${x.slice(0, 4)}-01—${x}`, roundingUnit: currentYear && id === "F01" ? 1 : 100 };
    };
    const [cur, pre, ly, lyPre] = ps.map(ep);
    if (!cur || !pre || !ly || !lyPre) return null;
    const mo = Number(p.slice(5));
    const t = ctx.template;
    const m = { period: p, releaseDate: cur.releaseDate, sourceUrl: cur.sourceUrl, asOf: ctx.asOf };
    // Legacy V1.20 main value (近3月当月新增额同比多增) is still validated by the engine, so rebuild it too.
    const monthNew = (x) => {
      const c = ep(x), b = ep(monthAdd(x, -1));
      if (!c || !b || Number(x.slice(5)) === 1) return null;
      return { period: x, value: c.value - b.value, unit: "亿元", series: plan.series, basis: "当月新增", sourceUrl: c.sourceUrl, releaseDate: c.releaseDate,
        originalPublisher: PBC, calculation: t.components[0].calculation,
        cumulativeParts: [b, c].map((z) => ({ period: z.period, value: z.value, unit: "亿元", basis: "年初累计新增", sourceUrl: z.sourceUrl, releaseDate: z.releaseDate })) };
    };
    const legacy = [-14, -13, -12, -2, -1, 0].map((n) => monthNew(monthAdd(p, n)));
    if (legacy.some((x) => !x)) return null;
    const legacyValue = legacy.slice(3).reduce((a, x) => a + x.value, 0) - legacy.slice(0, 3).reduce((a, x) => a + x.value, 0);
    const o = base(t, { ...m, value: legacyValue });
    o.components = legacy;
    const si = clone(t.scoringInputs);
    const ytd = cur.value - ly.value, month = cur.value - pre.value - (ly.value - lyPre.value);
    Object.assign(si.yearToDateMoreIncrease, meta(PBC, m), { value: ytd, periodScope: `${p.slice(0, 4)}-01—${p}`, roundingErrorBound: plan.bounds[0] });
    si.yearToDateMoreIncrease.rawEvidence = { ...si.yearToDateMoreIncrease.rawEvidence, current: cur, previous: ly, components: [cur, ly],
      explanation: `${cur.periodScope} ${cur.value}亿元 − ${ly.periodScope} ${ly.value}亿元 = ${ytd}亿元；除以${mo}个月 = ${ytd / mo}亿元/月。` };
    Object.assign(si.latestMonthMoreIncrease, meta(PBC, m), { value: month, roundingErrorBound: plan.bounds[1] });
    si.latestMonthMoreIncrease.rawEvidence = { ...si.latestMonthMoreIncrease.rawEvidence, currentYear: { preceding: pre, current: cur }, previousYear: { preceding: lyPre, current: ly }, components: [pre, cur, lyPre, ly] };
    o.scoringInputs = si;
    o.rationale = auto(`${p} 年初累计同比多增${ytd}亿元、当月同比多增${month}亿元（${plan.series}）`);
    return o;
  };
}

// ---------- G10 customs goods exports (USD), dual month + YTD ----------
function exportsUsd(ctx, period) {
  const c = ctx.ev.customs || {};
  const p = period ?? latestKey(c, (r) => fin(r.exportMonthYoy) && fin(r.exportYtdYoy));
  const r = c[p], prior = c[monthAdd(p ?? "2000-01", -12)];
  if (!r || !fin(r.exportMonthYoy) || !fin(r.exportYtdYoy) || !fin(r.exportMonth) || !fin(r.exportYtd) || !r.releaseDate) return null;
  const m = { period: p, releaseDate: r.releaseDate, sourceUrl: r.sourceUrl, asOf: ctx.asOf };
  const o = base(ctx.template, { ...m, value: r.exportMonthYoy });
  o.revisionVersion = `${r.releaseDate}-海关美元月表`;
  o.reportedAmount = { period: p, value: r.exportMonth, unit: "百万美元" };
  if (prior && fin(prior.exportMonth)) o.yearAgoReportedAmount = { period: monthAdd(p, -12), value: prior.exportMonth, unit: "百万美元" };
  else delete o.yearAgoReportedAmount;
  const y = clone(ctx.template.scoringInputs.yearToDateGrowth);
  Object.assign(y, meta("海关总署", m), { value: r.exportYtdYoy, periodScope: `${p.slice(0, 4)}-01—${p}`, revisionVersion: o.revisionVersion });
  y.rawEvidence = { ...y.rawEvidence, reportedMonthlyYoyPct: r.exportMonthYoy, reportedCumulativeYoyPct: r.exportYtdYoy,
    currentMonthExportAmount: r.exportMonth, currentCumulativeExportAmount: r.exportYtd };
  o.scoringInputs = { ...o.scoringInputs, yearToDateGrowth: y };
  o.rationale = auto(`${p} 出口美元当月同比${r.exportMonthYoy}%、年初累计${r.exportYtdYoy}%（海关总署美元月表公布同比）`);
  return o;
}

// ---------- F07/F08 AFRE stock excluding government bonds ----------
const afreComp = (ctx, mm) => {
  const a = ctx.ev.afre?.[mm];
  if (!a || !fin(a.totalStock) || !fin(a.governmentBondStock) || !a.releaseDate) return null;
  const old = [ctx.template.components || []].flat().find((c) => c.period === mm && c.sourceUrl === a.sourceUrl);
  return { period: mm, totalStock: a.totalStock, governmentBondStock: a.governmentBondStock,
    value: Number((a.totalStock - a.governmentBondStock).toFixed(2)), unit: "万亿元", basis: "同口径月末存量", originalPublisher: PBC,
    sourceUrl: a.sourceUrl, releaseDate: a.releaseDate, revisionVersion: old?.revisionVersion ?? a.revisionVersion,
    releaseDateEvidence: old?.releaseDateEvidence ?? `官方附件Last-Modified: ${a.lastModified}；这是该版原表可得日。` };
};
const afreGrowth = (a, b) => (b.value / a.value - 1) * 100;
function afreLevel(ctx, period) {
  const p = period ?? latestKey(ctx.ev.afre, (_, k) => ctx.ev.afre[monthAdd(k, -12)]);
  if (!p) return null;
  const cs = [monthAdd(p, -12), p].map((mm) => afreComp(ctx, mm));
  if (cs.some((c) => !c)) return null;
  const rel = cs[1].releaseDate;
  const o = base(ctx.template, { value: Number(afreGrowth(cs[0], cs[1]).toFixed(6)), period: p, releaseDate: rel, sourceUrl: cs[1].sourceUrl, asOf: ctx.asOf });
  o.components = cs;
  delete o.revisionNote;
  o.rationale = auto(`${p} 剔除政府债社融存量${cs[1].value}万亿元，上年同月${cs[0].value}万亿元，同比${o.value}%`);
  return o;
}
function afreChange(ctx, period) {
  const p = period ?? latestKey(ctx.ev.afre, (_, k) => ctx.ev.afre[monthAdd(k, -15)]);
  if (!p) return null;
  const cs = [-15, -3, -12, 0].map((n) => afreComp(ctx, monthAdd(p, n)));
  if (cs.some((c) => !c)) return null;
  const v = afreGrowth(cs[2], cs[3]) - afreGrowth(cs[0], cs[1]);
  const o = base(ctx.template, { value: Number(v.toFixed(6)), period: p, releaseDate: cs[3].releaseDate, sourceUrl: cs[3].sourceUrl, asOf: ctx.asOf });
  o.components = cs;
  delete o.revisionNote;
  o.rationale = auto(`${p} 剔除政府债社融存量同比较3个月前变动${o.value}个百分点`);
  return o;
}

// ---------- P02A 7-day reverse repo, month-end effective rate, 6-month change ----------
function policyRate(ctx, period) {
  const omo = ctx.ev.omo || {};
  const lastFull = monthAdd(ctx.asOf.slice(0, 7), -1);
  const p = period ?? latestKey(omo, (r, k) => k <= lastFull && omo[monthAdd(k, -6)]);
  if (!p || p > lastFull) return null;
  const pair = [monthAdd(p, -6), p].map((mm) => omo[mm]);
  if (pair.some((r) => !r || !fin(r.rate))) return null;
  const comp = (mm, r, i) => ({ ...clone(ctx.template.components[i]), period: mm, value: r.rate, effectiveDate: r.date, sourceUrl: r.sourceUrl, releaseDate: r.releaseDate,
    effectiveDateInterpretation: "该日正式操作适用日（当月最后一次列示7天逆回购利率的公告），不表示该日发生政策利率调整。" });
  const o = base(ctx.template, { value: Math.round((pair[1].rate - pair[0].rate) * 100), period: p, releaseDate: pair[1].releaseDate, sourceUrl: pair[1].sourceUrl, asOf: ctx.asOf });
  o.components = [comp(monthAdd(p, -6), pair[0], 0), comp(p, pair[1], 1)];
  o.source = "中国人民银行公开市场业务交易公告";
  o.reviewDate = ctx.asOf;
  o.reason = `${monthAdd(p, -6)}末（${pair[0].date}）与${p}末（${pair[1].date}）正式7天逆回购公告利率分别为${pair[0].rate}%、${pair[1].rate}%；零操作公告不视为零利率。`;
  o.verificationNote = auto(`月末取当月最后一份列示7天逆回购利率的原公告；${p}其后无利率公告${pair[1].laterAnnouncementsWithoutRate?.length || 0}份`);
  o.rationale = auto(`${p} 近6个月7天逆回购政策利率变动${o.value}基点`);
  return o;
}

// ---------- P02D new enterprise loan rate, quarter-end month YoY change (bp) ----------
function enterpriseLoanRate(ctx, period) {
  const mpr = ctx.ev.mpr || {};
  const p = period ?? latestKey(mpr, (_, k) => mpr[monthAdd(k, -12)]);
  if (!p || !mpr[p] || !mpr[monthAdd(p, -12)]) return null;
  const pair = [mpr[monthAdd(p, -12)], mpr[p]];
  if (pair.some((r) => !fin(r.value))) return null;
  const comps = pair.map((r, i) => ({ ...clone(ctx.template.components[i]), period: r.period, value: r.value, sourceUrl: r.sourceUrl, releaseDate: r.releaseDate, table: r.table }));
  const o = base(ctx.template, { value: Math.round((pair[1].value - pair[0].value) * 100), period: p, releaseDate: pair[1].releaseDate, sourceUrl: pair[1].sourceUrl, asOf: ctx.asOf });
  o.components = comps;
  o.source = `中国人民银行货币政策执行报告（${pair[1].table}；上年同期${pair[0].table}）`;
  o.reason = `季末月企业新发放贷款加权平均利率${p} ${pair[1].value}%、上年同月${pair[0].value}%，100×差值=${o.value}基点。`;
  o.rationale = auto(`${p} 企业贷款加权平均利率同比变化${o.value}基点`);
  return o;
}

export const BUILDERS = {
  P02D: enterpriseLoanRate,
  G10: exportsUsd, F07: afreLevel, F08: afreChange, P02A: policyRate,
  E01: gdpGrowth, E07: gdpDeflator,
  E05: simple("press", "unemployment"),
  E08: pmi("manufacturingPMI"), E09: pmi("nonManufacturingActivity"), G11: pmi("manufacturingNewOrders"),
  G01: (ctx, p) => dual(ctx, p, { kind: "iva", month: "monthYoy", ytd: "ytdYoy" }),
  G17: (ctx, p) => dual(ctx, p, { kind: "retail", month: "goodsMonthYoy", ytd: "goodsYtdYoy",
    extra: (r) => ({ currentMonthAmount: r.goodsMonthAmount, currentCumulativeAmount: r.goodsYtdAmount }) }),
  G02: profitGrowth, G19: profitBreadth,
  G03: simple("re", "salesAreaYtd"), G14: simple("re", "investmentYtd"),
  G07: simple("fai", "manufacturingYtd"),
  G13: (ctx, p) => (ctx.ev.fai?.[p ?? latestKey(ctx.ev.fai)]?.infrastructureScopeNote ? simple("fai", "infrastructureYtd")(ctx, p) : null),
  G12: simple("press", "serviceRetailYtd"), G16: simple("press", "privateExRealEstateYtd"),
  G15: secondhand, G18: capacity,
  F01: loans("F01"), F02: loans("F02"),
  P01E: fiscal("generalExpenditure"), P01F: fiscal("fundExpenditure"),
};
