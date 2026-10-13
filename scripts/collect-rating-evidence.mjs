#!/usr/bin/env node
// Collect official evidence used by the macro rating draft (NBS + MOF original pages only).
// Writes app/data/macro-rating-evidence.json (merged; older periods kept). Never touches rating files.
// Usage: node scripts/collect-rating-evidence.mjs [--pages=14] [--output=path]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as P from "../lib/rating-evidence-parse.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const output = path.resolve(root, arg("output", "app/data/macro-rating-evidence.json"));
const pages = Number(arg("pages", 14));
const cacheDir = path.join(root, "output", "rating-evidence-cache");
fs.mkdirSync(cacheDir, { recursive: true });

function get(url, { cache = false } = {}) {
  const key = path.join(cacheDir, url.replace(/[^a-zA-Z0-9]+/g, "_").slice(-150));
  if (cache && fs.existsSync(key)) return fs.readFileSync(key, "utf8");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const body = execFileSync("curl", ["-L", "--max-time", "45", "-sS", "-A", "Mozilla/5.0 (compatible; aaw-rating-evidence/1.0)", url], { maxBuffer: 32 << 20 }).toString("utf8");
      if (body.length > 2000 && !body.includes("Please enable JavaScript and refresh")) {
        if (cache) fs.writeFileSync(key, body);
        return body;
      }
    } catch { /* retry */ }
    execFileSync("sleep", [String(1 + attempt)]);
  }
  return null;
}
const links = (html, base, re) => {
  const out = [];
  for (const m of html.matchAll(/href="([^"]+?t20\d{6}_\d+\.html?)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = m[2].replace(/<[^>]+>|\s+/g, "");
    if (!re.test(title)) continue;
    const url = new URL(m[1], base).href;
    if (!out.some((x) => x.url === url)) out.push({ url, title });
  }
  return out;
};
const prevMonth = (date) => { const [y, m] = date.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const releaseFromUrl = (url) => { const u = /\/t(\d{4})(\d{2})(\d{2})_\d+\.html?$/.exec(url); return u ? `${u[1]}-${u[2]}-${u[3]}` : null; };

const existing = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : {};
const ev = { ...existing, generatedAt: new Date().toISOString(), sourcePolicy: "官方原始发布（国家统计局、财政部原页）；不使用Wind。每个字段均来自原页文字或表格，缺失即留空。" };
for (const k of ["pbcReleaseDates", "press", "iva", "fai", "re", "retail", "profit", "pmi", "capacity", "fiscal", "afre", "customs", "omo", "mpr"]) ev[k] = ev[k] || {};
const log = [];

// ---- NBS ----
const NBS = "https://www.stats.gov.cn/sj/zxfb/";
const kinds = [
  ["pmi", /^\d{4}年\d{1,2}月中国采购经理指数运行情况$/],
  ["iva", /^\d{4}年\d{1,2}月份规模以上工业增加值/],
  ["fai", /^\d{4}年1—\d{1,2}月份全国固定资产投资/],
  ["re", /^\d{4}年1—\d{1,2}月份全国房地产市场基本情况/],
  ["retail", /^\d{4}年(1—\d{1,2}月份|上半年|前三季度|一季度)社会消费品零售总额/],
  ["profit", /^\d{4}年1—\d{1,2}月份全国规模以上工业企业利润/],
  ["press", /国民经济/],
  ["capacity", /^\d{4}年[一二三四]季度全国(规模以上)?工业产能利用率/],
];
const articles = [];
for (let i = 0; i < pages; i += 1) {
  const listUrl = `${NBS}index${i ? `_${i}` : ""}.html`;
  const html = get(listUrl);
  if (!html) { log.push(`list unavailable ${listUrl}`); continue; }
  for (const a of links(html, listUrl, /./)) {
    const kind = kinds.find(([, re]) => re.test(a.title))?.[0];
    if (kind && !articles.some((x) => x.url === a.url)) articles.push({ ...a, kind });
  }
}
for (const listUrl of ["https://www.stats.gov.cn/sj/xwfbh/fbhwd/index.html", "https://www.stats.gov.cn/sj/xwfbh/fbhwd/index_1.html"]) {
  const html = get(listUrl);
  if (!html) continue;
  for (const a of links(html, listUrl, /国民经济/)) if (!articles.some((x) => x.url.split("/").pop() === a.url.split("/").pop())) articles.push({ ...a, kind: "press" });
}
for (const a of articles) {
  const raw = get(a.url, { cache: true });
  if (!raw) { log.push(`article unavailable ${a.url}`); continue; }
  const t = P.pageText(raw);
  const releaseDate = P.releaseDateOf(t.compact, a.url) || releaseFromUrl(a.url);
  const meta = { url: a.url, title: a.title, releaseDate };
  if (a.kind === "pmi") {
    const m = /^(\d{4})年(\d{1,2})月/.exec(a.title);
    ev.pmi[`${m[1]}-${m[2].padStart(2, "0")}`] = { ...meta, table: P.parsePmi(t.spaced) };
    continue;
  }
  if (a.kind === "capacity") {
    const cap = P.parseCapacity(t.compact);
    if (cap) ev.capacity[cap.period] = { ...meta, ...cap };
    continue;
  }
  const period = prevMonth(releaseDate);
  const parsed = { press: () => P.parsePress(t.compact), iva: () => P.parseIndustrialValueAdded(t.compact), fai: () => P.parseFixedInvestment(t.compact),
    re: () => P.parseRealEstate(t.compact), retail: () => P.parseRetail(t.compact), profit: () => P.parseProfit(t.spaced, t.compact) }[a.kind]();
  ev[a.kind][period] = { ...meta, period, ...parsed };
  if (a.kind === "press") {
    const cap = P.parseCapacity(t.compact);
    if (cap) ev.capacity[cap.period] = { ...meta, ...cap };
  }
}

// ---- MOF ----
const MOF = "https://gks.mof.gov.cn/tongjishuju/";
for (let i = 0; i < 3; i += 1) {
  const listUrl = `${MOF}index${i ? `_${i}` : ""}.htm`;
  const html = get(listUrl);
  if (!html) { log.push(`list unavailable ${listUrl}`); continue; }
  for (const a of links(html, listUrl, /^\d{4}年(1-\d{1,2}月|上半年|一季度|前三季度)财政收支情况$/)) {
    const raw = get(a.url, { cache: true });
    if (!raw) { log.push(`article unavailable ${a.url}`); continue; }
    const t = P.pageText(raw);
    const y = Number(a.title.slice(0, 4));
    const m = /1-(\d{1,2})月/.exec(a.title)?.[1] ?? { 上半年: 6, 一季度: 3, 前三季度: 9 }[a.title.slice(5, a.title.indexOf("财政"))];
    if (!m) continue;
    const period = `${y}-${String(m).padStart(2, "0")}`;
    ev.fiscal[period] = { url: a.url, title: a.title, releaseDate: P.releaseDateOf(t.compact, a.url) || releaseFromUrl(a.url), period, ...P.parseFiscal(t.compact) };
  }
}

// ---- PBC release dates for loan report pages (PubDate meta of the original page) ----
ev.pbcReleaseDates = ev.pbcReleaseDates || {};
try {
  const credit = JSON.parse(fs.readFileSync(path.join(root, "app/data/macro-finance-credit.json"), "utf8"));
  for (const r of credit.rows.slice(-26)) {
    if (!r.url || ev.pbcReleaseDates[r.url]) continue;
    const raw = get(r.url, { cache: true });
    const d = raw && /<meta\s+name="PubDate"\s+content="(\d{4}-\d{2}-\d{2})"/.exec(raw);
    if (d) ev.pbcReleaseDates[r.url] = d[1]; else log.push(`pbc date unavailable ${r.url}`);
  }
} catch (e) { log.push(`pbc credit dates: ${e.message}`); }

// ---- PBC AFRE stock tables (社会融资规模存量统计表), current + prior year ----
const getRaw = (url) => { try { return execFileSync("curl", ["-L", "--max-time", "45", "-sS", "-A", "Mozilla/5.0", "-D", "-", url], { maxBuffer: 32 << 20 }); } catch { return null; } };
const decode = (buf) => { const t = buf.toString("utf8"); return t.includes("\uFFFD") ? new TextDecoder("gbk").decode(buf) : t; };
ev.afre = ev.afre || {};
const PBCS = "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/";
const yearPages = { 2025: PBCS + "5570903/" };
for (const y of [new Date().getFullYear() - 1, new Date().getFullYear()]) {
  const yp = yearPages[y] || `${PBCS}${y}ntjsj/`;
  const yhtml = get(yp + "index.html");
  const sub = yhtml && /href="([^"]+)"[^>]*>\s*社会融资规模/.exec(yhtml);
  if (!sub) { log.push(`afre year page missing ${y}`); continue; }
  const shtml = get(new URL(sub[1], yp).href);
  const atts = shtml ? [...new Set([...shtml.matchAll(/(\/diaochatongjisi\/attachDir\/[^"']+\.htm)/g)].map((m) => m[1]))] : [];
  let found = false;
  for (const a of atts) {
    const url = new URL(a, "https://www.pbc.gov.cn").href;
    const raw = getRaw(url);
    if (!raw) continue;
    const sep = raw.indexOf("\r\n\r\n");
    const head = raw.subarray(0, sep).toString("latin1");
    const lm = [...head.matchAll(/last-modified:\s*([^\r\n]+)/gi)].at(-1);
    const parsed = P.parseAfreStock(P.pageText(decode(raw.subarray(sep + 4))).spaced);
    if (!parsed || !Object.keys(parsed).length) continue;
    const releaseDate = lm ? new Date(lm[1]).toISOString().slice(0, 10) : null;
    if (!releaseDate) { log.push(`afre no Last-Modified ${url}`); continue; }
    for (const [period, row] of Object.entries(parsed)) {
      ev.afre[period] = { ...row, sourceUrl: url, releaseDate, lastModified: lm[1].trim(), revisionVersion: `${y}年度原表，${releaseDate}${y < new Date().getFullYear() ? "修订" : ""}附件` };
    }
    found = true;
  }
  if (!found) log.push(`afre table missing ${y}`);
}

// ---- GACC customs USD monthly summary (reachable from DMIT only) ----
ev.customs = ev.customs || {};
{
  const base = "http://english.customs.gov.cn/statics/report/monthly.html";
  const idx = get(base);
  const row = idx && /B[：:]\s*Monthly<\/td><td>([\s\S]*?)<\/td>/.exec(idx);
  const hrefs = row ? [...row[1].matchAll(/href=["']?([^"'\s>]+)/g)].map((x) => new URL(x[1], base).href).reverse() : [];
  if (!idx) log.push("customs index unreachable (expected off-DMIT)");
  for (const url of hrefs.slice(0, 2)) {
    const html = get(url);
    if (!html) { log.push(`customs page failed ${url}`); continue; }
    const t = P.parseCustomsSummary(P.pageText(html).spaced);
    for (const [period, row] of Object.entries(t.rows)) {
      if (row.exportMonthYoy === null) { if (!ev.customs[period]) ev.customs[period] = { ...row, sourceUrl: url, releaseDate: t.releaseDate, amountsOnly: true }; continue; }
      ev.customs[period] = { ...row, sourceUrl: url, releaseDate: t.releaseDate };
    }
  }
}

// ---- PBC open-market 7-day reverse repo rate, last operation of each month ----
ev.omo = ev.omo || {};
{
  const OMO = "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/";
  const ann = [];
  for (let p = 1; p <= Number(arg("omoPages", 10)); p += 1) {
    const html = get(p === 1 ? OMO + "index.html" : `${OMO}17081-${p}.html`);
    if (!html) { log.push(`omo list ${p} failed`); continue; }
    for (const m of html.matchAll(/href="([^"]*125475\/(\d{8})\d+\/index\.html)"/g)) {
      const url = new URL(m[1], OMO).href;
      if (!ann.some((a) => a.url === url)) ann.push({ url, day: `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}` });
    }
  }
  const byMonth = {};
  for (const a of ann) (byMonth[a.day.slice(0, 7)] ||= []).push(a);
  for (const [month, list] of Object.entries(byMonth)) {
    list.sort((a, b) => b.url.localeCompare(a.url));
    const checked = [];
    for (const a of list) {
      const html = get(a.url, { cache: true });
      const r = html && P.parseOmo(P.pageText(html).compact);
      checked.push({ url: a.url, day: a.day, rate: r?.rate ?? null });
      if (r && r.date.slice(0, 7) === month) { ev.omo[month] = { ...r, sourceUrl: a.url, releaseDate: r.date, laterAnnouncementsWithoutRate: checked.slice(0, -1) }; break; }
    }
  }
}

// ---- PBC quarterly monetary policy report: new enterprise loan weighted rate (quarter-end month) ----
ev.mpr = ev.mpr || {};
{
  const MPR = "https://www.pbc.gov.cn/zhengcehuobisi/125207/125227/125957/";
  const idx = get(MPR + "index.html");
  const reports = idx ? [...idx.matchAll(/href="([^"]+\/index\.html)"[^>]*title="(\d{4})年第.季度中国货币政策执行报告"/g)].map((m) => new URL(m[1], MPR).href) : [];
  if (!idx) log.push("mpr index unreachable");
  for (const url of reports.slice(0, 6)) {
    if (Object.values(ev.mpr).some((r) => r.reportUrl === url)) continue;
    const page = get(url, { cache: true });
    const pub = page && /<meta\s+name="PubDate"\s+content="(\d{4}-\d{2}-\d{2})/.exec(page);
    const pdf = page && /href="([^"]+\.pdf)"/.exec(page);
    if (!pub || !pdf) { log.push(`mpr page incomplete ${url}`); continue; }
    const pdfUrl = new URL(pdf[1], url).href;
    const file = path.join(cacheDir, pdfUrl.replace(/[^a-zA-Z0-9]+/g, "_").slice(-150));
    try {
      if (!fs.existsSync(file)) execFileSync("curl", ["-L", "--max-time", "120", "-sS", "-A", "Mozilla/5.0", "-o", file, pdfUrl]);
      const text = execFileSync("pdftotext", ["-layout", file, "-"], { maxBuffer: 64 << 20 }).toString("utf8");
      const r = P.parseMprLoanRate(text);
      if (r) ev.mpr[r.period] = { ...r, sourceUrl: pdfUrl, reportUrl: url, releaseDate: pub[1] }; else log.push(`mpr table not found ${pdfUrl}`);
    } catch (e) { log.push(`mpr pdf ${pdfUrl}: ${e.message.split("\n")[0]}`); }
  }
}

ev.log = log;
const tmp = output + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(ev, null, 1) + "\n");
fs.renameSync(tmp, output);
const latest = (o) => Object.keys(o).sort().at(-1) ?? null;
console.log(JSON.stringify({ articles: articles.length, latest: Object.fromEntries(["press", "iva", "fai", "re", "retail", "profit", "pmi", "capacity", "fiscal", "afre", "customs", "omo", "mpr"].map((k) => [k, latest(ev[k])])), problems: log.length }));
