#!/usr/bin/env node
import path from "node:path";
import { buildSourceHealth, writeSourceHealth } from "../lib/source-health.mjs";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const health = await buildSourceHealth(root);
await writeSourceHealth(root, health);
console.log(JSON.stringify({ ...health.summary, today: health.today, alerts: health.alerts.length }, null, 2));
process.exit(health.summary.stale > 0 ? 2 : 0);
