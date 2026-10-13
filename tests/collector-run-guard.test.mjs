import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNode(scriptArgs, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", ...scriptArgs], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let output = "";
    child.stdout.on("data", (c) => { output += c; });
    child.stderr.on("data", (c) => { output += c; });
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("collector-run audit with --skip-collectors writes last-run and can exit 2 on stale", async () => {
  const lastRun = path.join(root, "output", "collector-last-run-test.json");
  const { code, output } = await runNode(
    ["scripts/collector-run.mjs", "--mode=audit", "--skip-collectors", "--skip-caixin"],
    { COLLECTOR_LAST_RUN: lastRun },
  );
  // Live data as of 2026-10 may be stale vs thresholds → exit 2, or 0 if miraculously fresh.
  assert.ok(code === 0 || code === 2, `unexpected exit ${code}: ${output.slice(-500)}`);
  const report = JSON.parse(await readFile(lastRun, "utf8"));
  assert.equal(report.mode, "audit");
  assert.ok(report.steps.some((s) => s.id === "stale-check"));
  assert.ok(report.steps.some((s) => s.id === "collectors" && s.skipped));
  assert.equal(report.policy.includes("D1"), true);
});
