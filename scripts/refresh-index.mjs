#!/usr/bin/env node
/**
 * 收盘后刷新上证指数：抓取双源行情 → 与基线 payload 合并 → 校验 →（可选）发布。
 *
 * 与 Cloudflare Worker 的定时任务共用 lib/index-quote.ts（抓取与交叉核验）和
 * lib/index-refresh.ts（合并与幂等），本脚本只负责本地/采集机的文件与发布环节，
 * 可作为线上 Cron 的兜底入口或人工核对入口。
 *
 * 用法：
 *   node --experimental-strip-types scripts/refresh-index.mjs --check
 *   node --experimental-strip-types scripts/refresh-index.mjs [--publish] [--baseline=<payload.json>] [--output=<payload.json>]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fetchIndexQuote } from "../lib/index-quote.ts";
import { isQuoteApplied, mergeIndexQuote } from "../lib/index-refresh.ts";

async function loadEnv(file) {
  const values = {};
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    // 缺少 .collector.env 时仍允许 --check / --baseline 离线运行。
    return values;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const split = line.indexOf("=");
    values[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return values;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const publish = args.includes("--publish");
const baselineArg = args.find((arg) => arg.startsWith("--baseline="))?.slice("--baseline=".length);
const outputArg = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);

const projectRoot = process.cwd();
const envPath = process.env.COLLECTOR_ENV_FILE || path.join(projectRoot, ".collector.env");
const outputPath = path.resolve(projectRoot, outputArg ?? "collector/latest-payload.json");
const local = await loadEnv(envPath);
const siteUrl = process.env.SITE_URL || local.SITE_URL;
const updateToken = process.env.UPDATE_TOKEN || local.UPDATE_TOKEN;

const quote = await fetchIndexQuote();
if (checkOnly) {
  console.log(JSON.stringify(quote, null, 2));
  process.exit(0);
}

let payload;
if (baselineArg) {
  payload = JSON.parse(await fs.readFile(path.resolve(projectRoot, baselineArg), "utf8"));
} else {
  if (!siteUrl || !updateToken) throw new Error("SITE_URL and UPDATE_TOKEN are required to download the baseline payload");
  const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/update`, { headers: { authorization: `Bearer ${updateToken}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.payload) throw new Error(`Download baseline failed (${response.status}): ${result.error ?? "unknown error"}`);
  payload = result.payload;
}

if (isQuoteApplied(payload, quote)) {
  console.log(JSON.stringify({ updated: false, reason: "already-current", asOf: payload.asOf, value: quote.value, crossChecked: quote.crossChecked }));
  process.exit(0);
}

const next = mergeIndexQuote(payload, quote);
const temporaryPath = `${outputPath}.tmp-${process.pid}`;
await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
try {
  await run(process.execPath, [path.join(projectRoot, "scripts/validate-payload.mjs"), temporaryPath]);
} catch (error) {
  await fs.rm(temporaryPath, { force: true });
  throw error;
}
await fs.rename(temporaryPath, outputPath);

if (publish) await run(process.execPath, [path.join(projectRoot, "scripts/publish-data.mjs"), outputPath, envPath]);
console.log(JSON.stringify({
  updated: true,
  asOf: next.asOf,
  value: quote.value,
  changePct: quote.changePct,
  crossChecked: quote.crossChecked,
  factorsPreserved: { factors: next.factors.length, styleFactors: next.styleFactors.length },
  published: publish,
  output: outputPath,
}));
