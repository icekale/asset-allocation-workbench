// Parsers for judgement-item evidence. Pure functions; no scoring.
const CN_Q = { 一: 1, 二: 2, 三: 3, 四: 4 };

/** NIFD quarterly macro leverage report (pdftotext). Sector ratios: previous quarter → current quarter. */
export function parseLeverageReport(text, title = "") {
  const flat = text.replace(/\s+/g, "");
  const q = /(\d{4})年([一二三四])季度宏观杠杆率/.exec(title + flat);
  if (!q) return null;
  const pick = (label) => {
    const m = new RegExp(`${label}(?:部门)?杠杆率(上升|下降)(\\d+(?:\\.\\d+)?)个百分点，从[^的]{0,6}的(\\d+(?:\\.\\d+)?)%(?:上升|下降)至(\\d+(?:\\.\\d+)?)%`).exec(flat);
    return m ? { change: (m[1] === "下降" ? -1 : 1) * Number(m[2]), previous: Number(m[3]), value: Number(m[4]) } : null;
  };
  const household = pick("居民"), corporate = pick("非金融企业"), government = pick("政府"), macro = pick("宏观");
  if (!household || !corporate) return null;
  const debt = (label) => { const m = new RegExp(`${label}部门债务同比增长(-?\\d+(?:\\.\\d+)?)%`).exec(flat); return m ? Number(m[1]) : null; };
  return { period: `${q[1]}-Q${CN_Q[q[2]]}`, household, corporate, government, macro, householdDebtGrowth: debt("居民"), corporateDebtGrowth: debt("企业") };
}

/** PBC monthly "中央银行各项工具流动性投放情况": the RRR row cells (原符号保留). */
export function parseToolTable(spaced) {
  const m = /调整法定存款准备金率 (\S+) (\S+) (\S+)/.exec(spaced);
  if (!m || !/单位：亿元/.test(spaced)) return null;
  const cell = (x) => (/^-?\d+(?:\.\d+)?$/.test(x) ? Number(x) : x);
  return { tool: "调整法定存款准备金率", unit: "亿元", injection: cell(m[1]), withdrawal: cell(m[2]), netInjection: cell(m[3]), tableComplete: /公开市场业务/.test(spaced) };
}

/** PBC RRR announcement text → event facts. Scope words are kept verbatim for the user to confirm. */
export function parseRrrNotice(compact) {
  const ch = /(下调|上调)[^。]{0,30}?存款准备金率(\d+(?:\.\d+)?)个(百分点|基点)/.exec(compact);
  if (!ch) return null;
  const eff = /(?:自|于)(\d{4})年(\d{1,2})月(\d{1,2})日(?:起)?/.exec(compact);
  const targeted = /定向|汽车金融|金融租赁|外汇存款准备金率|县域|农村/.test(compact.slice(Math.max(0, ch.index - 60), ch.index + 80));
  const value = Number(ch[2]) * (ch[3] === "百分点" ? 100 : 1);
  return { direction: ch[1], rawChange: { value: Number(ch[2]), unit: ch[3] }, signedChangeBp: ch[1] === "下调" ? -value : value,
    effectiveDate: eff ? `${eff[1]}-${eff[2].padStart(2, "0")}-${eff[3].padStart(2, "0")}` : null,
    scopeGuess: targeted ? "非普遍（定向/行业/外币，待确认）" : "普遍（待确认）",
    excerpt: compact.slice(Math.max(0, ch.index - 80), ch.index + 160) };
}

const THEMES = {
  supplyGovernance: /产能|能效|内卷|产量调控|淘汰|置换|过剩|稳增长工作方案|节能降碳|超低排放/,
  industrySupport: /设备更新|以旧换新|两新|两重|产业|新质生产力|制造业|专项债|政策性金融工具|技术改造|数字经济|人工智能/,
  propertyCompetition: /民营|产权|市场准入|负面清单|公平竞争|统一大市场|营商环境|反垄断|涉企|知识产权/,
  capitalMarketInstitution: /资本市场|中长期资金|上市公司|分红|回购|投资者|退市|养老金|保险资金|证券|基金/,
};
export function classifyPolicy(title) {
  return Object.entries(THEMES).filter(([, re]) => re.test(title || "")).map(([k]) => k);
}

