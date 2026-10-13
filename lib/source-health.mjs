// Per-source health: last success, expected next release, stale flag. Read-only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { checkMacroStaleness } from "./stale-check.mjs";

const shanghaiToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const addDays = (ymd, n) => {
  const t = Date.parse(`${ymd}T00:00:00+08:00`);
  return new Date(t + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
};

/** Count weekdays (Mon–Fri) strictly after fromYmd up to and including toYmd. */
export function tradingDaysBetween(fromYmd, toYmd) {
  if (!fromYmd || !toYmd || fromYmd > toYmd) return null;
  let n = 0;
  let cur = fromYmd;
  while (cur < toYmd) {
    const t = Date.parse(`${cur}T00:00:00+08:00`) + 86_400_000;
    cur = new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    const dow = new Date(`${cur}T12:00:00+08:00`).getUTCDay(); // 0=Sun … — careful
    // Use Shanghai calendar weekday via Intl
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date(`${cur}T12:00:00+08:00`));
    if (!["Sat", "Sun"].includes(wd)) n += 1;
  }
  return n;
}


/** Expected cadence heuristics (calendar days after last asOf). Conservative upper bounds. */
const EXPECTED = {
  "macro-policy.updated": { cadenceDays: 31, label: "政策/流动性月表" },
  "macro-social-financing.coverageEnd": { cadenceDays: 35, label: "社融" },
  "macro-money-supply.rows": { cadenceDays: 35, label: "货币供应量" },
  "macro-price-history.latestPeriod": { cadenceDays: 35, label: "CPI" },
  "judgement.cnbs": { cadenceDays: 100, label: "CNBS 季度杠杆率" },
  "judgement.toolTables": { cadenceDays: 40, label: "央行工具流动性月表" },
  "collector.lastRun": { cadenceDays: 3, label: "采集任务上次运行" },
  "index.asOf": { cadenceDays: 3, label: "上证指数 asOf" },
};

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (e) { return { __error: e.message }; }
}

