// Parsers for judgement-item evidence. Pure functions; no scoring.
const CN_Q = { 一: 1, 二: 2, 三: 3, 四: 4 };

/** NIFD quarterly macro leverage report (pdftotext). Sector ratios: previous quarter → current quarter. */
export function parseLeverageReport(text, title = "") {
  const flat = text.replace(/\s+/g, "");
  const q = /(\d{4})年([一二三四])季度宏观杠杆率/.exec(title + flat);
  if (!q) return null;
  const pick = (label) => {
    // Older NIFD PDFs use 提高至/降低至; newer use 上升至/下降至. "从…的" may be 二季度的 / 2024年末的.
    const m = new RegExp(`${label}(?:部门)?杠杆率(上升|下降)(\\d+(?:\\.\\d+)?)个百分点，从[^的%]{0,12}的(\\d+(?:\\.\\d+)?)%(?:上升|下降|提高|降低)至(\\d+(?:\\.\\d+)?)%`).exec(flat);
    return m ? { change: (m[1] === "下降" ? -1 : 1) * Number(m[2]), previous: Number(m[3]), value: Number(m[4]) } : null;
  };
  const household = pick("居民"), corporate = pick("非金融企业"), government = pick("政府"), macro = pick("宏观");
  if (!household || !corporate) return null;
  const debt = (label) => {
    const both = /居民和企业部门债务同比分别增长(-?\d+(?:\.\d+)?)%和(-?\d+(?:\.\d+)?)%/.exec(flat);
    if (both) return Number(label === "居民" ? both[1] : both[2]);
    const m = new RegExp(`${label}部门债务同比(?:增长|增速为)(-?\\d+(?:\\.\\d+)?)%`).exec(flat);
    return m ? Number(m[1]) : null;
  };
  return { period: `${q[1]}-Q${CN_Q[q[2]]}`, household, corporate, government, macro, householdDebtGrowth: debt("居民"), corporateDebtGrowth: debt("企业") };
}

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
  for (const sentence of compact.split(/[。；！？]|获悉[，,]|电[（(]记者[^）)]+[）)]/)) {
    let clean = sentence.trim();
    // Drop leading page chrome that stuck to the first sentence.
    clean = clean.replace(/^.*?来源：新华网/, "").replace(/^.*?分享到：/, "").replace(/^字体：小中大/, "").trim();
    if (clean.length < 12 || clean.length > 220) continue;
    if (!/新型政策性金融工具|政策性开发性金融工具|政策性金融工具/.test(clean)) continue;
    if (/首页|登录|无障碍|字体|分享到|责任编辑|来源：|新华网>>|正文20/.test(clean)) continue;
    const amounts = [...clean.matchAll(/(\d+(?:\.\d+)?)(万亿元|亿元)/g)].map((m) => Number(m[1]) * (m[2] === "万亿元" ? 10000 : 1));
    if (!amounts.length) continue;
    // Prefer deployment sentences over annual-quota restatements alone.
    facts.push({ sentence: clean + "。", amounts, unit: "亿元", isQuotaRestate: /政府工作报告|发行新型政策性金融工具\d/.test(clean) && !/投放|落地/.test(clean) });
    if (facts.length >= 8) break;
  }
  return facts.sort((a, b) => Number(a.isQuotaRestate) - Number(b.isQuotaRestate));
}

