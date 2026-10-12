#!/usr/bin/env node
/**
 * 官方原始数据（国家统计局、人民银行、海关总署）定时抓取编排。
 *
 * 采集器会直接改写 app/data/*.json，因此这里做了两道防护：
 *   1. 运行前整目录备份，运行后逐个文件比对；
 *   2. 新结果若丢了原有顶层字段（采集器输出结构不完整），自动回滚该文件并把
 *      新结果留在 output/official-macro-refresh/pending/ 供人工合并，绝不静默丢字段。
 *
 * 默认只抓取和比对，不发布；`--deploy` 且没有任何需要人工合并的文件时才重新构建发布主站。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(projectRoot, "app", "data");
const outputRoot = path.join(projectRoot, "output", "official-macro-refresh");
const args = process.argv.slice(2);
const deploy = args.includes("--deploy");
const python = process.env.PYTHON || "python3";
const previousMonth = new Date(Date.now() - 32 * 86_400_000).toISOString().slice(0, 7);
/** 无人值守时的兜底：单个采集器超过 20 分钟、通知超过 10 秒即终止，避免定时任务堆积。 */
const COLLECTOR_TIMEOUT_MS = Number(process.env.COLLECTOR_TIMEOUT_MS || 20 * 60_000);
const NOTIFY_TIMEOUT_MS = 10_000;

/** 顺序即执行顺序：串行运行，避免同时改写文件或对官网并发施压。requires 为第三方模块。 */
const collectors = [
  { script: "scripts/collect-nbs-price-history.py", args: ["--output", "app/data/macro-price-history.json", "--start-year", "2010", "--end-year", String(new Date().getFullYear())], requires: [] },
  { script: "scripts/collect-nbs-gdp-deflator.py", args: ["--output", "app/data/macro-gdp-deflator-history.json"], requires: ["pandas"] },
  { script: "scripts/collect-nbs-secondhand-price.py", args: ["--end", previousMonth], requires: ["lxml"] },
  { script: "scripts/collect-pbc-money-supply.py", args: [], requires: [] },
  { script: "scripts/collect-pbc-credit.py", args: [], requires: [] },
  { script: "scripts/collect-pbc-social-financing.py", args: [], requires: [] },
  { script: "scripts/collect-mofcom-social-financing-flow.py", args: [], requires: [] },
  { script: "scripts/collect-macro-policy.py", args: [], requires: ["openpyxl"] },
];

/**
 * 采集器抓取范围小于线上序列的文件，按 period 增量合并而不是整体替换：
 * 例如价格历史里 2010—2011 来自统计公报的人工转录，采集器抓不到，不能被覆盖掉。
 */
const mergeRowsByPeriod = new Set(["macro-price-history.json"]);

/** 运行外部命令；timeoutMs > 0 时到点强杀，返回值与失败一致，绝不无限等待。 */
function run(command, commandArgs, { timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: projectRoot });
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
        finish({ ok: false, output: `${output}\n[$ ${command}] 超时 ${timeoutMs}ms，已终止`, code: null });
      }, timeoutMs);
    }
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => finish({ ok: false, output: error.message, code: null }));
    child.on("close", (code) => finish({ ok: code === 0, output, code }));
  });
}

async function snapshot(dir) {
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const entries = await Promise.all(files.map(async (name) => [name, await fs.readFile(path.join(dir, name))]));
  return new Map(entries);
}

function missingTopLevelKeys(before, after) {
  const parse = (buffer) => JSON.parse(buffer.toString("utf8"));
  let first;
  let second;
  try {
    first = parse(before);
    second = parse(after);
  } catch (error) {
    return [`无法解析 JSON：${error.message}`];
  }
  if (!first || typeof first !== "object" || Array.isArray(first)) return [];
  if (!second || typeof second !== "object" || Array.isArray(second)) return ["新结果不是对象"];
  return Object.keys(first).filter((key) => !(key in second));
}

