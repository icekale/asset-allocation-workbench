import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("json_merge_guard self-test passes", () => {
  const result = spawnSync("python3", ["scripts/json_merge_guard.py"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /self-test ok/);
});

test("social-financing merge preserve keeps flowComponents in a dry fixture", () => {
  const code = `
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, "scripts")
from json_merge_guard import merge_preserve, never_move_updated_backwards, write_merged, load_existing
existing = {
  "unit": "%", "basis": "x", "rows": [{"period": f"2020-{i:02d}"} for i in range(1, 11)],
  "historicalSource": "h", "coverageStart": "2020-01", "coverageEnd": "2020-10",
  "flowComponents": {"rows": [1, 2, 3]}, "monthlyIncrement": {"rows": [4]},
}
owned = {
  "unit": "%", "basis": "y", "rows": [{"period": f"2020-{i:02d}"} for i in range(1, 11)],
  "historicalSource": "h", "coverageStart": "2020-01", "coverageEnd": "2020-10",
}
merged = merge_preserve(existing, owned, owned_keys={"unit","basis","rows","historicalSource","coverageStart","coverageEnd"}, series_paths=[("rows",)])
assert "flowComponents" in merged and "monthlyIncrement" in merged
assert merged["basis"] == "y"
# shrink guard
try:
  merge_preserve(existing, {**owned, "rows": [{"period":"2020-01"}]}, owned_keys={"unit","basis","rows","historicalSource","coverageStart","coverageEnd"}, series_paths=[("rows",)])
  raise SystemExit("expected shrink guard")
except Exception as exc:
  assert "shrink" in str(exc)
print("ok")
`
  const result = spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("macro-policy never moves updated backwards and keeps fundingRate", () => {
  const code = `
import sys
sys.path.insert(0, "scripts")
from json_merge_guard import merge_preserve, never_move_updated_backwards
existing = {"updated": "2026-10-05", "lpr": {"rows": list(range(90))}, "fundingRate": {"rows": [1]}, "specialBondIssuance": {"rows": [2]}}
owned = {"updated": "2026-10-01", "lpr": {"rows": list(range(90))}, "bond": {"rows": list(range(100))}, "fiscal": {"rows": list(range(10))}, "deficitTarget": {"rows": []}, "imfDeficit": {"rows": list(range(20))}, "mlfNote": {}}
never_move_updated_backwards(existing, owned)
merged = merge_preserve(existing, owned, owned_keys={"updated","lpr","bond","fiscal","deficitTarget","imfDeficit","mlfNote"}, series_paths=[("lpr","rows")])
assert merged["updated"] == "2026-10-05"
assert "fundingRate" in merged and "specialBondIssuance" in merged
print("ok")
`
  const result = spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