export async function buildSourceHealth(root, { now = new Date(), indexHealth = null, healthUrl = process.env.AAW_HEALTH_URL || "http://[::1]:8788/api/health" } = {}) {
  if (!indexHealth && healthUrl) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) indexHealth = await res.json();
    } catch { /* portal may be down during audit */ }
  }
  const today = shanghaiToday(now);
  const stale = await checkMacroStaleness(root, { now });
  const sources = stale.items.map((item) => {
    const meta = EXPECTED[item.id] || { cadenceDays: item.maxAgeDays, label: item.label };
    const expectedNext = item.asOf ? addDays(item.asOf, meta.cadenceDays) : null;
    const overdue = expectedNext ? expectedNext < today : item.stale;
    return {
      id: item.id, label: meta.label || item.label, source: item.source,
      lastSuccess: item.asOf, expectedNextRelease: expectedNext, cadenceDays: meta.cadenceDays,
      ageDays: item.ageDays, maxAgeDays: item.maxAgeDays, stale: item.stale, overdue,
      note: item.note || null, severity: item.stale || overdue ? (item.stale ? "stale" : "overdue") : "ok",
    };
  });

  const jev = await readJson(path.join(root, "app/data/macro-rating-judgement-evidence.json"));
  if (!jev.__error) {
    const cnbs = Object.keys(jev.cnbs || {}).sort().at(-1) || null;
    const tools = Object.keys(jev.toolTables || {}).sort().at(-1) || null;
    for (const [id, last, cadence, label, src] of [
      ["judgement.cnbs", cnbs && `${cnbs.slice(0, 4)}-${String(Number(cnbs.slice(6)) * 3).padStart(2, "0")}-01`, 100, "CNBS 季度杠杆率", "macro-rating-judgement-evidence.json"],
      ["judgement.toolTables", tools && `${tools}-01`, 40, "央行工具流动性月表", "macro-rating-judgement-evidence.json"],
    ]) {
      const ageDays = last ? Math.floor((Date.parse(`${today}T00:00:00+08:00`) - Date.parse(`${last}T00:00:00+08:00`)) / 86_400_000) : null;
      const expectedNext = last ? addDays(last, cadence) : null;
      const staleFlag = ageDays == null || ageDays > cadence;
      sources.push({ id, label, source: src, lastSuccess: last, expectedNextRelease: expectedNext, cadenceDays: cadence,
        ageDays, maxAgeDays: cadence, stale: staleFlag, overdue: expectedNext ? expectedNext < today : staleFlag,
        note: null, severity: staleFlag ? "stale" : "ok" });
    }
  }

  const collector = await readJson(path.join(root, "output/collector-last-run.json"));
  if (!collector.__error) {
    const asOf = (collector.finishedAt || collector.startedAt || "").slice(0, 10) || null;
    const ageDays = asOf ? Math.floor((Date.parse(`${today}T00:00:00+08:00`) - Date.parse(`${asOf}T00:00:00+08:00`)) / 86_400_000) : null;
    sources.push({ id: "collector.lastRun", label: "采集任务上次运行", source: "output/collector-last-run.json",
      lastSuccess: asOf, expectedNextRelease: asOf ? addDays(asOf, 3) : null, cadenceDays: 3,
      ageDays, maxAgeDays: 3, stale: ageDays == null || ageDays > 3, overdue: ageDays != null && ageDays > 3,
      note: collector.mode || collector.status || null, severity: ageDays == null || ageDays > 3 ? "stale" : "ok" });
  }

  if (indexHealth) {
    const asOf = indexHealth.asOf || null;
    const td = tradingDaysBetween(asOf, today);
    const staleTd = td == null || td > 3 || indexHealth.status === "seed";
    sources.push({ id: "portfolio.asOf", label: "组合数据日 (D1 asOf)", source: "api/health",
      lastSuccess: asOf, expectedNextRelease: asOf ? addDays(asOf, 1) : null, cadenceDays: 3,
      ageDays: indexHealth.ageHours != null ? Math.floor(indexHealth.ageHours / 24) : null,
      maxAgeDays: 3, stale: staleTd, overdue: staleTd,
      note: `status=${indexHealth.status ?? "?"} tradingDaysBehind=${td ?? "?"} ageHours=${indexHealth.ageHours ?? "?"}`,
      severity: staleTd ? "stale" : "ok",
      tradingDaysBehind: td });
  }

  const alerts = sources.filter((s) => s.severity !== "ok").map((s) => ({
    id: s.id, severity: s.severity, title: `${s.label} ${s.severity === "stale" ? "已过期" : "超过预期发布窗"}`,
    lastSuccess: s.lastSuccess, expectedNextRelease: s.expectedNextRelease, ageDays: s.ageDays, at: today,
  }));
  return {
    generatedAt: now.toISOString(), today, summary: {
      total: sources.length, ok: sources.filter((s) => s.severity === "ok").length,
      stale: sources.filter((s) => s.severity === "stale").length,
      overdue: sources.filter((s) => s.severity === "overdue").length, alerts: alerts.length,
    },
    sources, alerts,
    notification: {
      status: "portal-only",
      note: "告警已写入 output/alerts.json 并在门户「运维健康」展示。外部通知（邮件 / Telegram）需你提供接收配置后才启用，当前不会外发。",
      optionsNeedingUserInput: [
        { channel: "email", needs: ["SMTP 或事务邮件 API", "收件人地址"] },
        { channel: "telegram", needs: ["Bot token", "chat_id"] },
      ],
    },
  };
}

export async function writeSourceHealth(root, health) {
  const out = path.join(root, "output");
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "source-health.json"), `${JSON.stringify(health, null, 2)}\n`);
  await writeFile(path.join(out, "alerts.json"), `${JSON.stringify({ generatedAt: health.generatedAt, today: health.today, alerts: health.alerts, notification: health.notification }, null, 2)}\n`);
}
