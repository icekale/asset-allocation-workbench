#!/usr/bin/env node
// Evidence for the judgement items (F09 F10 P03A P03B P04A P04B P02E). Collects official/BIS facts only;
// it never scores. Output: app/data/macro-rating-judgement-evidence.json (merged across runs).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as P from "../lib/rating-evidence-parse.mjs";
import { classifyPolicy, classifyBody, parseLeverageReport, parseToolTable, parseToolRows, parseRrrNotice, parseLocalBondMonthly, extractPolicyFinanceFacts } from "../lib/macro-rating-judgement-parse.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const output = path.resolve(root, arg("output", "app/data/macro-rating-judgement-evidence.json"));
const cacheDir = path.join(root, "output", "rating-evidence-cache");
fs.mkdirSync(cacheDir, { recursive: true });
const key = (url) => path.join(cacheDir, url.replace(/[^a-zA-Z0-9]+/g, "_").slice(-150));
function get(url, { cache = false, min = 500 } = {}) {
  if (cache && fs.existsSync(key(url))) return fs.readFileSync(key(url), "utf8");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const body = execFileSync("curl", ["-fL", "--max-time", "40", "-sS", "-A", "Mozilla/5.0 (compatible; aaw-rating-evidence/1.0)", url], { maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
      if (body.length > min) { if (cache) fs.writeFileSync(key(url), body); return body; }
    } catch { /* retry */ }
  }
  return null;
}
const pubDate = (html) => /<meta\s+name="PubDate"\s+content="(\d{4}-\d{2}-\d{2})/.exec(html || "")?.[1] ?? null;
const ev = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : {};
const log = [];
ev.generatedAt = new Date().toISOString();
ev.sourcePolicy = "官方/国际组织原始发布；仅收集证据，不打分。建议值由 lib/macro-rating-suggest.mjs 按既有评分标准生成，须用户确认。";

