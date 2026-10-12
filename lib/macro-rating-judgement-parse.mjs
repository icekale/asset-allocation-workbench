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
