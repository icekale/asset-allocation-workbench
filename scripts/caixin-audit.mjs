#!/usr/bin/env node
/**
 * Dry-run audit for the Caixin series whitelist.
 * Fetches meta + latest observations for enabled mappings and compares with
 * advisory.json current values. Never writes advisory, ratings, payload, or D1.
 *
 * Usage:
 *   node --experimental-strip-types scripts/caixin-audit.mjs [report.json]
 *
 * Env:
 *   CAIXIN_ENV_FILE / .env.caixin / .env.local — API key (never logged)
 *   CAIXIN_SERIES_CONFIG — override whitelist path
 *   CAIXIN_AUDIT_SLEEP_MS — delay between series (default 2500, respect ~30 rpm)
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyMappingScale,
  enabledCaixinMappings,
  loadCaixinSeriesConfig,
} from "../lib/caixin-series-config.ts";
import {
  caixinConfigFromValues,
  getCaixinObservations,
  getCaixinSeries,
} from "../lib/caixin.ts";

async function loadEnv(file) {
  const values = {};
  const text = await readFile(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

async function resolveEnvFile() {
  if (process.env.CAIXIN_ENV_FILE) return process.env.CAIXIN_ENV_FILE;
  for (const candidate of [".env.caixin", ".env.local"]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* next */
    }
  }
  return ".env.local";
}

function parseNumberish(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/%/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyHint(apiKey) {
  if (!apiKey) return null;
  const idx = apiKey.indexOf("cxk_");
  if (idx >= 0 && apiKey.length >= idx + 12) return `cxk_${apiKey.slice(idx + 4, idx + 12)}…`;
  return `${apiKey.slice(0, 4)}…`;
}

const root = process.cwd();
const reportPath = path.resolve(
  process.argv[2]
    || process.env.CAIXIN_AUDIT_REPORT
    || path.join(root, "deliverables", "caixin-whitelist-audit.json"),
);
const sleepMs = Math.max(0, Number(process.env.CAIXIN_AUDIT_SLEEP_MS ?? 2500));

const envFile = await resolveEnvFile();
const local = await loadEnv(envFile);
const caixinConfig = caixinConfigFromValues({
  CAIXIN_API_KEY: process.env.CAIXIN_API_KEY ?? local.CAIXIN_API_KEY,
  CAIXIN_API_BASE_URL: process.env.CAIXIN_API_BASE_URL ?? process.env.CAIXIN_API_BASE ?? local.CAIXIN_API_BASE_URL ?? local.CAIXIN_API_BASE,
  CAIXIN_API_USER_AGENT: process.env.CAIXIN_API_USER_AGENT ?? local.CAIXIN_API_USER_AGENT,
});

const { path: configPath, config } = await loadCaixinSeriesConfig(root);
const mappings = enabledCaixinMappings(config);
const advisory = JSON.parse(await readFile(path.join(root, "app/data/advisory.json"), "utf8"));
const indicators = new Map((advisory.macroIndicators ?? []).map((row) => [row.id, row]));

const rows = [];
for (const mapping of mappings) {
  const indicator = indicators.get(mapping.targetKey) ?? null;
  const entry = {
    targetKey: mapping.targetKey,
    targetName: indicator?.name ?? mapping.name,
    seriesId: mapping.id,
    mappingName: mapping.name,
    enabled: mapping.enabled,
    scale: mapping.scale ?? 1,
    frequencyNote: mapping.frequencyNote ?? null,
    notes: mapping.notes ?? null,
    advisory: indicator
      ? {
          period: indicator.period ?? null,
          currentValue: indicator.currentValue ?? null,
          currentSource: indicator.currentSource ?? null,
          status: indicator.status ?? null,
          score: indicator.score ?? null,
        }
      : null,
    caixin: null,
    compare: null,
    error: null,
  };

  try {
    const meta = await getCaixinSeries(mapping.id, caixinConfig);
    await sleep(sleepMs);
    const obs = await getCaixinObservations(mapping.id, caixinConfig, {
      order: "desc",
      pageSize: 5,
    });
    const latest = obs.series.observations.find((row) => row.value != null) ?? obs.series.observations[0] ?? null;
    const scaled = applyMappingScale(latest?.value, mapping.scale ?? 1);
    const advisoryNum = parseNumberish(indicator?.currentValue);
    let delta = null;
    let relDiff = null;
    if (scaled != null && advisoryNum != null) {
      delta = Number((scaled - advisoryNum).toFixed(6));
      relDiff = advisoryNum === 0 ? null : Number((Math.abs(delta) / Math.abs(advisoryNum)).toFixed(6));
    }
    entry.caixin = {
      name: meta.series.name ?? obs.series.name,
      unit: meta.series.unit ?? obs.series.unit,
      frequency: meta.series.frequency ?? obs.series.frequency,
      source: meta.series.source ?? obs.series.source,
      has_data: meta.series.has_data,
      start_date: meta.series.start_date ?? null,
      end_date: meta.series.end_date ?? null,
      latestDate: latest?.date ?? null,
      latestRaw: latest?.value ?? null,
      latestScaled: scaled,
      sample: obs.series.observations.slice(0, 3),
    };
    entry.compare = {
      advisoryNumber: advisoryNum,
      scaledCaixin: scaled,
      delta,
      relDiff,
      periodMatchHint: indicator?.period && latest?.date
        ? String(indicator.period).slice(0, 7) === String(latest.date).slice(0, 7)
        : null,
      // Scores are never mutated by this audit.
      scoreUntouched: true,
    };
  } catch (error) {
    entry.error = error instanceof Error
      ? { name: error.name, message: error.message, code: error.code ?? null, status: error.status ?? null }
      : { message: String(error) };
  }

  rows.push(entry);
  await sleep(sleepMs);
}

const report = {
  generatedAt: new Date().toISOString(),
  timezoneNote: "box clock Asia/Shanghai (UTC+8)",
  mode: "dry-run-audit",
  policy: config.policy
    ?? "官方 → Wind → 财新；本报告只读，不覆盖 advisory / 评分 / D1 / payload",
  configPath,
  envFile,
  keyHint: keyHint(caixinConfig.apiKey),
  summary: {
    mappings: mappings.length,
    ok: rows.filter((row) => !row.error).length,
    failed: rows.filter((row) => row.error).length,
    withAdvisory: rows.filter((row) => row.advisory).length,
    closeMatch: rows.filter((row) => row.compare?.relDiff != null && row.compare.relDiff <= 0.02).length,
  },
  rows,
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, reportPath, configPath, keyHint: report.keyHint }, null, 2));
