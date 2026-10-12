#!/usr/bin/env node
// Evidence for the judgement items (F09 F10 P03A P03B P04A P04B P02E). Collects official/BIS facts only;
// it never scores. Output: app/data/macro-rating-judgement-evidence.json (merged across runs).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as P from "../lib/rating-evidence-parse.mjs";
import { classifyPolicy, parseLeverageReport, parseToolTable, parseRrrNotice } from "../lib/macro-rating-judgement-parse.mjs";

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
      const body = execFileSync("curl", ["-L", "--max-time", "40", "-sS", "-A", "Mozilla/5.0 (compatible; aaw-rating-evidence/1.0)", url], { maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
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
      if (themes.length) ev.policyDocs[d.URL] = { title: d.TITLE, url: d.URL, releaseDate: d.DOCRELPUBTIME, publisher: "国务院/中国政府网", themes };
    }
  } catch (e) { log.push(`gov.cn feed: ${e.message}`); }
  const NDRC = "https://www.ndrc.gov.cn/xwdt/ztzl/tddgmsbgxhxfpyjhx/gzdt/";
  for (let p = 0; p < 3; p += 1) {
    const html = get(NDRC + (p ? `index_${p}.html` : ""));
    if (!html) { log.push(`ndrc 两新 list ${p} failed`); continue; }
    for (const m of html.matchAll(/href="\.\/(\d{6})\/t(\d{4})(\d{2})(\d{2})_\d+\.html"[^>]*title="([^"]+)"/g)) {
      const url = new URL(`./${m[0].match(/\.\/([^"]+)/)[1]}`, NDRC).href;
      ev.policyDocs[url] = { title: m[5], url, releaseDate: `${m[2]}-${m[3]}-${m[4]}`, publisher: "国家发展改革委（两新工作动态）", themes: [...new Set(["industrySupport", ...classifyPolicy(m[5])])] };
    }
  }
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
    if (ev.toolTables[period]?.sourceUrl === url) continue;
    const html = get(url, { cache: true });
    const row = html && parseToolTable(P.pageText(html).spaced);
    const releaseDate = pubDate(html);
    if (!row || !releaseDate) { log.push(`tool table incomplete ${url}`); continue; }
    ev.toolTables[period] = { period, title: `${period}中央银行各项工具流动性投放情况`, ...row, sourceUrl: url, releaseDate };
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
  policyDocs: Object.keys(ev.policyDocs).length, toolTables: Object.keys(ev.toolTables).sort().at(-1) ?? null, rrrNotices: Object.keys(ev.rrrNotices).length, rrrScan: ev.rrrNoticeScan, problems: log }));
