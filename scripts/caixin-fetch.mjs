import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { getCaixinObservations, getCaixinSeries, searchCaixinSeries } from "../lib/caixin.ts";

async function loadEnv(path) {
  const values = {};
  const text = await readFile(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
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
      /* try next */
    }
  }
  return ".env.local";
}

const local = await loadEnv(await resolveEnvFile());
const config = {
  apiKey: process.env.CAIXIN_API_KEY ?? local.CAIXIN_API_KEY ?? "",
  baseUrl: process.env.CAIXIN_API_BASE_URL ?? process.env.CAIXIN_API_BASE ?? local.CAIXIN_API_BASE_URL ?? local.CAIXIN_API_BASE,
  userAgent: process.env.CAIXIN_API_USER_AGENT ?? local.CAIXIN_API_USER_AGENT,
};
const [command, value] = process.argv.slice(2);
if (!command || !value) throw new Error("Usage: node --experimental-strip-types scripts/caixin-fetch.mjs <search|meta|observations> <query-or-series-id>");

const result = command === "search"
  ? await searchCaixinSeries(value, config, { pageSize: 20 })
  : command === "meta"
    ? await getCaixinSeries(value, config)
    : command === "observations"
      ? await getCaixinObservations(value, config, { pageSize: 100 })
      : (() => { throw new Error(`Unknown command: ${command}`); })();
console.log(JSON.stringify(result, null, 2));
