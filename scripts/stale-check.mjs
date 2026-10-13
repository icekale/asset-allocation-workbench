#!/usr/bin/env node
/**
 * CLI: check macro data freshness. Exit 2 when any key series is stale.
 * Usage: node --experimental-strip-types scripts/stale-check.mjs [report.json]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkMacroStaleness } from "../lib/stale-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.resolve(
  process.argv[2] || process.env.STALE_CHECK_REPORT || path.join(root, "output", "stale-check.json"),
);
const report = await checkMacroStaleness(root);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, today: report.today, staleIds: report.staleIds, reportPath }, null, 2));
process.exit(report.summary.stale > 0 ? 2 : 0);
