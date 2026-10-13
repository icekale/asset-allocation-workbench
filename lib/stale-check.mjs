/**
 * Freshness checks for key macro workbench series.
 * Compares asOf / updated / coverageEnd / latestPeriod against Asia/Shanghai "today".
 * Read-only: never mutates app/data.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

function shanghaiToday(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // YYYY-MM-DD
}

function parseYmd(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const m = text.match(/(20\d{2})[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?/);
  if (!m) return null;
  const y = m[1];
  const mo = String(m[2]).padStart(2, "0");
  const d = m[3] ? String(m[3]).padStart(2, "0") : "01";
  return `${y}-${mo}-${d}`;
}

function daysBetween(earlierYmd, laterYmd) {
  if (!earlierYmd || !laterYmd) return null;
  const a = Date.parse(`${earlierYmd}T00:00:00+08:00`);
  const b = Date.parse(`${laterYmd}T00:00:00+08:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

function lastPeriodFromRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const periods = rows.map((row) => row?.period ?? row?.date ?? row?.year).filter(Boolean).map(String);
  if (!periods.length) return null;
  return periods.sort().at(-1);
}

/** @typedef {{ id: string, label: string, maxAgeDays: number, asOf: string|null, source: string, stale: boolean, ageDays: number|null, note?: string }} StaleItem */

/**
 * @param {string} root
 * @param {{ now?: Date }} [options]
 */
export async function checkMacroStaleness(root, options = {}) {
  const today = shanghaiToday(options.now ?? new Date());
  const dataDir = path.join(root, "app", "data");
  /** @type {StaleItem[]} */
  const items = [];

  async function loadJson(name) {
    try {
      return JSON.parse(await readFile(path.join(dataDir, name), "utf8"));
    } catch (error) {
      return { __error: error instanceof Error ? error.message : String(error) };
    }
  }

  function push(item) {
    const ageDays = daysBetween(item.asOf, today);
    items.push({
      ...item,
      ageDays,
      stale: ageDays == null ? true : ageDays > item.maxAgeDays,
    });
  }

  const policy = await loadJson("macro-policy.json");
  push({
    id: "macro-policy.updated",
    label: "政策跟踪文件 updated",
    maxAgeDays: 45,
    asOf: parseYmd(policy.updated) ?? parseYmd(policy.__error),
    source: "app/data/macro-policy.json",
    note: policy.lpr?.rows ? `LPR rows=${policy.lpr.rows.length}` : policy.__error,
  });

  const sf = await loadJson("macro-social-financing.json");
  push({
    id: "macro-social-financing.coverageEnd",
    label: "社融存量覆盖截止",
    maxAgeDays: 50,
    asOf: parseYmd(sf.coverageEnd) ?? parseYmd(lastPeriodFromRows(sf.rows)),
    source: "app/data/macro-social-financing.json",
  });

  const money = await loadJson("macro-money-supply.json");
  push({
    id: "macro-money-supply.rows",
    label: "货币供应量最新期",
    maxAgeDays: 50,
    asOf: parseYmd(lastPeriodFromRows(money.rows)),
    source: "app/data/macro-money-supply.json",
  });

  const prices = await loadJson("macro-price-history.json");
  push({
    id: "macro-price-history.latestPeriod",
    label: "价格历史 latestPeriod",
    maxAgeDays: 50,
    asOf: parseYmd(prices.latestPeriod) ?? parseYmd(lastPeriodFromRows(prices.rows)),
    source: "app/data/macro-price-history.json",
  });

  const advisory = await loadJson("advisory.json");
  const byId = new Map((advisory.macroIndicators ?? []).map((row) => [row.id, row]));
  for (const [id, maxAgeDays, label] of [
    ["M11", 10, "美元中间价"],
    ["M12", 21, "CFETS"],
    ["M20", 50, "消费者信心"],
    ["M43", 50, "贸易差额"],
    ["M62", 10, "DR007"],
    ["M63", 10, "R007"],
  ]) {
    const row = byId.get(id);
    push({
      id: `advisory.${id}`,
      label,
      maxAgeDays,
      asOf: parseYmd(row?.period) ?? null,
      source: "app/data/advisory.json",
      note: row ? `value=${row.currentValue}; source=${row.currentSource}` : "指标缺失",
    });
  }

  const stale = items.filter((item) => item.stale);
  return {
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    today,
    summary: {
      checked: items.length,
      stale: stale.length,
      ok: items.length - stale.length,
    },
    items,
    staleIds: stale.map((item) => item.id),
  };
}

export { shanghaiToday, parseYmd, daysBetween };
