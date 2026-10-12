import fs from "node:fs/promises";
import path from "node:path";
import { mapCaixinSeries } from "../lib/caixin-mapping.ts";

async function loadEnv(file) {
  const values = {};
  const text = await fs.readFile(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const split = line.indexOf("=");
    values[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return values;
}

const projectRoot = process.cwd();
const local = await loadEnv(process.env.COLLECTOR_ENV_FILE || ".collector.env");
const siteUrl = process.env.SITE_URL || local.SITE_URL;
const updateToken = process.env.UPDATE_TOKEN || local.UPDATE_TOKEN;
if (!siteUrl || !updateToken) throw new Error("SITE_URL and UPDATE_TOKEN are required");
const advisory = JSON.parse(await fs.readFile(path.join(projectRoot, "app/data/advisory.json"), "utf8"));
const targets = advisory.macroIndicators ?? [];
const headers = { authorization: `Bearer ${updateToken}`, accept: "application/json" };
const decisions = [];
const candidatesByTarget = new Map();
for (const target of targets) {
  try {
    const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/caixin/search?q=${encodeURIComponent(target.name)}`, { headers });
    if (!response.ok) throw new Error(`search_http_${response.status}`);
    const result = await response.json();
    const series = Array.isArray(result.series)
      ? result.series
      : Array.isArray(result.series?.series)
        ? result.series.series
        : [];
    candidatesByTarget.set(target.id, series);
    decisions.push({ id: target.id, name: target.name, searched: true });
  } catch (error) {
    decisions.push({ id: target.id, name: target.name, searched: false, fallback: error instanceof Error ? error.message : "search_failed" });
  }
}
const mapped = targets.flatMap((target) => mapCaixinSeries(targets.filter((item) => item.id === target.id), candidatesByTarget.get(target.id) ?? []));
for (const decision of mapped) {
  const current = decisions.find((item) => item.id === decision.targetId);
  if (current) Object.assign(current, { seriesId: decision.seriesId, confidence: decision.confidence, enabled: decision.enabled, blockers: decision.blockers, reasons: decision.reasons });
}
const report = {
  generatedAt: new Date().toISOString(),
  provider: "caixin-worker-proxy",
  policy: "仅输出审计候选，不自动覆盖 advisory 或 payload；观测值需另行确认后发布。",
  summary: { total: targets.length, searched: decisions.filter((item) => item.searched).length, candidates: [...candidatesByTarget.values()].reduce((sum, items) => sum + items.length, 0), highConfidenceCandidates: decisions.filter((item) => item.enabled).length, fallback: decisions.filter((item) => !item.searched || item.blockers?.length).length },
  decisions,
};
const output = process.env.CAIXIN_SYNC_REPORT || path.join(projectRoot, "output", "caixin-sync-report.json");

// Optional local whitelist (config/caixin-series.json): annotate audit rows only; never overwrite payload/scores.
try {
  const { loadCaixinSeriesConfig, enabledCaixinMappings } = await import("../lib/caixin-series-config.ts");
  const { config: seriesConfig, path: seriesConfigPath } = await loadCaixinSeriesConfig(projectRoot);
  const whitelist = enabledCaixinMappings(seriesConfig);
  report.whitelist = {
    path: seriesConfigPath,
    policy: seriesConfig.policy,
    enabled: whitelist.map((item) => ({
      targetKey: item.targetKey,
      seriesId: item.id,
      scale: item.scale ?? 1,
      notes: item.notes ?? null,
    })),
  };
  for (const item of whitelist) {
    const current = decisions.find((row) => row.id === item.targetKey);
    if (current) {
      current.whitelistSeriesId = item.id;
      current.whitelistEnabled = true;
      current.whitelistScale = item.scale ?? 1;
    }
  }
} catch (error) {
  report.whitelist = { skipped: true, reason: error instanceof Error ? error.message : "whitelist_unavailable" };
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, output }));
