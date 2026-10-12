#!/usr/bin/env node
/**
 * Macro workbench collector orchestrator.
 *
 * Modes:
 *   --mode=audit   (default) Stage collector outputs under output/; never write app/data.
 *                  Run optional Caixin whitelist audit + stale check. Safe for CI.
 *   --mode=apply   Run refresh-official-macro.mjs (backup/rollback) then Caixin audit + stale.
 *                  Intended for a trusted local machine with network access to official sites.
 *
 * Always writes output/collector-last-run.json (ok/fail per step).
 * Failures never leave worse data in app/data (audit writes only to staging; apply delegates
 * to refresh-official-macro which rolls back incompatible writes).
 *
 * Flags:
 *   --skip-caixin          Skip caixin-audit even if key is present
 *   --skip-collectors      Only stale (+ optional caixin)
 *   --strict-collectors    Non-zero exit when any collector step fails (default: warn in audit)
 *   --fail-on-stale=false  Do not exit 2 when stale (default: fail)
 *
 * Env:
 *   PYTHON, CAIXIN_ENV_FILE, CAIXIN_SERIES_CONFIG, COLLECTOR_TIMEOUT_MS
 *   COLLECTOR_LAST_RUN     Override last-run report path
 */
import { access, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkMacroStaleness } from "../lib/stale-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = (args.find((a) => a.startsWith("--mode="))?.slice("--mode=".length)
  || (args.includes("--apply") ? "apply" : "audit")).toLowerCase();
const skipCaixin = args.includes("--skip-caixin");
const skipCollectors = args.includes("--skip-collectors");
const strictCollectors = args.includes("--strict-collectors");
const failOnStale = !args.includes("--fail-on-stale=false");
const python = process.env.PYTHON || "python3";
const COLLECTOR_TIMEOUT_MS = Number(process.env.COLLECTOR_TIMEOUT_MS || 20 * 60_000);
const stamp = new Date().toISOString().replaceAll(":", "").replace(/\..+$/, "");
const runDir = path.join(root, "output", "collector-run", stamp);
const stagingDir = path.join(runDir, "staging");
const lastRunPath = path.resolve(
  process.env.COLLECTOR_LAST_RUN || path.join(root, "output", "collector-last-run.json"),
);

/** Collectors that can write to an alternate --output path (safe for audit staging). */
const stageableCollectors = [
  {
    id: "nbs-price-history",
    script: "scripts/collect-nbs-price-history.py",
    buildArgs: (out) => ["--output", out, "--start-year", "2010", "--end-year", String(new Date().getFullYear())],
    stagingFile: "macro-price-history.json",
    requires: [],
  },
  {
    id: "nbs-gdp-deflator",
    script: "scripts/collect-nbs-gdp-deflator.py",
    buildArgs: (out) => ["--output", out],
    stagingFile: "macro-gdp-deflator-history.json",
    requires: ["pandas"],
  },
  {
    id: "pbc-social-financing",
    script: "scripts/collect-pbc-social-financing.py",
    buildArgs: (out) => ["--output", out],
    stagingFile: "macro-social-financing.json",
    requires: [],
  },
  {
    id: "macro-policy",
    script: "scripts/collect-macro-policy.py",
    buildArgs: (out) => ["--output", out],
    stagingFile: "macro-policy.json",
    requires: ["openpyxl"],
  },
];

/** Collectors that only write app/data directly — audit mode skips; apply uses refresh-official-macro. */
const applyOnlyCollectors = [
  "scripts/collect-nbs-secondhand-price.py",
  "scripts/collect-pbc-money-supply.py",
  "scripts/collect-pbc-credit.py",
  "scripts/collect-mofcom-social-financing-flow.py",
];

function run(command, commandArgs, { timeoutMs = 0, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: env ? { ...process.env, ...env } : process.env,
    });
    let output = "";
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ ok: false, code: null, output: `${output}\n[timeout ${timeoutMs}ms]` });
      }, timeoutMs);
    }
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, output: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code, output }));
  });
}

async function hasModule(name) {
  return (await run(python, ["-c", `import ${name}`], { timeoutMs: 30_000 })).ok;
}

