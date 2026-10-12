import { env } from "cloudflare:workers";
import { calculateModel } from "./model";
import { seedPayload } from "./seed";
import { ASSET_NAMES, type MarketInputPayload } from "./types";

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error("D1 binding DB is unavailable");
  return binding;
}

let schemaReady: Promise<void> | undefined;

function createSchema() {
  const db = database();
  return db
    .prepare(`
      CREATE TABLE IF NOT EXISTS dataset_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        as_of TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        checksum TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .run()
    .then(() =>
      db
        .prepare("CREATE INDEX IF NOT EXISTS dataset_versions_collected_at_idx ON dataset_versions (collected_at DESC, id DESC)")
        .run(),
    )
    .then(() => undefined);
}

/** 建表只做一次（每个 isolate 一次），避免每次读写都跑两遍 DDL。 */
function ensureSchema() {
  schemaReady ??= createSchema().catch((error: unknown) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

function payloadString(payload: MarketInputPayload) {
  return JSON.stringify(payload);
}

async function checksum(payload: MarketInputPayload) {
  const bytes = new TextEncoder().encode(payloadString(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validatePayload(value: unknown): asserts value is MarketInputPayload {
  if (!value || typeof value !== "object") throw new Error("payload must be an object");
  const payload = value as Partial<MarketInputPayload>;
  if (payload.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!payload.asOf || !/^\d{4}-\d{2}-\d{2}$/.test(payload.asOf)) throw new Error("asOf must use YYYY-MM-DD");
  if (!payload.collectedAt || Number.isNaN(Date.parse(payload.collectedAt))) throw new Error("collectedAt must be an ISO timestamp");
  if (!payload.index || !Number.isFinite(payload.index.value)) throw new Error("index.value must be numeric");
  if (!payload.currentHoldings) throw new Error("currentHoldings is required");
  const holdingTotal = ASSET_NAMES.reduce((sum, asset) => sum + Number(payload.currentHoldings?.[asset] ?? 0), 0);
  if (Math.abs(holdingTotal - 1) > 1e-6) throw new Error("currentHoldings must total 100%");
  if (!Array.isArray(payload.factors) || payload.factors.length !== 19) throw new Error("exactly 19 asset factors are required");
  if (!Array.isArray(payload.styleFactors) || payload.styleFactors.length !== 6) throw new Error("exactly 6 style factors are required");
  for (const factor of [...payload.factors, ...payload.styleFactors]) {
    if (!Number.isFinite(factor.score) || factor.score < -2 || factor.score > 2) {
      throw new Error(`factor score out of range: ${factor.factor}`);
    }
    if (!factor.evidence?.trim()) throw new Error(`factor evidence is required: ${factor.factor}`);
  }
  for (const asset of ASSET_NAMES) {
    const weight = payload.factors
      .filter((factor) => factor.asset === asset)
      .reduce((sum, factor) => sum + factor.weight, 0);
    if (Math.abs(weight - 1) > 1e-6) throw new Error(`${asset} factor weights must total 100%`);
  }
  if (!Array.isArray(payload.sources)) throw new Error("sources must be an array");
  const sourceIds = new Set(payload.sources.map((source) => source.id));
  for (const source of payload.sources) {
    if (!source.url.startsWith("https://")) throw new Error(`source URL must use HTTPS: ${source.id}`);
  }
  for (const factor of [...payload.factors, ...payload.styleFactors]) {
    for (const sourceId of factor.sourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`unknown source id ${sourceId} on ${factor.factor}`);
    }
    if (factor.verified && factor.sourceIds.length === 0) {
      throw new Error(`verified factor needs at least one source: ${factor.factor}`);
    }
  }
  calculateModel(payload as MarketInputPayload);
}

export async function latestPayload(): Promise<MarketInputPayload> {
  try {
    await ensureSchema();
    // 按自增 id 取最近写入的版本：collected_at 是各采集器写入的文本，
    // 时区偏移格式不统一，字典序并不等于时间先后。
    const rows = await database()
      .prepare("SELECT payload_json FROM dataset_versions ORDER BY id DESC LIMIT 5")
      .all<{ payload_json: string }>();
    for (const row of rows.results ?? []) {
      try {
        const payload = JSON.parse(row.payload_json) as MarketInputPayload;
        validatePayload(payload);
        return payload;
      } catch (error) {
        console.error("Skipping unreadable dataset version", error);
      }
    }
    return seedPayload;
  } catch (error) {
    console.error("Falling back to seed payload", error);
    return seedPayload;
  }
}

export async function savePayload(payload: MarketInputPayload) {
  validatePayload(payload);
  await ensureSchema();
  const digest = await checksum(payload);
  const existing = await database()
    .prepare("SELECT id FROM dataset_versions WHERE checksum = ? LIMIT 1")
    .bind(digest)
    .first<{ id: number }>();
  if (existing) return { id: existing.id, checksum: digest, duplicate: true };
  const result = await database()
    .prepare(
      "INSERT INTO dataset_versions (as_of, collected_at, status, payload_json, checksum) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(payload.asOf, payload.collectedAt, payload.status, payloadString(payload), digest)
    .run();
  return { id: Number(result.meta.last_row_id), checksum: digest, duplicate: false };
}