// ---- CNBS (NIFD) quarterly macro leverage reports (nifd.cn reachable from DMIT) ----
ev.cnbs = ev.cnbs || {};
for (let page = 1; page <= Number(arg("nifdPages", 12)); page += 1) {
  const html = get(`http://www.nifd.cn/SeriesReport/Index?id=2&pageIndex=${page}`);
  if (!html) { log.push(`nifd list ${page} unreachable`); break; }
  const items = [...html.matchAll(/href="\/SeriesReport\/Details\/(\d+)"[\s\S]*?<h4>([^<]*)<\/h4>/g)];
  for (const [, id, title] of items) {
    if (!/宏观杠杆率报告/.test(title)) continue;
    const url = `http://www.nifd.cn/SeriesReport/Details/${id}`;
    if (Object.values(ev.cnbs).some((r) => r.sourceUrl === url)) continue;
    const detail = get(url, { cache: true });
    const pdf = detail && /(\/Uploads\/SeriesReport\/[^"]+\.pdf)/.exec(detail);
    const date = detail && /(\d{4})年(\d{2})月(\d{2})日/.exec(P.pageText(detail).compact);
    if (!pdf || !date) { log.push(`nifd report incomplete ${url}`); continue; }
    const pdfUrl = "http://www.nifd.cn" + pdf[1];
    const file = key(pdfUrl);
    try {
      if (!fs.existsSync(file)) execFileSync("curl", ["-L", "--max-time", "120", "-sS", "-o", file, pdfUrl]);
      const r = parseLeverageReport(execFileSync("pdftotext", ["-layout", file, "-"], { maxBuffer: 64 << 20 }).toString("utf8"), title);
      if (r) ev.cnbs[r.period] = { ...r, title, sourceUrl: url, sourceDocumentUrl: pdfUrl, releaseDate: `${date[1]}-${date[2]}-${date[3]}` };
      else log.push(`nifd parse failed ${url}`);
    } catch (e) { log.push(`nifd pdf ${pdfUrl}: ${e.message.split("\n")[0]}`); }
  }
  if (Object.keys(ev.cnbs).length >= 6 && page >= 3) break;
}

// ---- BIS: China private non-financial DSR and credit-to-GDP gap (BIS publishes no CN household/NFC DSR split) ----
ev.bis = ev.bis || {};
for (const [name, url] of Object.entries({
  dsrPrivate: "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_DSR/1.0/Q.CN.P?startPeriod=2023&format=csv",
  creditGap: "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CREDIT_GAP/1.0/Q.CN.P.A.C?startPeriod=2023&format=csv",
})) {
  const csv = get(url, { min: 100 });
  if (!csv) { log.push(`bis ${name} unreachable`); continue; }
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const tp = cols.indexOf("TIME_PERIOD"), ov = cols.indexOf("OBS_VALUE");
  const rows = lines.map((l) => l.split(",")).filter((c) => c[ov] !== "").map((c) => ({ period: c[tp], value: Number(c[ov]) }));
  ev.bis[name] = { sourceUrl: url, retrievedAt: ev.generatedAt.slice(0, 10), originalPublisher: "Bank for International Settlements", unit: name === "creditGap" ? "百分点" : "%", rows };
}

// ---- Policy documents: State Council latest-policy feed + NDRC 两新 work updates; keyword classification ----
ev.policyDocs = ev.policyDocs || {};
{
  const feed = get("https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json");
  try {
    for (const d of JSON.parse(feed || "[]").slice(0, 400)) {
      const themes = classifyPolicy(d.TITLE);
      const recent = d.DOCRELPUBTIME >= new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
      if ((themes.length || recent && !ev.unthemedChecked?.[d.URL]) && !ev.policyDocs[d.URL]) ev.policyDocs[d.URL] = { title: d.TITLE, url: d.URL, releaseDate: d.DOCRELPUBTIME, publisher: "国务院/中国政府网", themes, matchedBy: themes.length ? "title" : null };
    }
  } catch (e) { log.push(`gov.cn feed: ${e.message}`); }
  const NDRC = "https://www.ndrc.gov.cn/xwdt/ztzl/tddgmsbgxhxfpyjhx/gzdt/";
  for (let p = 0; p < 3; p += 1) {
    const html = get(NDRC + (p ? `index_${p}.html` : ""));
    if (!html) { log.push(`ndrc 两新 list ${p} failed`); continue; }
    for (const m of html.matchAll(/href="\.\/(\d{6})\/t(\d{4})(\d{2})(\d{2})_\d+\.html"[^>]*title="([^"]+)"/g)) {
      const url = new URL(`./${m[0].match(/\.\/([^"]+)/)[1]}`, NDRC).href;
      ev.policyDocs[url] = { title: m[5], url, releaseDate: `${m[2]}-${m[3]}-${m[4]}`, publisher: "国家发展改革委（两新工作动态）", themes: [...new Set(["industrySupport", ...classifyPolicy(m[5])])], matchedBy: "source" };
    }
  }
}

// ---- MIIT columns (list is script-loaded: call the same jpaas "build/unit" endpoint the page uses) ----
const ymd = (mmdd) => { const now = new Date(); const y = now.getFullYear(); const d = `${y}-${mmdd}`; return d > now.toISOString().slice(0, 10) ? `${y - 1}-${mmdd}` : d; };
const addDoc = (d) => { if (!d.themes.length && ev.unthemedChecked?.[d.url]) return; const prior = ev.policyDocs[d.url]; ev.policyDocs[d.url] = { ...prior, ...d, themes: [...new Set([...(prior?.themes || []), ...d.themes])], matchedBy: prior?.matchedBy || d.matchedBy }; };
for (const [col, name] of [["https://www.miit.gov.cn/jgsj/ycls/wjfb/index.html", "工信部原材料司文件发布"], ["https://www.miit.gov.cn/zwgk/zcwj/wjfb/tz/index.html", "工信部通知"], ["https://www.miit.gov.cn/zwgk/zcwj/wjfb/yj/index.html", "工信部意见"]]) {
  const page = get(col);
  const q = page && [...page.matchAll(/queryData="(\{[^"]+\})"/g)].map((m) => JSON.parse(m[1].replace(/'/g, '"'))).find((x) => /list|右侧内容/.test(x.tagId));
  if (!q) { log.push(`miit column unreadable ${col}`); continue; }
  const api = "https://www.miit.gov.cn/api-gateway/jpaas-publish-server/front/page/build/unit?" + new URLSearchParams(q).toString();
  let html = "";
  try { html = JSON.parse(get(api, { min: 50 }) || "{}")?.data?.html || ""; } catch { /* below */ }
  const items = [...html.matchAll(/href="([^"]+\.html)"[^>]*title="([^"]+)"[\s\S]*?(\d{4}-\d{2}-\d{2})/g)];
  if (!items.length) log.push(`miit api empty ${col}`);
  for (const [, href, title, date] of items) {
    const themes = classifyPolicy(title);
    if (ev.policyDocs[new URL(href, "https://www.miit.gov.cn").href]) continue;
    addDoc({ title, url: new URL(href, "https://www.miit.gov.cn").href, releaseDate: date, publisher: name, themes, matchedBy: themes.length ? "title" : null });
  }
}

