const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function normalizePeriod(raw) {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null;
}

export function parseOfficialLevel(text, period) {
  if (!MONTH_PATTERN.test(period) || typeof text !== "string") return null;
  const [year, month] = period.split("-");
  const arabicMonth = String(Number(month));
  const periodMention = new RegExp(`${year}年\\s*${arabicMonth}月(?:份)?`).test(text)
    || new RegExp(`${arabicMonth}月份`).test(text);
  if (!periodMention) return null;
  const patterns = [
    /消费者信心指数(?:为|是|达到|回升至|降至)\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:点)?/g,
    /([0-9]{1,3}(?:\.[0-9]+)?)\s*点的消费者信心指数/g,
  ];
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 1) {
      const value = Number(matches[0][1]);
      if (value >= 0 && value <= 200) return value;
    }
  }
  return null;
}

export function normalizeObservations(observations, provenance) {
  if (!Array.isArray(observations)) throw new Error("消费者信心序列观测值必须为数组");
  const rows = new Map();
  for (const observation of observations) {
    const period = normalizePeriod(observation.period ?? observation.date);
    const value = observation.value;
    if (!period || (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 200))) continue;
    if (value === null) continue;
    if (rows.has(period) && rows.get(period).value !== value) throw new Error(`消费者信心序列 ${period} 出现重复冲突值`);
    rows.set(period, { ...provenance, ...observation, period, value,
      sourceUrl: observation.sourceUrl ?? provenance.sourceUrl ?? null });
  }
  return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function mergeBySourcePriority(...sources) {
  const merged = new Map();
  for (const rows of sources) {
    for (const row of rows) {
      if (!merged.has(row.period)) merged.set(row.period, row);
    }
  }
  return [...merged.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function expectedPeriods(start, end) {
  if (!MONTH_PATTERN.test(start) || !MONTH_PATTERN.test(end) || start > end) throw new Error("月份范围必须为 YYYY-MM 且起点不晚于终点");
  const periods = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    periods.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return periods;
}

export function coverage(rows, start, end) {
  const present = new Set(rows.map((row) => row.period));
  const expected = expectedPeriods(start, end);
  return { expected: expected.length, found: expected.filter((period) => present.has(period)).length,
    missing: expected.filter((period) => !present.has(period)) };
}

// Append-only merge into the intrayear chart row (periods like "7月", or "2027年1月" after a year change).
// Existing points are never rewritten; a conflicting vendor value is reported and the point is kept.
export function appendToIntrayear(target, records, baselineYear) {
  const labelFor = (period) => {
    const [y, m] = period.split("-");
    return y === String(baselineYear) ? `${Number(m)}月` : `${y}年${Number(m)}月`;
  };
  const periodFor = (label) => {
    const full = label.match(/^(\d{4})年(\d{1,2})月$/);
    if (full) return `${full[1]}-${full[2].padStart(2, "0")}`;
    const short = label.match(/^(\d{1,2})月$/);
    return short ? `${baselineYear}-${short[1].padStart(2, "0")}` : null;
  };
  const existing = new Map(target.periods.map((label, i) => [periodFor(label), target.values[i]]));
  const lastPeriod = [...existing.keys()].filter(Boolean).sort().at(-1) ?? `${baselineYear}-00`;
  const conflicts = [];
  const appended = [];
  for (const row of records) {
    if (existing.has(row.period)) {
      if (existing.get(row.period) !== row.value) conflicts.push({ period: row.period, kept: existing.get(row.period), offered: row.value, sourceId: row.sourceId });
      continue;
    }
    if (row.period <= lastPeriod) continue; // never back-fill or reorder history
    appended.push(row);
  }
  appended.sort((a, b) => a.period.localeCompare(b.period));
  const next = { ...target, periods: [...target.periods], values: [...target.values],
    observationSources: [...(target.observationSources ?? [])] };
  for (const row of appended) {
    next.periods.push(labelFor(row.period));
    next.values.push(row.value);
    next.observationSources.push({ period: row.period, value: row.value, sourceId: row.sourceId, source: row.source ?? null, sourceUrl: row.sourceUrl ?? null });
  }
  return { target: next, appended, conflicts };
}

// Replace one series object inside hand-formatted JSON text without reflowing the rest of the file.
export function spliceSeriesText(text, metric, nextObject) {
  const key = `"metric": ${JSON.stringify(metric)}`;
  const at = text.indexOf(key);
  if (at < 0 || text.indexOf(key, at + 1) >= 0) throw new Error(`无法唯一定位指标 ${metric}`);
  const start = text.lastIndexOf("{", at);
  let depth = 0; let inString = false; let end = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) { if (ch === "\\") i += 1; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error("指标对象括号不匹配");
  const lineStart = text.lastIndexOf("\n", start) + 1;
  const indent = text.slice(lineStart, start).match(/^\s*/)[0];
  const body = Object.entries(nextObject).map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
  const out = `${text.slice(0, start)}{\n${body}\n${indent}}${text.slice(end)}`;
  JSON.parse(out);
  return out;
}
