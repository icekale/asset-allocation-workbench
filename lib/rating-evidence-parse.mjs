// Pure parsers for official release pages (NBS / MOF). Input: raw HTML. Output: plain numbers + text.
// Every parser returns null for a field it cannot find; callers must treat null as "no evidence".

export function pageText(raw) {
  const spaced = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ");
  return { spaced, compact: spaced.replace(/\s+/g, "") };
}

const signed = (verb, num) => {
  const v = Number(num);
  if (!Number.isFinite(v)) return null;
  return /下降|降低|减少|回落|下滑/.test(verb) ? -v : v;
};
const VERB = "(增长|下降|上涨|提高|降低|增加|减少)";
const NUM = "(\\d+(?:\\.\\d+)?)";
const grab = (text, re, map) => { const m = re.exec(text); return m ? map(m) : null; };

export function releaseDateOf(compact, url) {
  const m = /发布时间[：:](\d{4})-(\d{2})-(\d{2})/.exec(compact) || /(\d{4})\/(\d{2})\/(\d{2})\d{2}:\d{2}来源/.exec(compact);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const u = /\/t(\d{4})(\d{2})(\d{2})_\d+\.html?$/.exec(url || "");
  return u ? `${u[1]}-${u[2]}-${u[3]}` : null;
}

export function parsePress(compact) {
  return {
    unemployment: grab(compact, /(?<!—)\d+月份，全国城镇调查失业率为(\d+(?:\.\d+)?)%/, (m) => Number(m[1])),
    serviceRetailYtd: grab(compact, new RegExp(`其中服务零售额${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
    privateExRealEstateYtd: grab(compact, new RegExp(`扣除房地产开发的民间投资${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
  };
}

export function parseIndustrialValueAdded(compact) {
  return {
    monthYoy: grab(compact, new RegExp(`(?<!—)\\d+月份，规模以上工业增加值同比实际${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
    ytdYoy: grab(compact, new RegExp(`1—\\d+月份，规模以上工业增加值同比${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
  };
}

export function parseFixedInvestment(compact) {
  return {
    manufacturingYtd: grab(compact, new RegExp(`制造业投资${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
    infrastructureYtd: grab(compact, new RegExp(`基础设施投资(?:（[^）]*）)?同比${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
    infrastructureScopeNote: /基础设施投资包括电力、热力生产和供应业，燃气生产和供应业，水的生产和供应业/.test(compact) || /基础设施投资（口径详见附注/.test(compact),
  };
}

export function parseRealEstate(compact) {
  return {
    investmentYtd: grab(compact, new RegExp(`全国房地产开发投资\\d+(?:\\.\\d+)?亿元，同比${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
    salesAreaYtd: grab(compact, new RegExp(`新建商品房销售面积\\d+(?:\\.\\d+)?万平方米，同比${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
  };
}

export function parseRetail(compact) {
  const ytd = /1—\d+月份，商品零售额(\d+(?:\.\d+)?)亿元，同比(增长|下降)(\d+(?:\.\d+)?)%/.exec(compact);
  const month = /(?<![—\d])\d+月份，商品零售额(\d+(?:\.\d+)?)亿元，同比(增长|下降)(\d+(?:\.\d+)?)%/.exec(compact);
  return {
    goodsYtdAmount: ytd ? Number(ytd[1]) : null, goodsYtdYoy: ytd ? signed(ytd[2], ytd[3]) : null,
    goodsMonthAmount: month ? Number(month[1]) : null, goodsMonthYoy: month ? signed(month[2], month[3]) : null,
  };
}

/** PMI tables (seasonally adjusted). Returns { "YYYY-MM": { manufacturingPMI, manufacturingNewOrders, nonManufacturingActivity } } */
export function parsePmi(spaced) {
  const out = {};
  const section = (start, end) => { const i = spaced.indexOf(start); if (i < 0) return ""; const j = spaced.indexOf(end, i + start.length); return spaced.slice(i, j < 0 ? i + 4000 : j); };
  const rows = (text, cols) => [...text.matchAll(new RegExp(`(\\d{4}) 年 (\\d{1,2}) 月((?: \\d+(?:\\.\\d+)?){${cols}})`, "g"))]
    .map((m) => [`${m[1]}-${m[2].padStart(2, "0")}`, m[3].trim().split(" ").map(Number)]);
  for (const [p, v] of rows(section("表 1", "表 2"), 6)) out[p] = { ...out[p], manufacturingPMI: v[0], manufacturingNewOrders: v[2] };
  for (const [p, v] of rows(section("表 3", "表 4"), 6)) out[p] = { ...out[p], nonManufacturingActivity: v[0] };
  return out;
}

export const PROFIT_INDUSTRIES_PATTERN = /[\u4e00-\u9fa5、，（）]+/;
/** Industrial profit release: headline + quality + 41-industry table 3. */
export function parseProfit(spaced, compact) {
  const head = {
    ytdYoy: grab(compact, new RegExp(`利润总额\\d+(?:\\.\\d+)?亿元，同比${VERB}${NUM}%（按可比口径`), (m) => signed(m[1], m[2])),
    monthYoy: grab(compact, new RegExp(`(?<!—)\\d+月份，规模以上工业企业利润同比${VERB}${NUM}%`), (m) => signed(m[1], m[2])),
    profitMargin: grab(compact, /营业收入利润率为(\d+(?:\.\d+)?)%/, (m) => Number(m[1])),
    profitMarginYoyChange: grab(compact, new RegExp(`营业收入利润率为\\d+(?:\\.\\d+)?%，同比${VERB}${NUM}个百分点`), (m) => signed(m[1], m[2])),
    receivablesDays: grab(compact, /应收账款平均回收期为(\d+(?:\.\d+)?)天/, (m) => Number(m[1])),
    receivablesDaysYoyChange: grab(compact, new RegExp(`应收账款平均回收期为\\d+(?:\\.\\d+)?天，同比${VERB}${NUM}天`), (m) => signed(m[1], m[2])),
  };
  const majorText = grab(compact, /主要行业利润情况如下：([^。]+。)/, (m) => m[1]);
  const i = spaced.indexOf("表 3"); const j = i < 0 ? -1 : spaced.indexOf("注：", i);
  const table = i < 0 ? "" : spaced.slice(i, j < 0 ? i + 12000 : j);
  const tableTitle = grab(table, /表 3 (\d{4}) 年 1-(\d+) 月份规模以上工业企业主要财务指标（分行业）/, (m) => `表3　${m[1]}年1-${m[2]}月份规模以上工业企业主要财务指标（分行业）`);
  const industries = [];
  const body = table.replace(/^.*?（ % ） （亿元） （ % ） （亿元） （ % ）/, "");
  const re = /([\u4e00-\u9fa5、，（）]+?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?|（注 ?\d+ ?）)/g;
  for (const m of body.matchAll(re)) {
    const name = m[1].trim();
    if (name === "总计") continue;
    industries.push({ name, profit: m[6], profitYoy: m[7].replace(/\s+/g, "") });
  }
  return { ...head, majorText, tableTitle, industries };
}

/** MOF monthly fiscal release. Amounts in 亿元, yoy in %. */
export function parseFiscal(compact) {
  const g = new RegExp(`全国一般公共预算支出(\\d+)亿元，同比${VERB}${NUM}%`).exec(compact);
  const f = new RegExp(`全国政府性基金预算支出(\\d+)亿元，同比${VERB}${NUM}%`).exec(compact);
  return {
    generalExpenditure: g ? { amount: Number(g[1]), yoy: signed(g[2], g[3]) } : null,
    fundExpenditure: f ? { amount: Number(f[1]), yoy: signed(f[2], f[3]) } : null,
  };
}

export function parseCapacity(compact) {
  const m = /(\d{4})年(一|二|三|四)季度，?全国规模以上工业产能利用率为(\d+(?:\.\d+)?)%/.exec(compact)
    || /(\d{4})年(一|二|三|四)季度，?全国工业产能利用率为(\d+(?:\.\d+)?)%/.exec(compact);
  if (!m) return null;
  return { period: `${m[1]}-Q${"一二三四".indexOf(m[2]) + 1}`, value: Number(m[3]) };
}

/** GACC "Summary of Imports and Exports (In USD) B: Monthly". Amounts US$ million. */
export function parseCustomsSummary(spaced) {
  const rel = /(\d{4})\/(\d{2})\/(\d{2}) 1\.Summary of Imports and Exports/.exec(spaced) || /B：Monthly (\d{4})\/(\d{2})\/(\d{2})/.exec(spaced);
  const rows = {};
  const num = "(-?[\\d,]+(?:\\.\\d+)?)";
  const re = new RegExp(`(\\d{4})\\.(\\d{2})((?: ${num}){8})((?: -?\\d+(?:\\.\\d+)?){6})?`, "g");
  for (const m of spaced.matchAll(re)) {
    const a = m[3].trim().split(" ").map((x) => Number(x.replace(/,/g, "")));
    const g = m[m.length - 1] ? m[m.length - 1].trim().split(" ").map(Number) : null;
    rows[`${m[1]}-${m[2]}`] = { exportMonth: a[1], exportYtd: a[5], exportMonthYoy: g ? g[1] : null, exportYtdYoy: g ? g[4] : null };
  }
  return { releaseDate: rel ? `${rel[1]}-${rel[2]}-${rel[3]}` : null, rows };
}

/** PBC 社会融资规模存量统计表 (htm). Returns { "YYYY-MM": { totalStock, governmentBondStock } } in 万亿元. */
export function parseAfreStock(spaced) {
  if (!/社会融资规模存量统计表/.test(spaced)) return null;
  const months = [...spaced.matchAll(/(\d{4})\.(\d{1,2})(?= )/g)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}`).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
  const series = (label) => {
    const i = spaced.indexOf(label);
    if (i < 0) return [];
    const nums = spaced.slice(i + label.length, i + label.length + 400).match(/^(?: -?\d+(?:\.\d+)?)+/);
    if (!nums) return [];
    const v = nums[0].trim().split(" ").map(Number);
    return v.filter((_, k) => k % 2 === 0); // stock, growth pairs
  };
  const total = series("社会融资规模存量 AFRE(stock)"), gov = series("政府债券 Government bonds");
  const out = {};
  total.forEach((t, k) => { if (Number.isFinite(t) && Number.isFinite(gov[k])) out[months[k]] = { totalStock: t, governmentBondStock: gov[k] }; });
  return out;
}

/** PBC open-market announcement: 7-day reverse repo fixed rate. */
export function parseOmo(compact) {
  const d = /(\d{4})年(\d{1,2})月(\d{1,2})日中国人民银行以[^。]*?开展了[^。]*?7天期逆回购操作/.exec(compact);
  const r = /7天(\d+(?:\.\d+)?)%/.exec(compact);
  return d && r ? { date: `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`, rate: Number(r[1]) } : null;
}

/** Quarterly monetary policy report (pdftotext -layout output, pages split by \f): enterprise new-loan rate. */
export function parseMprLoanRate(layoutText) {
  const pages = layoutText.split("\f");
  for (let i = 0; i < pages.length; i += 1) {
    const h = /表\s*(\d+)\s+(\d{4})\s*年\s*(\d{1,2})\s*月新发放贷款加权平均利率情况\s*\n/.exec(pages[i]);
    if (!h) continue;
    const r = /企业贷款加权平均利率\s+(\d+\.\d+)/.exec(pages[i].slice(h.index));
    if (r) return { period: `${h[2]}-${h[3].padStart(2, "0")}`, value: Number(r[1]), table: `表${h[1]}，PDF第${i + 1}页` };
  }
  return null;
}
