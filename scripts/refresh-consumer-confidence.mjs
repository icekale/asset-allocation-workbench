#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  coverage,
  mergeBySourcePriority,
  normalizeObservations,
  normalizePeriod,
  parseOfficialLevel,
  appendToIntrayear,
  spliceSeriesText,
} from "../lib/consumer-confidence.mjs";
import { caixinConfigFromValues, getCaixinObservations, getCaixinSeries, searchCaixinSeries, unwrapCaixinSearchSeries } from "../lib/caixin.ts";

const root = process.cwd();
const reportPath = resolve(process.env.CCI_REFRESH_REPORT || "output/consumer-confidence-refresh.json");
const appDataPath = resolve("app/data/macro-intrayear.json");
const startPeriod = process.env.CCI_START_PERIOD || "2020-01";
const today = new Date();
const endPeriod = process.env.CCI_END_PERIOD || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const officialSearchUrl = "https://api.so-gov.cn/query/s"; // Discovery only; values are parsed exclusively from stats.gov.cn pages.
const officialDomain = "www.stats.gov.cn";
const windCode = "M0012303";
const now = new Date().toISOString();
const stages = [];

function cciPeriodTitle(year, month) {
  return month === 2
    ? `${year}年1—2月份国民经济运行情况答记者问`
    : `${year}年${month}月份国民经济运行情况答记者问`;
}