// ---- CSRC (reachable from DMIT): portal homepage (MM-DD dates) + rule/announcement lists ----
for (const url of ["https://www.csrc.gov.cn/csrc/c106256/common_list.shtml", "https://www.csrc.gov.cn/csrc/c101953/common_list.shtml", "https://www.csrc.gov.cn/csrc/c101954/common_list.shtml", "https://www.csrc.gov.cn/csrc/c100028/common_list.shtml"]) {
  const html = get(url);
  if (!html) { log.push(`csrc unreachable ${url}`); continue; }
  let n = 0;
  for (const m of html.matchAll(/href="(\/csrc\/[^"]+\/content\.shtml)"[^>]*>([^<]{4,160})<\/a>\s*(?:<[^>]+>\s*)*?(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})/g)) {
    const date = m[3].length === 5 ? ymd(m[3]) : m[3];
    if (ev.policyDocs["https://www.csrc.gov.cn" + m[1]]) continue;
    const themes = classifyPolicy(m[2]);
    addDoc({ title: m[2].trim(), url: "https://www.csrc.gov.cn" + m[1], releaseDate: date, publisher: "中国证监会", themes: themes.length ? themes : /令|公告|办法|规定|指引|意见|决定/.test(m[2]) ? ["capitalMarketInstitution"] : [], matchedBy: themes.length ? "title" : /令|公告|办法|规定|指引|意见|决定/.test(m[2]) ? "source+title" : null });
    n += 1;
  }
  if (!n) log.push(`csrc list parsed 0 ${url}`);
}

// ---- Body keyword check for recent unclassified/title-only documents (cheap recall aid) ----
{
  const from = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  let fetched = 0;
  for (const d of Object.values(ev.policyDocs).filter((x) => x.releaseDate >= from && !x.bodyChecked).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))) {
    if (fetched >= Number(arg("bodyLimit", 80))) break;
    const html = get(d.url, { cache: true });
    fetched += 1;
    d.bodyChecked = true;
    if (!html) continue;
    const body = P.pageText(html).compact;
    const bodyThemes = classifyBody(body);
    const added = bodyThemes.filter((t) => !d.themes.includes(t));
    if (added.length) { d.themes = [...d.themes, ...added]; d.matchedBy = d.matchedBy ? `${d.matchedBy}+body` : "body"; }
    const facts = extractPolicyFinanceFacts(body);
    if (facts.length) d.policyFinanceFacts = facts;
  }
  ev.unthemedChecked = ev.unthemedChecked || {};
  for (const [k, d] of Object.entries(ev.policyDocs)) if (!d.themes.length && (d.bodyChecked || d.releaseDate < from)) { if (d.bodyChecked) ev.unthemedChecked[k] = d.releaseDate; delete ev.policyDocs[k]; }
}

// ---- Special bonds: MOF 债务管理司 monthly local-government bond issuance (+ legacy 预算司 list for prior year) ----
ev.localBonds = ev.localBonds || {};
for (const base of ["https://zwgls.mof.gov.cn/tjsj/", "https://yss.mof.gov.cn/zhuantilanmu/dfzgl/sjtj/"]) {
  for (let p = 0; p < 2; p += 1) {
    const html = get(base + (p ? `index_${p}.htm` : ""));
    if (!html) { log.push(`mof bond list unreachable ${base} ${p}`); continue; }
    for (const m of html.matchAll(/href="\.\/(\d{6}\/t\d{8}_\d+\.htm)"[^>]*title="(\d{4})年(\d{1,2})月地方政府债券发行和债务余额情况"/g)) {
      const period = `${m[2]}-${m[3].padStart(2, "0")}`;
      if (ev.localBonds[period]) continue;
      const url = base + m[1];
      const page = get(url, { cache: true });
      const r = page && parseLocalBondMonthly(P.pageText(page).compact);
      if (r) ev.localBonds[period] = { ...r, sourceUrl: url, releaseDate: `${m[1].slice(8, 12)}-${m[1].slice(12, 14)}-${m[1].slice(14, 16)}`, originalPublisher: "财政部" };
      else log.push(`mof bond parse failed ${url}`);
    }
  }
}

