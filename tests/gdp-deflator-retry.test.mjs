import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("GDP deflator collector documents retries and soft-fail wiring", async () => {
  const py = await readFile(path.join(root, "scripts/collect-nbs-gdp-deflator.py"), "utf8");
  assert.match(py, /attempts/);
  assert.match(py, /retry in/);
  assert.match(py, /USER_AGENT/);

  const refresh = await readFile(path.join(root, "scripts/refresh-official-macro.mjs"), "utf8");
  assert.match(refresh, /soft:\s*true/);
  assert.match(refresh, /softFailed/);
  assert.match(refresh, /hardFailed/);
  assert.match(refresh, /data-revision\.json/);
  assert.match(refresh, /process\.exit\(hardFailed\.length \|\| pending\.length \? 1 : 0\)/);

  const revision = JSON.parse(await readFile(path.join(root, "app/data/data-revision.json"), "utf8"));
  assert.ok(revision.refreshedAt);
  assert.equal(revision.timezone, "Asia/Shanghai");
});

test("collector wrapper creates collector-last.log symlink after run", async () => {
  const wrapper = await readFile(path.join(root, "collector/dmit/aaw-collector.sh"), "utf8");
  assert.match(wrapper, /ln -sfn "\$LOG" "\$LOG_DIR\/collector-last\.log"/);
  assert.doesNotMatch(wrapper, /exit "\$code"\n\} >>/);
  assert.match(wrapper, /prune_logs/);
});