/** MOF / press text → special-bond use / issuance-progress / disbursement statements (亿元). */
export function parseSpecialBondUseStatements(compact, { sourceUrl, releaseDate, publisher }) {
  const out = [];
  const push = (kind, sentence, fields) => out.push({ kind, sentence: sentence + "。", ...fields, sourceUrl, releaseDate, publisher });
  const yi = (n, u) => Number(n) * (u === "万亿元" ? 10000 : 1);
  for (const sentence of compact.split(/[。；]/)) {
    const s = sentence.trim();
    if (s.length < 18 || s.length > 320 || !/专项债|专项债券/.test(s)) continue;
    let m;
    // Explicit disbursement / use amounts (拨付) — closest official proxy to "use".
    if ((m = /拨付(?:新增)?专项债券(?:资金)?(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /专项债券(?:资金)?拨付(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))) {
      const isSwap = /置换|隐性债务/.test(s);
      push(isSwap ? "disbursement-swap" : "disbursement", s, { disbursedYi: yi(m[1], m[2]), isSwap });
    }
    if ((m = /(?:上半年|1-\d月|一季度)?[，,]?(?:各地累计|全国)?(?:共)?发行新增专项债券(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /新增专项债券发行(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /已发行(?:\d{4}年)?新增专项债券(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /发行新增专项债券(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /全国发行新增专项债(?:券)?(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /全国新增专项债发行(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /新增专项债券方面[，,]?.{0,40}(?:共)?发行(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))
      || (m = /新增专项债(?:券)?发行(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))) {
      const issued = yi(m[1], m[2]);
      const prog = /(?:发行进度|完成全年限额的|完成)(\d+(?:\.\d+)?)%/.exec(s);
      const projects = /支持建设项目超?(?:过)?(\d+(?:\.\d+)?)万个/.exec(s) || /支持建设项目超?(?:过)?(\d+)个/.exec(s);
      const capital = /用作?项目资本金超?(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s) || /用于项目资本金超?(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s);
      push("issuance", s, { issuedYi: issued, progressPct: prog ? Number(prog[1]) : null,
        projectsWan: projects ? (projects[0].includes("万") ? Number(projects[1]) : Number(projects[1]) / 10000) : null,
        capitalYi: capital ? yi(capital[1], capital[2]) : null });
    }
    if (/加快.*拨付|拨付使用|形成实物工作量|穿透式监管|扫描式.*核查|按旬通报.*拨付|资金使用成效/.test(s) && /专项债/.test(s)) push("use-guidance", s, {});
    if (/截至(\d{1,2})月[末底]/.test(s) && /新增专项债/.test(s)) {
      const mm = /截至(\d{1,2})月[末底][，,]?(?:发行)?新增专项债券(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s)
        || /截至(\d{1,2})月[末底][，,]?全国已发行(?:\d{4}年)?新增专项债券(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s);
      if (mm) {
        const projects = /支持建设项目超?(?:过)?(\d+(?:\.\d+)?)万个/.exec(s) || /支持建设项目超?(?:过)?(\d+)个/.exec(s);
        push("issuance-asof", s, { asOfMonth: Number(mm[1]), issuedYi: yi(mm[2], mm[3]),
          projectsWan: projects ? (projects[0].includes("万") ? Number(projects[1]) : Number(projects[1]) / 10000) : null });
      }
    }
    // Calendar-date as-of (e.g. 截至9月20日…发行3.1万亿元，完成…70%).
    if ((m = /截至(\d{1,2})月(\d{1,2})日[，,]?全国新增专项债(?:券)?发行(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(s))) {
      const prog = /完成(?:全年限额的)?(\d+(?:\.\d+)?)%/.exec(s);
      push("issuance-asof-date", s, { asOfMonth: Number(m[1]), asOfDay: Number(m[2]), issuedYi: yi(m[3], m[4]), progressPct: prog ? Number(prog[1]) : null });
    }
  }
  return out;
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

/** Government Work Report full text → annual targets (亿元). */
export function parseAnnualTargets(compact) {
  const n = (m, unit) => (m ? Number(m[1]) * (unit === "万亿元" || m[2] === "万亿元" ? 10000 : 1) : null);
  const sp = /拟安排地方政府专项债券(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(compact);
  const pf = /发行新型政策性金融工具(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(compact);
  const ul = /拟发行超长期特别国债(\d+(?:\.\d+)?)(万亿元|亿元)/.exec(compact);
  const out = { specialBondQuota: n(sp), policyFinanceToolQuota: n(pf), ultraLongSpecialTreasury: n(ul) };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/** Generic news-list links (t20YYMMDD_ / content.html) with titles; dates from URL or nearby text. */
export function parseNewsList(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a[^>]*href="([^"]+?(?:t(\d{8})_\d+\.html|content\.html))"[^>]*>([\s\S]{4,600}?)<\/a>/g)) {
    const text = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const title = text.replace(/\s*20\d\d-\d\d-\d\d\s*$/, "").slice(0, 120);
    const d = m[2] ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}` : (/20\d\d-\d\d-\d\d/.exec(text)?.[0] ?? null);
    let url; try { url = new URL(m[1], base).href; } catch { continue; }
    if (title.length >= 6 && !out.some((x) => x.url === url)) out.push({ url, title, date: d });
  }
  return out;
}

/** Attachment links in a document page. */
export function attachmentLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/href="([^"]+\.(pdf|docx?|wps|ofd))"/gi)) {
    try { const url = new URL(m[1], base).href; if (!out.includes(url)) out.push(url); } catch { /* skip */ }
  }
  return out.slice(0, 5);
}

/**
 * Best-available periodic special-bond series (evidence only). Monthly: MOF 债务管理司 new-special issuance (YTD) and
 * quota completion. Periodic: official disbursement (拨付) / as-of points from MOF press statements. No official monthly
 * national "use" series exists; disbursement points are sparse and labelled as such.
 */
export function buildSpecialBondSeries(localBonds = {}, specialBondUse = {}, quotaYi = null) {
  const rows = {};
  for (const [period, r] of Object.entries(localBonds)) {
    const ytd = r?.ytd?.newSpecial;
    if (!Number.isFinite(ytd)) continue;
    rows[period] = { period, newSpecialMonth: r.month?.newSpecial ?? null, newSpecialYtd: ytd,
      quotaPct: quotaYi && period.startsWith(String(new Date().getFullYear())) ? +(ytd / quotaYi * 100).toFixed(1) : null,
      issuanceSource: r.sourceUrl, disbursedYtd: null, disbursedSwapYtd: null, disbursementSource: null };
  }
  const qEnd = (s, rel) => /一季度/.test(s) ? `${rel.slice(0, 4)}-03` : /上半年/.test(s) ? `${rel.slice(0, 4)}-06` : /前三季度/.test(s) ? `${rel.slice(0, 4)}-09` : null;
  for (const doc of Object.values(specialBondUse)) {
    for (const st of doc?.statements || []) {
      if (!st.kind?.startsWith("disbursement") || !st.releaseDate) continue;
      const m = /(\d{1,2})月[末底]/.exec(st.sentence);
      const period = m ? `${st.releaseDate.slice(0, 4)}-${m[1].padStart(2, "0")}` : (qEnd(st.sentence, st.releaseDate) || qEnd(doc.publisher || "", st.releaseDate));
      if (!period) continue;
      const row = rows[period] ||= { period, newSpecialMonth: null, newSpecialYtd: null, quotaPct: null, issuanceSource: null, disbursedYtd: null, disbursedSwapYtd: null, disbursementSource: null };
      row[st.isSwap ? "disbursedSwapYtd" : "disbursedYtd"] = st.disbursedYi;
      row.disbursementSource = st.sourceUrl || doc.url;
    }
  }
  for (const r of Object.values(rows)) r.disbursedToIssuedPct = r.disbursedYtd && r.newSpecialYtd ? +(r.disbursedYtd / r.newSpecialYtd * 100).toFixed(1) : null;
  return { basis: "发行=财政部债务管理司月度地方债数据；拨付=财政部发布会披露的时点数（稀疏）；无全国月度「使用」官方序列", rows: Object.values(rows).sort((a, b) => a.period.localeCompare(b.period)) };
}