// ---- Policy-finance tools: NDRC news releases mentioning the tools (amount sentences verbatim) ----
ev.policyFinance = ev.policyFinance || {};
{
  const N = "https://www.ndrc.gov.cn/xwdt/xwfb/";
  for (let p = 0; p < Number(arg("ndrcPages", 6)); p += 1) {
    const html = get(N + (p ? `index_${p}.html` : ""));
    if (!html) continue;
    for (const m of html.matchAll(/href="\.\/(\d{6})\/t(\d{4})(\d{2})(\d{2})_\d+\.html"[^>]*title="([^"]+)"/g)) {
      const url = `${N}${m[0].match(/\.\/([^"]+)/)[1]}`;
      if (ev.policyFinance[url]?.facts?.length || !/金融工具|新闻发布会|政策性|投资/.test(m[5])) continue;
      const page = get(url, { cache: true });
      const facts = page ? extractPolicyFinanceFacts(P.pageText(page).compact) : [];
      if (facts.length) ev.policyFinance[url] = { title: m[5], url, releaseDate: `${m[2]}-${m[3]}-${m[4]}`, publisher: "国家发展改革委", facts };
    }
  }
  try {
    for (const d of JSON.parse(get("https://www.gov.cn/yaowen/liebiao/YAOWENLIEBIAO.json") || "[]").slice(0, 600)) {
      if (!/政策性金融工具|政策性开发性金融/.test(d.TITLE) || ev.policyFinance[d.URL]?.facts?.length) continue;
      const page = get(d.URL, { cache: true });
      const facts = page ? extractPolicyFinanceFacts(P.pageText(page).compact) : [];
      ev.policyFinance[d.URL] = { title: d.TITLE, url: d.URL, releaseDate: d.DOCRELPUBTIME, publisher: "中国政府网要闻（转载需看原发布方）", facts };
    }
  } catch (e) { log.push(`gov.cn yaowen: ${e.message}`); }
  for (const d of Object.values(ev.policyDocs)) if (d.policyFinanceFacts && !ev.policyFinance[d.url]) ev.policyFinance[d.url] = { title: d.title, url: d.url, releaseDate: d.releaseDate, publisher: d.publisher, facts: d.policyFinanceFacts };
}

// ---- P02E: PBC monthly tool tables + RRR notices ----
ev.toolTables = ev.toolTables || {};
{
  const T = "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/5727710/";
  const list = get(T + "index.html");
  const links = list ? [...list.matchAll(/href="([^"]*5727710\/\d+\/index\.html)"[^>]*title="(\d{4})年(\d{1,2})月中央银行各项工具流动性投放情况"/g)] : [];
  if (!list) log.push("pbc tool table list unreachable");
  for (const [, href, y, m] of links.slice(0, 15)) {
    const period = `${y}-${m.padStart(2, "0")}`, url = new URL(href, T).href;
    if (ev.toolTables[period]?.sourceUrl === url && ev.toolTables[period].structural) continue;
    const html = get(url, { cache: true });
    const row = html && parseToolTable(P.pageText(html).spaced);
    const releaseDate = pubDate(html);
    if (!row || !releaseDate) { log.push(`tool table incomplete ${url}`); continue; }
    ev.toolTables[period] = { period, title: `${period}中央银行各项工具流动性投放情况`, ...row, structural: parseToolRows(P.pageText(html).spaced), sourceUrl: url, releaseDate };
  }
}
ev.rrrNotices = ev.rrrNotices || {};
{
  const N = "https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/";
  let scanned = 0, oldest = null;
  for (let p = 1; p <= Number(arg("newsPages", 30)); p += 1) {
    const html = get(p === 1 ? N + "index.html" : `${N}11040-${p}.html`);
    if (!html) { log.push(`pbc news list ${p} failed`); continue; }
    for (const m of html.matchAll(/href="([^"]*113469\/(\d{8})\d+\/index\.html)"[^>]*title="([^"]+)"/g)) {
      scanned += 1; oldest = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}`;
      if (!/存款准备金率|降准/.test(m[3])) continue;
      const url = new URL(m[1], N).href;
      if (ev.rrrNotices[url]) continue;
      const page = get(url, { cache: true });
      const parsed = page ? parseRrrNotice(P.pageText(page).compact) : null;
      ev.rrrNotices[url] = { url, title: m[3], releaseDate: pubDate(page) || oldest, ...(parsed || { unparsed: true }) };
    }
    if (oldest && oldest < `${new Date().getFullYear() - 1}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`) break;
  }
  ev.rrrNoticeScan = { listUrl: N + "index.html", scannedItems: scanned, oldestDate: oldest, at: ev.generatedAt.slice(0, 10) };
}

ev.log = log;
fs.writeFileSync(output + ".tmp", JSON.stringify(ev, null, 1) + "\n");
fs.renameSync(output + ".tmp", output);
console.log(JSON.stringify({ cnbs: Object.keys(ev.cnbs).sort().at(-1) ?? null, bis: Object.fromEntries(Object.entries(ev.bis).map(([k, v]) => [k, v.rows.at(-1)])),
  policyDocs: Object.keys(ev.policyDocs).length, byPublisher: Object.values(ev.policyDocs).reduce((a, d) => ({ ...a, [d.publisher]: (a[d.publisher] || 0) + 1 }), {}), bodyMatched: Object.values(ev.policyDocs).filter((d) => /body/.test(d.matchedBy || "")).length, localBonds: Object.keys(ev.localBonds).sort().at(-1) ?? null, localBondMonths: Object.keys(ev.localBonds).length, policyFinance: Object.keys(ev.policyFinance).length, toolTables: Object.keys(ev.toolTables).sort().at(-1) ?? null, rrrNotices: Object.keys(ev.rrrNotices).length, rrrScan: ev.rrrNoticeScan, problems: log }));