async function searchOfficialArticle(year, month) {
  const query = cciPeriodTitle(year, month);
  const body = new URLSearchParams({ siteCode: "bm36000002", qt: query, keyPlace: "1", page: "1", pageSize: "30" });
  const response = await fetch(officialSearchUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "asset-allocation-workbench/1.0" }, body, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`官方原文发现请求 HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.resultDocs ?? []).map((item) => item.data).filter((item) => {
    if (!item?.url || !item?.titleO) return false;
    if (!item.titleO.includes("国民经济运行情况答记者问")) return false;
    try {
      const url = new URL(item.url);
      return url.protocol === "https:" && url.hostname === officialDomain;
    } catch { return false; }
  }).slice(0, 1);
}

async function fetchOfficialText(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== officialDomain) throw new Error("拒绝读取非国家统计局原始页面");
  const response = await fetch(url, { headers: { "user-agent": "asset-allocation-workbench/1.0", accept: "text/html" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`国家统计局原文 HTTP ${response.status}`);
  const html = await response.text();
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, "—")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

async function officialRows() {
  const app = JSON.parse(await readFile(appDataPath, "utf8"));
  const current = app.series.find((row) => row.metric === "消费者信心指数");
  const baselineYear = String(current?.source ?? "").match(/截至\s*(20\d{2})年/)?.[1];
  const verifiedRecent = new Map((baselineYear ? current?.periods ?? [] : []).map((period, index) => {
    const match = period.match(/^(\d{1,2})月$/);
    if (!match || typeof current.values[index] !== "number") return null;
    return [`${baselineYear}-${String(Number(match[1])).padStart(2, "0")}`, current.values[index]];
  }).filter(Boolean));
  const discovered = [];
  const attempted = [];
  // Monthly national-economy Q&A pages are the official public route; search is only used to locate them.
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date(Date.UTC(today.getFullYear(), today.getMonth() - offset, 1));
    const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    attempted.push(period);
    try {
      const docs = await searchOfficialArticle(date.getUTCFullYear(), date.getUTCMonth() + 1);
      for (const doc of docs) {
        const text = await fetchOfficialText(doc.url);
        const value = parseOfficialLevel(text, period);
        if (value !== null) discovered.push({ period, value, sourceUrl: doc.url, sourceId: "国家统计局原始发布", unit: "点", frequency: "月度", basis: "月度消费者信心指数水平" });
      }
    } catch (error) {
      stages.push({ source: "official", period, status: "unavailable", reason: error.message });
    }
  }
  // Existing Wind observations can be retained as a transparent baseline until official history is retrieved.
  for (const [period, value] of verifiedRecent) {
    if (!discovered.some((row) => row.period === period)) discovered.push({ period, value, sourceUrl: null,
      sourceId: "Wind EDB M0012303（原始来源标注：国家统计局）", unit: "点", frequency: "月度", basis: "月度消费者信心指数水平" });
  }
  const normalized = normalizeObservations(discovered, {});
  stages.push({ source: "official", status: "checked", periodsChecked: attempted, exactLevelObservations: normalized.filter((row) => row.sourceId === "国家统计局原始发布").length,
    monthlyChangesExcluded: true, note: "官方通稿中只有环比升降几分的表述不转算成指数水平。" });
  return normalized.filter((row) => row.sourceId === "国家统计局原始发布");
}

function runWind() {
  return new Promise((resolvePromise, reject) => {
    const cli = process.env.WIND_CLI_PATH || resolve(`${process.env.HOME}/.agents/skills/wind-mcp-skill/scripts/cli.mjs`);
    const node = process.env.WIND_NODE_PATH || process.execPath;
    const params = JSON.stringify({ question: windCode, beginDate: `${startPeriod}-01`, endDate: `${endPeriod}-${String(today.getDate()).padStart(2, "0")}` });
    const child = spawn(node, [cli, "call", "economic_data", "query_economic_indicator_data", params], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim().slice(0, 500) || `Wind CLI exit ${code}`));
      try {
        const envelope = JSON.parse(stdout);
        if (envelope.ok === false || envelope.isError) return reject(new Error(`${envelope.code ?? "backend_error"}: ${envelope.message ?? "Wind 调用失败"}`));
        const raw = envelope.content?.find((item) => item.type === "text")?.text;
        const body = JSON.parse(raw ?? "{}");
        const metric = body.metrics?.find((item) => item.code === windCode || item.meta?.code === windCode);
        if (!metric) return reject(new Error(`Wind 未返回指标 ${windCode}`));
        const meta = metric.meta ?? metric;
        const name = String(meta.name ?? "");
        const unit = String(meta.unit ?? "");
        const frequency = String(meta.freq ?? meta.frequency ?? "");
        const source = String(meta.source ?? "");
        if (!name.includes("消费者信心指数") || !/^(点|points?)$/i.test(unit) || !/(月|monthly|^m$)/i.test(frequency)) {
          return reject(new Error(`Wind 元数据口径不符：${name} / ${unit} / ${frequency}`));
        }
        const dates = metric.date ?? metric.dates ?? [];
        const values = metric.value ?? metric.values ?? [];
        if (!Array.isArray(dates) || !Array.isArray(values) || dates.length !== values.length) return reject(new Error("Wind 日期与数值数组长度不一致"));
        const rows = normalizeObservations(dates.map((date, index) => ({ date, value: values[index] })), {
          sourceId: `Wind EDB ${windCode}`, source, unit, frequency: "月度", basis: "月度消费者信心指数水平", sourceUrl: null,
        }).filter((row) => row.period >= startPeriod && row.period <= endPeriod);
        if (!rows.length) return reject(new Error("Wind 序列没有目标范围内的有效月度值"));
        resolvePromise({ rows, meta: { code: windCode, name, source, unit, frequency, updateDate: meta.updateDate ?? null } });
      } catch (error) { reject(error); }
    });
  });
}

async function loadCaixinConfig() {
  const values = {
    CAIXIN_API_KEY: process.env.CAIXIN_API_KEY ?? "",
    CAIXIN_API_BASE_URL: process.env.CAIXIN_API_BASE_URL ?? process.env.CAIXIN_API_BASE,
    CAIXIN_API_USER_AGENT: process.env.CAIXIN_API_USER_AGENT,
  };
  const envFiles = [process.env.CAIXIN_ENV_FILE, ".env.caixin", ".env.local"].filter(Boolean);
  for (const file of envFiles) {
    if (values.CAIXIN_API_KEY && values.CAIXIN_API_BASE_URL && values.CAIXIN_API_USER_AGENT) break;
    try {
      const text = await readFile(resolve(file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*(CAIXIN_API_KEY|CAIXIN_API_BASE_URL|CAIXIN_API_BASE|CAIXIN_API_USER_AGENT)\s*=\s*(.*?)\s*$/);
        if (!match) continue;
        const key = match[1] === "CAIXIN_API_BASE" ? "CAIXIN_API_BASE_URL" : match[1];
        if (!values[key]) values[key] = match[2];
      }
    } catch { /* optional local config */ }
  }
  return caixinConfigFromValues(values);
}

const PREFERRED_CCI_SERIES_ID = "5198401";

function isConsumerConfidenceLevelSeries(series) {
  return Boolean(series?.name?.includes("消费者信心指数")
    && !/满意|预期/.test(series.name ?? "")
    && /国家统计局|中国统计信息服务中心/.test(series.source ?? "")
    && /^(点|points?)$/i.test(series.unit ?? "")
    && /(月|monthly|^m$)/i.test(series.frequency ?? ""));
}

async function caixinRows() {
  const config = { ...(await loadCaixinConfig()), timeoutMs: 30_000, maxRetries: 3 };
  let seriesId = PREFERRED_CCI_SERIES_ID;
  // Search is best-effort confirmation; the known NBS level series id is the source of truth.
  try {
    const found = await searchCaixinSeries("消费者信心指数", config, { pageSize: 50, country: "中国" });
    const list = Array.isArray(found.series) ? found.series : unwrapCaixinSearchSeries(found.raw ?? found.series);
    const preferred = list.find((item) => String(item.series_id) === PREFERRED_CCI_SERIES_ID);
    const candidates = list.filter(isConsumerConfidenceLevelSeries);
    const matched = (preferred && isConsumerConfidenceLevelSeries(preferred))
      ? preferred
      : candidates.length === 1
        ? candidates[0]
        : null;
    if (matched) seriesId = String(matched.series_id);
  } catch {
    // Fall through to direct meta/observations for the preferred series.
  }
  if (seriesId !== PREFERRED_CCI_SERIES_ID) {
    throw new Error(`财新匹配到非首选序列 ${seriesId}，期望 ${PREFERRED_CCI_SERIES_ID}`);
  }
  const [year, month] = endPeriod.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const checked = await getCaixinSeries(seriesId, config);
  const meta = checked.series;
  if (!meta.name.includes("消费者信心指数") || /满意|预期/.test(meta.name)
    || !/国家统计局|中国统计信息服务中心/.test(meta.source ?? "")
    || !/^(点|points?)$/i.test(meta.unit ?? "")
    || !/(月|monthly|^m$)/i.test(meta.frequency ?? "")) {
    throw new Error("财新序列元数据与指标口径不匹配");
  }
  const result = await getCaixinObservations(seriesId, config, { start: `${startPeriod}-01`, end: `${endPeriod}-${lastDay}`, order: "asc", pageSize: 200 });
  return normalizeObservations(result.series.observations.map((row) => ({ date: row.date, value: row.value })), {
    sourceId: `财新序列 ${seriesId}`, source: meta.source, unit: meta.unit, frequency: "月度", basis: "月度消费者信心指数水平", sourceUrl: null,
  }).filter((row) => row.period >= startPeriod && row.period <= endPeriod);
}

const official = await officialRows();
let wind = [];
let caixin = [];
const skipVendor = process.env.CCI_SKIP_VENDOR === "1";
const skipWind = skipVendor || process.env.CCI_SKIP_WIND === "1";
if (!skipWind) {
  try {
    const result = await runWind();
    wind = result.rows;
    stages.push({ source: "wind", status: "ok", meta: result.meta, observations: wind.length });
  } catch (error) {
    stages.push({ source: "wind", status: "unavailable", reason: error.message });
  }
} else {
  stages.push({ source: "wind", status: "skipped", reason: "CCI_SKIP_WIND or CCI_SKIP_VENDOR" });
}
if (!skipVendor && wind.length < coverage(official, startPeriod, endPeriod).expected) {
  try {
    caixin = await caixinRows();
    stages.push({ source: "caixin", status: "ok", observations: caixin.length });
  } catch (error) {
    stages.push({ source: "caixin", status: "unavailable", reason: error.message });
  }
}
const records = mergeBySourcePriority(official, wind, caixin).filter((row) => row.period >= startPeriod && row.period <= endPeriod);
const summary = coverage(records, startPeriod, endPeriod);
const report = {
  generatedAt: now,
  requestedRange: { start: startPeriod, end: endPeriod },
  definition: { metric: "消费者信心指数", frequency: "月度", unit: "点", scale: "0—200，100为景气临界值" },
  sourceOrder: ["国家统计局原始发布", "Wind EDB M0012303", "财新数据 API"],
  stages,
  coverage: summary,
  observations: records,
  appliedToWorkbench: false,
  note: "只收录明确发布的指数水平。仅披露环比变化、季度平均、图表读数或无法核对单位的值不转算、不入图。",
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

// Append-only: keep every existing chart point; only add months newer than the last one shown.
if (process.argv.includes("--apply") && records.length) {
  const app = JSON.parse(await readFile(appDataPath, "utf8"));
  const index = app.series.findIndex((row) => row.metric === "消费者信心指数");
  if (index < 0) throw new Error("宏观指标文件中找不到消费者信心指数");
  const target = app.series[index];
  const baselineYear = Number(target.baselineYear ?? String(target.source ?? "").match(/(20\d{2})年/)?.[1]);
  if (!baselineYear) throw new Error("消费者信心指数缺少基准年份，拒绝写入");
  const { target: next, appended, conflicts } = appendToIntrayear(target, records, baselineYear);
  report.appended = appended.map(({ period, value, sourceId }) => ({ period, value, sourceId }));
  report.conflicts = conflicts;
  if (appended.length) {
    const last = appended.at(-1);
    const [ly, lm] = last.period.split("-");
    const vendors = [...new Set(next.observationSources.map((row) => row.sourceId))].join("、");
    next.baselineYear = baselineYear;
    next.basis = "国家统计局月度消费者信心指数，100为景气临界值；新增月份逐点核验后追加，历史点不改写";
    next.source = `${baselineYear}年1—7月 Wind EDB M0012303；新增月份 ${vendors}（原始来源：国家统计局；截至${ly}年${Number(lm)}月）`;
    let text = spliceSeriesText(await readFile(appDataPath, "utf8"), "消费者信心指数", next);
    text = text.replace(/"reviewedAt": "\d{4}-\d{2}-\d{2}"/, `"reviewedAt": "${new Date().toISOString().slice(0, 10)}"`);
    JSON.parse(text);
    await writeFile(appDataPath, text);
    report.appliedToWorkbench = true;
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify({ report: reportPath, range: report.requestedRange, coverage: report.coverage,
  appliedToWorkbench: report.appliedToWorkbench, stages: stages.map(({ source, status, reason }) => ({ source, status, reason })) }, null, 2));