/** MOF 债务管理司 "YYYY年M月地方政府债券发行和债务余额情况" (compact text, 亿元). */
export function parseLocalBondMonthly(compact) {
  const h = /(\d{4})年(\d{1,2})月，全国发行新增(?:地方政府)?债券(\d+)亿元，其中一般债券(\d+)亿元、专项债券(\d+)亿元。全国发行再融资债券(\d+)亿元，其中一般债券(\d+)亿元、专项债券(\d+)亿元。(?:合计，)?全国发行地方政府债券(?:合计)?(\d+)亿元，其中一般债券(\d+)亿元、专项债券(\d+)亿元/.exec(compact);
  if (!h) return null;
  const n = (x) => Number(x);
  const out = { period: `${h[1]}-${h[2].padStart(2, "0")}`, unit: "亿元",
    month: { newTotal: n(h[3]), newGeneral: n(h[4]), newSpecial: n(h[5]), refinanceTotal: n(h[6]), refinanceSpecial: n(h[8]), total: n(h[9]), specialTotal: n(h[11]) } };
  const y = /1-\d{1,2}月，全国发行新增(?:地方政府)?债券(\d+)亿元，其中一般债券(\d+)亿元、专项债券(\d+)亿元。全国发行再融资债券(\d+)亿元，其中一般债券(\d+)亿元、专项债券(\d+)亿元/.exec(compact);
  if (y) out.ytd = { newTotal: n(y[1]), newSpecial: n(y[3]), refinanceTotal: n(y[4]), refinanceSpecial: n(y[6]) };
  const b = /月末，全国地方政府债务余额(\d+)亿元。其中，一般债务(\d+)亿元，专项债务(\d+)亿元/.exec(compact);
  if (b) out.balance = { total: n(b[1]), general: n(b[2]), special: n(b[3]) };
  const l = /全国地方政府债务限额为(\d+(?:\.\d+)?)亿元，其中一般债务限额(\d+(?:\.\d+)?)亿元，专项债务限额(\d+(?:\.\d+)?)亿元/.exec(compact);
  if (l) out.limit = { total: n(l[1]), general: n(l[2]), special: n(l[3]) };
  const r = /平均发行利率(\d+(?:\.\d+)?)%，其中一般债券(\d+(?:\.\d+)?)%[，、]专项债券(\d+(?:\.\d+)?)%/.exec(compact);
  if (r) out.month.specialRatePct = n(r[3]);
  return out;
}

/** PBC monthly tool table: structural rows (PSL, other structural tools), 亿元 with original signs. */
export function parseToolRows(spaced) {
  const row = (label) => { const m = new RegExp(`${label} (\\S+) (\\S+) (\\S+)`).exec(spaced); return m ? m.slice(1).map((x) => (/^-?\d+(?:\.\d+)?$/.test(x) ? Number(x) : x)) : null; };
  const out = {};
  for (const [k, label] of [["psl", "抵押补充贷款（PSL）"], ["otherStructural", "其他结构性货币政策工具"], ["mlf", "中期借贷便利（MLF）"]]) {
    const r = row(label.replace(/[()（）]/g, (c) => "\\" + c));
    if (r) out[k] = { injection: r[0], withdrawal: r[1], netInjection: r[2] };
  }
  return out;
}

/** Policy-finance tool facts in a release body: amount sentences only (亿元/万亿元), kept verbatim. */
export function extractPolicyFinanceFacts(compact) {
  const facts = [];
  for (const sentence of compact.split(/[。；！？|]/)) {
    if (sentence.length > 240 || !/新型政策性金融工具|政策性开发性金融工具|政策性金融工具/.test(sentence)) continue;
    const amounts = [...sentence.matchAll(/(\d+(?:\.\d+)?)(万亿元|亿元)/g)].map((m) => Number(m[1]) * (m[2] === "万亿元" ? 10000 : 1));
    if (!amounts.length || /首页|登录|无障碍/.test(sentence)) continue;
    facts.push({ sentence: sentence + "。", amounts, unit: "亿元" });
    if (facts.length >= 6) break;
  }
  return facts;
}

const BODY = {
  supplyGovernance: /产能|内卷式竞争|产量调控|能效标杆|淘汰落后|产能置换/g,
  industrySupport: /设备更新|以旧换新|专项债|超长期特别国债|政策性金融工具|产业链|技术改造/g,
  propertyCompetition: /民营经济|产权保护|市场准入|公平竞争|统一大市场|涉企/g,
  capitalMarketInstitution: /中长期资金|上市公司|分红|回购|投资者保护|退市|资本市场/g,
};
/** Body check: theme counted when its keywords appear ≥3 times. Cheap recall aid, not a judgement. */
export function classifyBody(compact) {
  return Object.entries(BODY).filter(([, re]) => (compact.match(re) || []).length >= 3).map(([k]) => k);
}