/** 抓取中途失败时 rows 会明显变短，这类"静默缺数据"同样要拦下来。 */
function rowsShrank(before, after) {
  const rowsOf = (buffer) => {
    try {
      const value = JSON.parse(buffer.toString("utf8"));
      return Array.isArray(value?.rows) ? value.rows.length : null;
    } catch {
      return null;
    }
  };
  const beforeRows = rowsOf(before);
  const afterRows = rowsOf(after);
  return beforeRows && afterRows && afterRows < beforeRows * 0.95 ? { beforeRows, afterRows } : null;
}

/** 新抓取的最新期间早于现有文件：这轮没抓到最新数据，不能当成成功（也不能靠合并掩盖）。 */
function latestPeriodRegressed(before, after) {
  const lastPeriod = (buffer) => {
    try {
      const rows = JSON.parse(buffer.toString("utf8"))?.rows;
      return Array.isArray(rows) && rows.length ? rows.at(-1).period : null;
    } catch {
      return null;
    }
  };
  const previous = lastPeriod(before);
  const next = lastPeriod(after);
  return previous && next && next < previous ? { previous, next } : null;
}

/** 按 period 合并两版 rows：以新抓取为准，但保留新结果未覆盖的历史期间。 */
function mergeRowsByPeriodInto(previousBuffer, nextBuffer) {
  const parse = (buffer) => JSON.parse(buffer.toString("utf8"));
  const previous = parse(previousBuffer);
  const next = parse(nextBuffer);
  if (!Array.isArray(previous?.rows) || !Array.isArray(next?.rows)) return null;
  const rows = new Map(previous.rows.map((row) => [row.period, row]));
  for (const row of next.rows) {
    const original = rows.get(row.period);
    if (!original) {
      rows.set(row.period, row);
      continue;
    }
    // 新抓取里为空的字段不覆盖已有已核验值（缺失不插值，但也不倒退）。
    const merged = { ...row };
    for (const [key, value] of Object.entries(original)) {
      if ((merged[key] === undefined || merged[key] === null) && value !== null && value !== undefined) merged[key] = value;
    }
    rows.set(row.period, merged);
  }
  const ordered = [...rows.values()].sort((left, right) => (left.period < right.period ? -1 : left.period > right.period ? 1 : 0));
  return Buffer.from(`${JSON.stringify({ ...next, rows: ordered }, null, 2)}\n`);
}

const stamp = new Date().toISOString().replaceAll(":", "").replace(/\..+$/, "");
const runDir = path.join(outputRoot, stamp);
const pendingDir = path.join(outputRoot, "pending");
const backupDir = path.join(runDir, "app-data");
await fs.mkdir(backupDir, { recursive: true });

const before = await snapshot(dataDir);
await Promise.all([...before].map(([name, buffer]) => fs.writeFile(path.join(backupDir, name), buffer)));

const results = [];
for (const collector of collectors) {
  const missing = [];
  for (const moduleName of collector.requires ?? []) {
    if (!(await run(python, ["-c", `import ${moduleName}`], { timeoutMs: 30_000 })).ok) missing.push(moduleName);
  }
  if (missing.length) {
    // 缺依赖时明确跳过而不是记成抓取失败：安装命令写在报告里，避免误判为数据源问题。
    results.push({ script: collector.script, status: "skipped", missing, output: `缺少 Python 模块：${missing.join(", ")}（安装：pip install -r scripts/requirements.txt）` });
    console.log(`SKIP ${collector.script} 缺少 ${missing.join(", ")}`);
    continue;
  }
  const started = Date.now();
  const { ok, output, code } = await run(python, [collector.script, ...collector.args], { timeoutMs: COLLECTOR_TIMEOUT_MS });
  results.push({ script: collector.script, status: ok ? "ok" : "failed", code, durationMs: Date.now() - started, output: output.trim().slice(0, 4_000) });
  console.log(`${ok ? "ok  " : "FAIL"} ${collector.script} (${Date.now() - started}ms)`);
}