async function resolveEnvFile() {
  if (process.env.CAIXIN_ENV_FILE) return process.env.CAIXIN_ENV_FILE;
  for (const candidate of [".env.caixin", ".env.local"]) {
    try {
      await access(path.join(root, candidate));
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

async function hasCaixinKey() {
  if (process.env.CAIXIN_API_KEY?.trim()) return true;
  const envFile = await resolveEnvFile();
  if (!envFile) return false;
  try {
    const text = await readFile(path.join(root, envFile), "utf8");
    return /^CAIXIN_API_KEY=.+/m.test(text);
  } catch {
    return false;
  }
}

/**
 * Compare staged JSON vs live app/data: refuse to recommend apply if staged shrank or lost keys.
 * Returns { ok, reasons }.
 */
function guardStagedAgainstLive(liveRaw, stagedRaw) {
  let live;
  let staged;
  try {
    live = JSON.parse(liveRaw);
    staged = JSON.parse(stagedRaw);
  } catch (error) {
    return { ok: false, reasons: [`JSON parse: ${error.message}`] };
  }
  const reasons = [];
  if (live && typeof live === "object" && !Array.isArray(live)
    && staged && typeof staged === "object" && !Array.isArray(staged)) {
    const missing = Object.keys(live).filter((key) => !(key in staged));
    if (missing.length) reasons.push(`missing keys: ${missing.join(", ")}`);
  }
  const liveRows = Array.isArray(live?.rows) ? live.rows.length : null;
  const stagedRows = Array.isArray(staged?.rows) ? staged.rows.length : null;
  if (liveRows && stagedRows != null && stagedRows < liveRows * 0.8) {
    reasons.push(`rows shrank ${liveRows} → ${stagedRows}`);
  }
  // nested policy series
  for (const key of ["lpr", "bond", "fiscal", "imfDeficit"]) {
    const a = live?.[key]?.rows?.length;
    const b = staged?.[key]?.rows?.length;
    if (a && b != null && b < a * 0.8) reasons.push(`${key}.rows shrank ${a} → ${b}`);
  }
  return { ok: reasons.length === 0, reasons };
}

const steps = [];
const startedAt = new Date().toISOString();
await mkdir(stagingDir, { recursive: true });

async function recordStep(step) {
  steps.push(step);
  const tag = step.ok ? "ok  " : step.skipped ? "SKIP" : "FAIL";
  console.log(`${tag} ${step.id}${step.durationMs != null ? ` (${step.durationMs}ms)` : ""}${step.detail ? ` — ${step.detail}` : ""}`);
}

// --- 1) Collectors ---
if (skipCollectors) {
  await recordStep({ id: "collectors", ok: true, skipped: true, detail: "--skip-collectors" });
} else if (mode === "apply") {
  const t0 = Date.now();
  // Never pass --deploy from this orchestrator (publish is out of scope unless Kale asks).
  const result = await run(
    process.execPath,
    ["scripts/refresh-official-macro.mjs"],
    { timeoutMs: COLLECTOR_TIMEOUT_MS * 2 },
  );
  await recordStep({
    id: "refresh-official-macro",
    ok: result.ok,
    skipped: false,
    durationMs: Date.now() - t0,
    code: result.code,
    detail: result.ok ? "apply via refresh-official-macro (backup/rollback)" : result.output.trim().slice(0, 500),
    output: result.output.trim().slice(0, 4_000),
  });
} else {
  // audit: stageable collectors only → staging/
  await recordStep({
    id: "audit-scope",
    ok: true,
    skipped: false,
    detail: `stageable=${stageableCollectors.map((c) => c.id).join(",")}; apply-only deferred: ${applyOnlyCollectors.map((s) => path.basename(s)).join(",")}`,
  });
  for (const collector of stageableCollectors) {
    const missing = [];
    for (const mod of collector.requires) {
      if (!(await hasModule(mod))) missing.push(mod);
    }
    if (missing.length) {
      await recordStep({
        id: collector.id,
        ok: true,
        skipped: true,
        detail: `missing python modules: ${missing.join(", ")}`,
      });
      continue;
    }
    const outPath = path.join(stagingDir, collector.stagingFile);
    // Seed baseline so merge-write collectors can preserve keys when reading OUTPUT for baseline
    // but writing to --output. For policy/sf, baseline still loads from live OUTPUT path.
    const livePath = path.join(root, "app", "data", collector.stagingFile);
    try {
      await copyFile(livePath, outPath);
    } catch {
      /* no live baseline */
    }
    const t0 = Date.now();
    const result = await run(
      python,
      [collector.script, ...collector.buildArgs(outPath)],
      { timeoutMs: COLLECTOR_TIMEOUT_MS },
    );
    let guard = { ok: true, reasons: [] };
    if (result.ok) {
      try {
        const liveRaw = await readFile(livePath, "utf8");
        const stagedRaw = await readFile(outPath, "utf8");
        guard = guardStagedAgainstLive(liveRaw, stagedRaw);
      } catch (error) {
        guard = { ok: false, reasons: [error instanceof Error ? error.message : String(error)] };
      }
    }
    await recordStep({
      id: collector.id,
      ok: result.ok && guard.ok,
      skipped: false,
      durationMs: Date.now() - t0,
      code: result.code,
      stagingFile: collector.stagingFile,
      guard,
      detail: !result.ok
        ? result.output.trim().slice(0, 300)
        : guard.ok
          ? `staged ${collector.stagingFile}`
          : `guard blocked: ${guard.reasons.join("; ")}`,
      output: result.output.trim().slice(0, 2_000),
    });
  }
}

// --- 2) Optional Caixin whitelist audit (never writes app/data) ---
if (skipCaixin) {
  await recordStep({ id: "caixin-audit", ok: true, skipped: true, detail: "--skip-caixin" });
} else if (!(await hasCaixinKey())) {
  await recordStep({
    id: "caixin-audit",
    ok: true,
    skipped: true,
    detail: "CAIXIN_API_KEY not configured (set GH secret or .env.caixin locally)",
  });
} else {
  const reportPath = path.join(runDir, "caixin-whitelist-audit.json");
  const t0 = Date.now();
  const result = await run(
    process.execPath,
    ["--experimental-strip-types", "scripts/caixin-audit.mjs", reportPath],
    { timeoutMs: 10 * 60_000 },
  );
  await recordStep({
    id: "caixin-audit",
    ok: result.ok,
    skipped: false,
    durationMs: Date.now() - t0,
    code: result.code,
    reportPath,
    detail: result.ok ? "whitelist dry-run ok" : result.output.trim().slice(0, 400),
    output: result.output.trim().slice(0, 2_000),
  });
}

// --- 3) Stale check (always against live app/data) ---
const staleReport = await checkMacroStaleness(root);
const stalePath = path.join(runDir, "stale-check.json");
await writeFile(stalePath, `${JSON.stringify(staleReport, null, 2)}\n`);
await recordStep({
  id: "stale-check",
  ok: staleReport.summary.stale === 0,
  skipped: false,
  detail: staleReport.summary.stale
    ? `stale: ${staleReport.staleIds.join(", ")}`
    : `all ${staleReport.summary.checked} checks fresh (today ${staleReport.today})`,
  reportPath: stalePath,
  summary: staleReport.summary,
});

const collectorFails = steps.filter((s) => !s.ok && !s.skipped && s.id !== "stale-check" && s.id !== "audit-scope");
const staleFail = failOnStale && staleReport.summary.stale > 0;
const hardFail = (strictCollectors && collectorFails.length > 0)
  || (mode === "apply" && steps.some((s) => s.id === "refresh-official-macro" && !s.ok));

const report = {
  generatedAt: new Date().toISOString(),
  startedAt,
  mode,
  timezoneNote: "Asia/Shanghai (UTC+8)",
  policy: "官方 → 财新（Wind 可选后续）；audit 不写 app/data；apply 经 refresh-official-macro 回滚守卫；不自动写 D1/评分",
  flags: { skipCaixin, skipCollectors, strictCollectors, failOnStale },
  runDir,
  stagingDir: mode === "audit" ? stagingDir : null,
  summary: {
    steps: steps.length,
    ok: steps.filter((s) => s.ok).length,
    failed: steps.filter((s) => !s.ok && !s.skipped).length,
    skipped: steps.filter((s) => s.skipped).length,
    stale: staleReport.summary.stale,
    collectorFails: collectorFails.map((s) => s.id),
  },
  steps,
  stale: {
    today: staleReport.today,
    summary: staleReport.summary,
    staleIds: staleReport.staleIds,
  },
  exitHints: {
    staleFail,
    hardFail,
  },
};

await mkdir(path.dirname(lastRunPath), { recursive: true });
await writeFile(lastRunPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(runDir, "collector-last-run.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  mode: report.mode,
  ...report.summary,
  lastRunPath,
  runDir,
  staleFail,
  hardFail,
}, null, 2));

if (staleFail) process.exit(2);
if (hardFail) process.exit(1);
process.exit(0);
