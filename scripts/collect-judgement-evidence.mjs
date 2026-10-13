#!/usr/bin/env node
// Evidence for the judgement items (F09 F10 P03A P03B P04A P04B P02E). Collects official/BIS facts only;
// it never scores. Output: app/data/macro-rating-judgement-evidence.json (merged across runs).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as P from "../lib/rating-evidence-parse.mjs";
import { classifyPolicy, classifyBody, parseLeverageReport, parseToolTable, parseToolRows, parseRrrNotice, parseLocalBondMonthly, extractPolicyFinanceFacts, parseAnnualTargets, parseNewsList, attachmentLinks, parseSpecialBondUseStatements } from "../lib/macro-rating-judgement-parse.mjs";

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

// Headless browser fallback for JS-gated public pages (DMIT: /opt/aaw-browser). Low rate; no captcha/login handling.
let browserCalls = 0;
function browserGet(url, via) {
  const file = key("browser_" + url);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 20 * 3600e3) return fs.readFileSync(file, "utf8");
  if (browserCalls >= Number(arg("browserLimit", 25))) return null;
  browserCalls += 1;
  try {
    execFileSync("sleep", ["2"]);
    const html = execFileSync(process.execPath, [path.join(root, "scripts/browser-fetch.mjs"), url, "3500", ...(via ? [`--via=${via}`] : [])], { maxBuffer: 64 << 20, timeout: 120000, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    if (/<!-- status:(200|304)/.test(html.slice(0, 200)) && html.length > 3000) { fs.writeFileSync(file, html); return html; }
  } catch { /* unavailable or blocked */ }
  return null;
}
const fetchAny = (url) => get(url, { cache: true }) || browserGet(url);
// Attachment text (PDF/DOC/DOCX/WPS) for classification only; size-capped.
let attachmentCalls = 0;
function attachmentText(url) {
  const file = key(url);
  if (attachmentCalls >= Number(arg("attachLimit", 25)) && !fs.existsSync(file)) return "";
  try {
    if (!fs.existsSync(file)) { attachmentCalls += 1; execFileSync("curl", ["-fL", "--max-time", "60", "--max-filesize", "15000000", "-sS", "-A", "Mozilla/5.0", "-o", file, url], { stdio: "ignore" }); }
    const ext = url.split(".").pop().toLowerCase();
    const cmd = ext === "pdf" ? ["pdftotext", ["-l", "15", file, "-"]] : ext === "docx" ? ["unzip", ["-p", file, "word/document.xml"]] : ["catdoc", ["-d", "utf-8", file]];
    return execFileSync(cmd[0], cmd[1], { maxBuffer: 32 << 20, timeout: 60000, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  } catch { return ""; }
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

// ---- CSRC rule lists via the page's own searchList JSON (证监会令 / 证监会公告) ----
for (const [channel, name] of [["cd11df89f5894c1eac37ae37cc11e369", "证监会令"], ["625a2f95cc104c1d8b646f98d9f87470", "证监会公告"]]) {
  let rows = 0;
  for (let p = 1; p <= 2; p += 1) {
    const raw = get(`https://www.csrc.gov.cn/searchList/${channel}?_isAgg=true&_isJson=true&_pageSize=20&_template=index&_rangeTimeGte=&_channelName=&page=${p}`, { min: 100 });
    let data = null; try { data = JSON.parse(raw || "null")?.data; } catch { /* below */ }
    if (!data?.results) { log.push(`csrc ${name} json page ${p} failed`); break; }
    for (const r of data.results) {
      const url = "https:" + r.url.replace(/^https?:/, "");
      const body = (r.content || r.memo || "").replace(/\s+/g, "");
      const themes = [...new Set([...classifyPolicy(r.title), ...classifyBody(body), "capitalMarketInstitution"])];
      addDoc({ title: r.title, url, releaseDate: (r.publishedTimeStr || "").slice(0, 10), publisher: `中国证监会·${name}`, themes,
        matchedBy: "source+body", bodyChecked: true, attachments: (r.resList || []).filter((x) => x.type === "FILE").map((x) => ({ title: x.title, url: "https://www.csrc.gov.cn" + x.filePath })).slice(0, 5) });
      const doc = ev.policyDocs[url];
      if (doc && !doc.attachmentsChecked && body.length < 1500 && doc.attachments?.length) {
        const text = attachmentText(doc.attachments[0].url);
        doc.attachmentsChecked = true;
        if (text) { doc.attachmentTextChars = text.length; doc.themes = [...new Set([...doc.themes, ...classifyBody(text)])]; }
      }
      rows += 1;
    }
  }
  if (!rows) log.push(`csrc ${name} empty`);
}

// ---- CSRC (reachable from DMIT): portal homepage (MM-DD dates) + rule/announcement lists ----
for (const url of ["https://www.csrc.gov.cn/csrc/c106256/common_list.shtml"]) {
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
  for (const d of Object.values(ev.policyDocs).filter((x) => x.releaseDate >= from && (!x.bodyChecked || !x.attachmentsChecked && !/csrc/.test(x.url))).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))) {
    if (fetched >= Number(arg("bodyLimit", 80))) break;
    const html = get(d.url, { cache: true });
    fetched += 1;
    d.bodyChecked = true;
    if (!html) continue;
    d.attachmentsChecked = true;
    let body = P.pageText(html).compact;
    const atts = attachmentLinks(html, d.url);
    if (atts.length && (body.length < 1500 || !d.themes.length)) {
      const texts = atts.slice(0, 2).map(attachmentText).filter(Boolean);
      if (texts.length) { body += texts.join(""); d.attachmentTextChars = texts.join("").length; }
    }
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


// ---- Policy-finance tool amounts via official mirrors (Xinhua / bank pages) when original CDB articles are blocked ----
{
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/policy-finance-mirrors.json"), "utf8"));
  for (const item of cfg.items) {
    let got = null;
    for (const m of item.mirrors) {
      const html = get(m.url, { cache: true }) || (m.kind === "original" ? browserGet(m.url) : null);
      if (!html || html.length < 800) continue;
      const bankRe = item.bank === "国家开发银行" ? /国开|国家开发银行/ : item.bank === "中国进出口银行" ? /进银|进出口银行/ : /农发行|农业发展银行/;
      const facts = extractPolicyFinanceFacts(P.pageText(html).compact).filter((f) => !f.isQuotaRestate && bankRe.test(f.sentence));
      if (!facts.length) continue;
      const date = /<(?:meta[^>]+content|span)[^>]*>?\s*(\d{4})[-年](\d{1,2})[-月](\d{1,2})/.exec(html);
      const releaseDate = date ? `${date[1]}-${date[2].padStart(2,"0")}-${date[3].padStart(2,"0")}` : (item.releaseDate || null);
      got = { title: item.titleHint, url: m.url, originalUrl: item.originalUrl || null, releaseDate,
        publisher: m.publisher, bank: item.bank, facts, sourceKind: m.kind, mirrorOf: item.originalUrl || null };
      break;
    }
    if (got) {
      const key = got.url;
      // Always refresh configured mirror facts (parser/source improvements).
      ev.policyFinance[key] = got;
      for (const [k, d] of Object.entries(ev.policyFinance)) {
        if ((d.titleOnly || !d.facts?.length) && (d.bank === item.bank || d.publisher === item.bank) && /政策性金融工具|注资/.test(d.title || "")) {
          if (d.titleOnly || (got.facts?.length && !d.facts?.length && /金融工具/.test(d.title || ""))) delete ev.policyFinance[k];
        }
      }
    } else log.push(`policy-finance mirror miss ${item.bank}`);
  }
}

// ---- Special-bond use / issuance progress: MOF press conferences & fiscal reports (no monthly use series found) ----
ev.specialBondUse = ev.specialBondUse || {};
{
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/special-bond-use-sources.json"), "utf8"));
  // Also scan recent MOF 财政新闻 titles.
  const list = get("https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/");
  const extra = [];
  if (list) {
    for (const m of list.matchAll(/href="\.\/(\d{6}\/t\d{8}_\d+\.htm)"[^>]*title="([^"]+)"/g)) {
      if (/专项债|地方债|财政政策执行|财政收支情况新闻发布/.test(m[2])) extra.push({ url: "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/" + m[1], publisher: `财政部财政新闻·${m[2].slice(0, 40)}`, releaseDate: `${m[1].slice(8,12)}-${m[1].slice(12,14)}-${m[1].slice(14,16)}` });
    }
  } else log.push("mof news list unreachable");
  for (const src of [...cfg.items, ...extra.slice(0, 8)]) {
    // Always re-parse configured/list sources so disbursement / as-of patterns stay current.
    const html = get(src.url, { cache: true }) || browserGet(src.url);
    if (!html) { log.push(`special-bond-use unreachable ${src.url}`); continue; }
    const statements = parseSpecialBondUseStatements(P.pageText(html).compact, src);
    if (statements.length) ev.specialBondUse[src.url] = { ...src, statements };
  }
  if (cfg.ndrcNote) ev.specialBondUse.ndrcNote = cfg.ndrcNote;
  // Caixin: search for a national use series; local city series are not substitutes.
  try {
    const out = execFileSync(process.execPath, ["--experimental-strip-types", path.join(root, "scripts/caixin-fetch.mjs"), "search", "地方政府专项债券"], { cwd: root, maxBuffer: 4 << 20, timeout: 60000, env: process.env }).toString("utf8");
    const j = JSON.parse(out);
    const rows = j.series || [];
    const national = rows.filter((s) => /^(全国|中国)[:：]/.test(s.name) || (!/[:：]/.test(s.name) && /全国/.test(s.name)));
    const localOnly = rows.length > 0 && national.length === 0;
    ev.specialBondUse.caixinNote = { searched: "地方政府专项债券", hits: rows.length, nationalHits: national.length,
      sample: rows.slice(0, 3).map((s) => ({ id: s.series_id, name: s.name, source: s.source, frequency: s.frequency })),
      conclusion: localOnly ? "Caixin hits are local city fund income/expenditure lines, not a national special-bond use series" : (national.length ? "found candidate national series" : "no Caixin hits") };
  } catch (e) { log.push(`caixin special-bond search: ${e.message.split("\n")[0]}`); }
  // Alternate Caixin keywords for a national use/disbursement series (still often empty).
  if (!ev.specialBondUse.caixinNote || ev.specialBondUse.caixinNote.nationalHits === 0) {
    for (const q of ["专项债券拨付", "地方政府专项债券使用"]) {
      try {
        const out = execFileSync(process.execPath, ["--experimental-strip-types", path.join(root, "scripts/caixin-fetch.mjs"), "search", q], { cwd: root, maxBuffer: 4 << 20, timeout: 60000, env: process.env }).toString("utf8");
        const j = JSON.parse(out);
        const rows = j.series || [];
        const national = rows.filter((s) => /^(全国|中国)[:：]/.test(s.name) || (!/[:：]/.test(s.name) && /全国/.test(s.name)));
        if (national.length) {
          ev.specialBondUse.caixinNote = { searched: q, hits: rows.length, nationalHits: national.length,
            sample: national.slice(0, 3).map((s) => ({ id: s.series_id, name: s.name, source: s.source, frequency: s.frequency })),
            conclusion: `found candidate national series via "${q}"` };
          break;
        }
        if (!ev.specialBondUse.caixinAlt) ev.specialBondUse.caixinAlt = [];
        ev.specialBondUse.caixinAlt.push({ searched: q, hits: rows.length, nationalHits: 0 });
      } catch (e) { log.push(`caixin search ${q}: ${e.message.split("\n")[0]}`); }
    }
  }
  if (cfg.celmaNote) ev.specialBondUse.celmaNote = cfg.celmaNote;
}

// titleOnly / empty cleanup: drop stubs when a full mirror/original exists for the same bank
{
  const banksWithFull = new Set(Object.values(ev.policyFinance).filter((d) => d.facts?.length && (d.sourceKind === "repost" || d.sourceKind === "original")).map((d) => d.bank).filter(Boolean));
  for (const [k, d] of Object.entries(ev.policyFinance)) {
    const bank = d.bank || d.publisher;
    if (banksWithFull.has(bank) && (d.titleOnly || !d.facts?.length) && (d.sourceKind !== "repost" && d.sourceKind !== "original")) delete ev.policyFinance[k];
  }
}

// ---- Annual targets (quota denominators) from the Government Work Report full text ----
ev.annualTargets = ev.annualTargets || {};
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/annual-fiscal-targets-sources.json"), "utf8"));
  for (const [year, src] of Object.entries(cfg.years)) {
    if (ev.annualTargets[year]?.specialBondQuota) continue;
    const candidates = [{ url: src.url, publisher: src.publisher }, ...(src.mirrors || [])];
    let got = null;
    for (const c of candidates) {
      const html = get(c.url, { cache: true }) || browserGet(c.url);
      const t = html && parseAnnualTargets(P.pageText(html).compact);
      if (t) { got = { ...t, unit: "亿元", sourceUrl: c.url, publisher: c.publisher }; break; }
    }
    if (got) ev.annualTargets[year] = got;
    else log.push(`annual targets ${year} not parsed`);
  }
} catch (e) { log.push(`annual targets: ${e.message}`); }

// ---- Policy banks (CDB needs a real browser for its JS check; Exim/ADBC plain) ----
for (const [list, bank] of [["https://www.cdb.com.cn/xwzx/khdt/", "国家开发银行"], ["http://www.eximbank.gov.cn/", "中国进出口银行"], ["https://www.adbc.com.cn/n5/n15/index.html", "中国农业发展银行"]]) {
  const html = get(list) || browserGet(list);
  if (!html) { log.push(`${bank} list unreachable`); continue; }
  const items = parseNewsList(html, list).filter((x) => /政策性金融工具|金融工具|资本金|注资/.test(x.title));
  for (const it of items.slice(0, 8)) {
    if (ev.policyFinance[it.url]?.facts?.length) continue;
    const page = get(it.url, { cache: true }) || browserGet(it.url, list);
    if (!page) {
      const facts = extractPolicyFinanceFacts(it.title);
      log.push(`${bank} article blocked (list title kept) ${it.url}`);
      if (facts.length) ev.policyFinance[it.url] = { title: it.title, url: it.url, releaseDate: it.date, publisher: bank, facts, titleOnly: true };
      continue;
    }
    const text = P.pageText(page).compact;
    const facts = extractPolicyFinanceFacts(text);
    const date = it.date || /(20\d\d)[-年](\d{2})[-月](\d{2})/.exec(text)?.slice(1).join("-") || null;
    ev.policyFinance[it.url] = { title: it.title, url: it.url, releaseDate: date, publisher: bank, facts, capitalInjection: /注资/.test(it.title) };
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

// Final cleanup: drop empty/titleOnly stubs when a full mirror/original exists for the same bank
{
  const banksWithFull = new Set(Object.values(ev.policyFinance || {}).filter((d) => d.facts?.length && (d.sourceKind === "repost" || d.sourceKind === "original")).map((d) => d.bank).filter(Boolean));
  for (const [k, d] of Object.entries(ev.policyFinance || {})) {
    const bank = d.bank || (/国家开发银行|中国进出口银行|中国农业发展银行/.exec(d.publisher || "")?.[0]);
    if (banksWithFull.has(bank) && (d.titleOnly || !d.facts?.length) && d.sourceKind !== "repost" && d.sourceKind !== "original") delete ev.policyFinance[k];
  }
}

ev.log = log;
fs.writeFileSync(output + ".tmp", JSON.stringify(ev, null, 1) + "\n");
fs.renameSync(output + ".tmp", output);
console.log(JSON.stringify({ cnbs: Object.keys(ev.cnbs).sort().at(-1) ?? null, bis: Object.fromEntries(Object.entries(ev.bis).map(([k, v]) => [k, v.rows.at(-1)])),
  policyDocs: Object.keys(ev.policyDocs).length, byPublisher: Object.values(ev.policyDocs).reduce((a, d) => ({ ...a, [d.publisher]: (a[d.publisher] || 0) + 1 }), {}), bodyMatched: Object.values(ev.policyDocs).filter((d) => /body/.test(d.matchedBy || "")).length, localBonds: Object.keys(ev.localBonds).sort().at(-1) ?? null, localBondMonths: Object.keys(ev.localBonds).length, policyFinance: Object.keys(ev.policyFinance).length, policyFinanceWithFacts: Object.values(ev.policyFinance).filter((x) => x.facts?.length).length, policyFinanceReposts: Object.values(ev.policyFinance).filter((x) => x.sourceKind === "repost").length, specialBondUseSources: Object.keys(ev.specialBondUse || {}).filter((k) => k !== "caixinNote").length, annualTargets: ev.annualTargets, attachmentsRead: Object.values(ev.policyDocs).filter((d) => d.attachmentTextChars).length, browserCalls, toolTables: Object.keys(ev.toolTables).sort().at(-1) ?? null, rrrNotices: Object.keys(ev.rrrNotices).length, rrrScan: ev.rrrNoticeScan, problems: log }));