const after = await snapshot(dataDir);
const changed = [];
const pending = [];
for (const [name, buffer] of after) {
  const original = before.get(name);
  if (original && crypto.createHash("sha256").update(original).digest("hex") === crypto.createHash("sha256").update(buffer).digest("hex")) continue;
  let candidate = buffer;
  if (original && mergeRowsByPeriod.has(name)) {
    const merged = mergeRowsByPeriodInto(original, buffer);
    if (merged) candidate = merged;
  }
  const missing = original ? missingTopLevelKeys(original, candidate) : [];
  const shrink = original ? rowsShrank(original, candidate) : null;
  const regress = original ? latestPeriodRegressed(original, buffer) : null;
  if (missing.length || shrink || regress) {
    await fs.writeFile(path.join(backupDir, name), buffer); // 保留采集结果但恢复线上文件
    await fs.mkdir(pendingDir, { recursive: true });
    await fs.writeFile(path.join(pendingDir, name), buffer);
    await fs.writeFile(path.join(dataDir, name), original);
    const reason = [
      missing.length ? `缺少顶层字段 ${missing.join(", ")}` : "",
      shrink ? `rows 由 ${shrink.beforeRows} 条缩短到 ${shrink.afterRows} 条` : "",
      regress ? `最新期间倒退（${regress.previous} → ${regress.next}）` : "",
    ].filter(Boolean).join("；");
    pending.push({ file: name, missingKeys: missing, reason });
    console.log(`HOLD ${name} ${reason}，已回滚并放入 pending/`);
  } else {
    if (candidate !== buffer) await fs.writeFile(path.join(dataDir, name), candidate);
    changed.push(name);
  }
}

const failed = results.filter((result) => result.status === "failed");
const skipped = results.filter((result) => result.status === "skipped");
const summary = {
  generatedAt: new Date().toISOString(),
  python,
  collectors: results.length,
  failed: failed.map((result) => result.script),
  skipped: skipped.map((result) => result.script),
  changed,
  pending,
  deployed: false,
};

const reportPath = path.join(runDir, "report.md");
await fs.mkdir(runDir, { recursive: true });
await fs.writeFile(reportPath, [
  `# 官方宏观数据抓取报告 ${summary.generatedAt}`,
  "",
  `- 采集器：${summary.collectors} 个，失败 ${failed.length} 个，跳过 ${skipped.length} 个`,
  `- 已更新：${changed.length ? changed.join("、") : "无"}`,
  `- 待人工合并：${pending.length ? pending.map((item) => `${item.file}（${item.reason}）`).join("；") : "无"}`,
  "",
  "## 采集器输出",
  "",
  ...results.flatMap((result) => [
    `### ${result.script} — ${result.status === "ok" ? `ok（${result.durationMs}ms）` : result.status === "skipped" ? "跳过" : `失败（exit ${result.code}）`}`,
    "",
    "```",
    result.output,
    "```",
    "",
  ]),
].join("\n"));

if (deploy && !failed.length && !skipped.length && !pending.length && changed.length) {
  const deployed = await run("bash", ["scripts/deploy-cloudflare.sh"], { timeoutMs: 30 * 60_000 });
  summary.deployed = deployed.ok;
  await fs.appendFile(reportPath, `\n## 发布\n\n${deployed.ok ? "deploy-cloudflare.sh 成功" : "deploy-cloudflare.sh 失败"}\n\n\`\`\`\n${deployed.output.slice(0, 4_000)}\n\`\`\`\n`);
  if (!deployed.ok) failed.push({ script: "scripts/deploy-cloudflare.sh" });
} else if (deploy) {
  console.log("跳过发布：存在失败、依赖缺失或待人工合并的文件，或本轮没有数据变化。");
}

// 最低成本的无人值守提醒：抓取失败、依赖缺失或出现待人工合并时弹一次桌面通知。
if ((failed.length || skipped.length || pending.length) && process.platform === "darwin") {
  const message = `${failed.length + skipped.length} 个采集器未完成，${pending.length} 个文件待人工合并`;
  await run("osascript", ["-e", `display notification "${message}" with title "资产配置工作台·官方数据"`], { timeoutMs: NOTIFY_TIMEOUT_MS });
}

console.log(JSON.stringify({ ...summary, reportPath }));
process.exit(failed.length ? 1 : 0);
