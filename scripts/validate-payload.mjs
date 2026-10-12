import fs from "node:fs/promises";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/validate-payload.mjs <payload.json>");
const payload = JSON.parse(await fs.readFile(file, "utf8"));
const assets = ["股票", "债券", "商品", "另类"];
const fail = (message) => { throw new Error(message); };

if (payload.schemaVersion !== 1) fail("schemaVersion must be 1");
if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.asOf ?? "")) fail("asOf must use YYYY-MM-DD");
if (!payload.collectedAt || Number.isNaN(Date.parse(payload.collectedAt))) fail("collectedAt must be an ISO timestamp");
if (!Number.isFinite(payload.index?.value)) fail("index.value must be numeric");
if (!Array.isArray(payload.factors) || payload.factors.length !== 19) fail("exactly 19 factors are required");
if (!Array.isArray(payload.styleFactors) || payload.styleFactors.length !== 6) fail("exactly 6 style factors are required");
const holdingTotal = assets.reduce((sum, asset) => sum + Number(payload.currentHoldings?.[asset] ?? 0), 0);
if (Math.abs(holdingTotal - 1) > 1e-6) fail("holdings must total 100%");
if (!Array.isArray(payload.sources)) fail("sources must be an array");
const sourceIds = new Set(payload.sources.map((source) => source.id));
for (const source of payload.sources) {
  if (typeof source.url !== "string" || !source.url.startsWith("https://")) fail(`source URL must use HTTPS: ${source.id}`);
}
for (const factor of [...payload.factors, ...payload.styleFactors]) {
  if (!Number.isFinite(factor.score) || factor.score < -2 || factor.score > 2) fail(`invalid score: ${factor.factor}`);
  if (!factor.evidence?.trim()) fail(`missing evidence: ${factor.factor}`);
  if (factor.verified && (!factor.sourceIds?.length || factor.sourceIds.some((id) => !sourceIds.has(id)))) fail(`verified factor has invalid sources: ${factor.factor}`);
}
for (const asset of assets) {
  const total = payload.factors.filter((factor) => factor.asset === asset).reduce((sum, factor) => sum + factor.weight, 0);
  if (Math.abs(total - 1) > 1e-6) fail(`${asset} weights must total 100%`);
}
console.log(`Payload valid: ${payload.asOf}, ${payload.factors.filter((factor) => factor.verified).length}/19 asset factors verified.`);
