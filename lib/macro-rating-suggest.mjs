// Machine-drafted suggestions for the judgement items. A suggestion is NEVER applied by itself:
// buildDraft keeps the previous observation (沿用) unless a matching user decision exists.
// Suggestions use only the existing rules' scale/definitions; the default suggestion is the
// previous grade, and objective signals are listed for the user to judge (no new formula).
import crypto from "node:crypto";
import { scoreIndicator } from "./macro-rating.mjs";

export const JUDGEMENT_IDS = ["F09", "F10", "P03A", "P03B", "P04A", "P04B", "P02E"];
const LABEL = "建议(待确认)";
const clone = (x) => structuredClone(x);
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const qAdd = (p, n) => { let y = +p.slice(0, 4), q = +p.slice(6) + n; while (q < 1) { q += 4; y -= 1; } while (q > 4) { q -= 4; y += 1; } return `${y}-Q${q}`; };
const mAdd = (p, n) => { let [y, m] = p.split("-").map(Number); m += n; while (m < 1) { m += 12; y -= 1; } while (m > 12) { m -= 12; y += 1; } return `${y}-${String(m).padStart(2, "0")}`; };
const monthEnd = (p) => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7), 0)).toISOString().slice(0, 10);
const hash = (x) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
const latest = (obj, ok = () => true) => Object.keys(obj || {}).sort().filter((k) => ok(obj[k], k)).at(-1) ?? null;
const sgn = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d);

function leverage(ctx) {
  const { rule, prev, jev, ev, asOf } = ctx;
  const household = rule.id === "F09", side = household ? "household" : "corporate";
  const evidence = [], signals = [];
  const L = latest(jev.cnbs);
  const r = L ? jev.cnbs[L] : null;
  if (r) {
    evidence.push({ label: `CNBS ${household ? "居民" : "非金融企业"}部门杠杆率`, value: `${r[side].value}%（较上季${sgn(r[side].change)}个百分点）`, period: L, url: r.sourceUrl, releaseDate: r.releaseDate });
    const ya = jev.cnbs[qAdd(L, -4)]?.[side]?.value ?? (prev.leverageComponents?.find((c) => c.period === qAdd(L, -4))?.value);
    if (fin(ya)) signals.push(`杠杆率同比${sgn(r[side].value - ya)}个百分点（${qAdd(L, -4)} ${ya}% → ${L} ${r[side].value}%）`);
    const dg = household ? r.householdDebtGrowth : r.corporateDebtGrowth;
    if (fin(dg)) { evidence.push({ label: `CNBS ${household ? "居民" : "企业"}部门债务同比`, value: `${dg}%`, period: L, url: r.sourceUrl, releaseDate: r.releaseDate }); }
  }
  const dsr = jev.bis?.dsrPrivate, gap = jev.bis?.creditGap;
  if (dsr?.rows?.length) {
    const a = dsr.rows.at(-1), b = dsr.rows.find((x) => x.period === qAdd(a.period, -4));
    evidence.push({ label: "BIS 私人非金融部门偿债比率DSR（中国无居民/企业拆分）", value: `${a.value}%${b ? `（同比${sgn(a.value - b.value)}）` : ""}`, period: a.period, url: dsr.sourceUrl, releaseDate: dsr.retrievedAt });
  }
  if (gap?.rows?.length) { const a = gap.rows.at(-1); evidence.push({ label: "BIS 信贷/GDP缺口", value: `${a.value.toFixed(2)}个百分点`, period: a.period, url: gap.sourceUrl, releaseDate: gap.retrievedAt }); }
  if (household) {
    const c = ev.credit; const row = c?.rows?.at?.(-1);
    if (row) evidence.push({ label: "央行住户贷款（代理）", value: ["householdShort", "householdLong"].every((k) => fin(row[k])) ? `住户短期贷款当月${row.householdShort}亿元、中长期${row.householdLong}亿元` : "见原表", period: row.period, url: row.url, releaseDate: null });
  } else {
    const p = latest(ev.profit, (x) => fin(x.ytdYoy ?? x.headline?.ytdYoy));
    if (p) { const x = ev.profit[p]; evidence.push({ label: "国家统计局规上工业利润累计同比（代理，非全部企业）", value: `${x.ytdYoy ?? x.headline?.ytdYoy}%`, period: p, url: x.url, releaseDate: x.releaseDate }); }
  }
  const newQuarter = L && L > prev.period;
  const candidate = newQuarter ? null : clone(prev);
  return {
    suggestedValue: prev.value, period: newQuarter ? L : prev.period, evidence, signals,
    rationale: newQuarter
      ? `CNBS已发布${L}杠杆率。现行规则用证据矩阵（scoringMatrix/leverageReview）由结构化复核推导分档，系统不自动判定；建议以上一档${prev.value}分作为复核起点。确认前须按既有矩阵补齐新季度复核表，草稿沿用${prev.period}观察。`
      : `暂无比${prev.period}更新的CNBS季度数据。建议维持${prev.value}分（既有矩阵结论）；确认仅记录“已复核新辅证、维持原档”。`,
    candidate, editable: null,
    limitation: "分值必须等于既有证据矩阵计算结果，门户不提供直接改分；新季度需人工补齐结构化复核后再发布。",
  };
}

function policy(ctx) {
  const { rule, prev, jev, asOf } = ctx;
  const since = prev.policyReview?.reviewDate || prev.reviewDate || "0000";
  const from = new Date(Date.parse(asOf + "T00:00:00Z") - 120 * 864e5).toISOString().slice(0, 10);
  const recent = Object.values(jev.policyDocs || {}).filter((d) => d.themes?.includes(rule.policyTheme) && d.releaseDate >= from && d.releaseDate <= asOf)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const docs = recent.filter((d) => d.releaseDate > since);
  const evidence = [
    { label: "沿用的主证据（上一版）", value: prev.source || prev.sourceUrl, period: prev.period, url: prev.sourceUrl, releaseDate: prev.releaseDate },
    ...recent.slice(0, 12).map((d) => ({ label: `${d.releaseDate > since ? "新文件" : "近120天已复核期内文件"}·${d.publisher}`, value: d.title, period: d.releaseDate.slice(0, 7), url: d.url, releaseDate: d.releaseDate })),
  ];
  const period = asOf.slice(0, 7);
  const candidate = clone(prev);
  Object.assign(candidate, { period, latestAvailablePeriod: period, verifiedAt: asOf, reviewDate: asOf });
  candidate.policyReview = { ...candidate.policyReview, reviewDate: asOf };
  return {
    suggestedValue: prev.value, period, evidence,
    signals: [`${since}（上次复核）之后同主题新文件${docs.length}份；近120天同主题文件${recent.length}份（标题关键词归类，需人工判断是否改变实施条件）`],
    rationale: `按既有五档（4分=有效正式文件且实施条件明确；5分须与范围相符的官方执行证据）复核：上一版主证据仍在有效期内的前提下，建议维持${prev.value}分。${docs.length ? "新文件可能涉及本主题，请核对是否构成执行进展或新的正式规则后再改档。" : "未发现同主题新文件。"}`,
    candidate, editable: { min: 1, max: 5, step: 1 },
    limitation: "关键词归类可能漏检部门文件；改档需填写理由，5分仍须满足既有执行证据要求，否则规则核验拒绝。",
  };
}

function rrr(ctx) {
  const { prev, jev, ev, asOf } = ctx;
  const tables = jev.toolTables || {};
  const lastFull = mAdd(asOf.slice(0, 7), -1);
  const end = latest(tables, (t, k) => k <= lastFull && t.releaseDate <= asOf);
  if (!end) return { suggestedValue: null, period: prev.period, evidence: [], signals: ["未取得央行月度工具表"], rationale: "证据不足，建议沿用。", candidate: null, editable: null };
  const months = Array.from({ length: 12 }, (_, i) => mAdd(end, i - 11));
  const missing = months.filter((m) => !tables[m]);
  const windowStart = `${months[0]}-01`, windowEnd = monthEnd(end);
  const notices = Object.values(jev.rrrNotices || {}).filter((n) => n.effectiveDate && n.effectiveDate >= windowStart && n.effectiveDate <= windowEnd);
  const events = notices.map((n, i) => ({
    eventId: `RRR-${n.effectiveDate}-${i + 1}`, executed: n.effectiveDate <= asOf, scopeType: n.scopeGuess?.startsWith("普遍") ? "普遍" : "定向",
    currency: "人民币", unit: "基点", signedChangeBp: n.signedChangeBp, rawChange: n.rawChange,
    institutionCoverage: n.excerpt, exceptionNote: "自动摘录原文，例外机构说明待确认", announcementDate: n.releaseDate, releaseDate: n.releaseDate,
    effectiveDate: n.effectiveDate, sourceUrl: n.url, originalPublisher: "中国人民银行" }));
  const value = events.filter((e) => e.scopeType === "普遍" && e.executed).reduce((s, e) => s + e.signedChangeBp, 0);
  const scan = jev.rrrNoticeScan || {};
  const checks = months.filter((m) => tables[m]).map((m) => {
    const t = tables[m];
    return { period: m, title: t.title, tableComplete: t.tableComplete === true, policyReviewComplete: false, tool: t.tool, unit: t.unit,
      injection: t.injection, withdrawal: t.withdrawal, netInjection: t.netInjection,
      finding: `准备金调整行投放/回笼/净投放原符号为${[t.injection, t.withdrawal, t.netInjection].join("/")}；原符号只作披露核查，不数值化为基点。${LABEL}：本月是否有普遍人民币调整由用户确认。`,
      originalPublisher: "中国人民银行", sourceUrl: t.sourceUrl, releaseDate: t.releaseDate };
  });
  const endTable = tables[end];
  const candidate = missing.length ? null : {
    ...clone(prev), value, period: end, latestAvailablePeriod: end, sourceUrl: endTable.sourceUrl, releaseDate: endTable.releaseDate, verifiedAt: asOf, verified: true,
    rrrActionLedger: { windowStart, windowEnd, monthlyChecks: checks, adjustmentEvents: events,
      crossChecks: [
        ...Object.values(ev.mpr || {}).filter((r) => monthEnd(r.period) >= windowStart && monthEnd(r.period) <= windowEnd && r.releaseDate <= asOf).map((r) => ({
          type: "季度执行报告", coverageStart: `${mAdd(r.period, -2)}-01`, coverageEnd: monthEnd(r.period), sourceUrl: r.reportUrl || r.sourceUrl, releaseDate: r.releaseDate,
          originalPublisher: "中国人民银行", finding: `${r.period.slice(0, 4)}年截至${r.period}的货币政策执行报告，用于核对该季度准备金政策叙述。${LABEL}` })),
        { type: "政策公告复核", coverageStart: windowStart, coverageEnd: windowEnd, sourceUrl: scan.listUrl, releaseDate: endTable.releaseDate,
          originalPublisher: "中国人民银行", finding: `自动扫描央行新闻发布目录${scan.scannedItems ?? "?"}条（最早至${scan.oldestDate ?? "?"}），标题含“存款准备金率/降准”且在窗口内生效的公告${notices.length}份。${LABEL}`,
          reviewedSources: [
            { sourceUrl: scan.listUrl, reviewDate: asOf, finding: `新闻发布目录逐条标题扫描${scan.scannedItems ?? "?"}条；须用户确认。` },
            ...(notices.length ? notices.map((n) => ({ sourceUrl: n.url, releaseDate: n.releaseDate, originalPublisher: "中国人民银行", finding: n.title }))
              : [{ sourceUrl: endTable.sourceUrl, releaseDate: endTable.releaseDate, originalPublisher: "中国人民银行", finding: "期末月工具原表，准备金行为原符号，未列调整金额。" }]),
          ] },
      ],
      limitations: prev.rrrActionLedger?.limitations ?? [], attestation: null },
  };
  return {
    suggestedValue: missing.length ? null : value, period: end,
    evidence: [...checks.slice(-3).map((c) => ({ label: `${c.period} 工具表准备金行`, value: [c.injection, c.withdrawal, c.netInjection].join(" / "), period: c.period, url: c.sourceUrl, releaseDate: c.releaseDate })),
      ...notices.map((n) => ({ label: `降准/升准公告（${n.scopeGuess}）`, value: `${n.signedChangeBp}基点，${n.effectiveDate}生效`, period: n.effectiveDate.slice(0, 7), url: n.url, releaseDate: n.releaseDate }))],
    signals: [`窗口${windowStart}—${windowEnd}：工具表${checks.length}/12期${missing.length ? `，缺${missing.join("、")}` : ""}；窗口内调整公告${notices.length}份`],
    rationale: missing.length ? "工具表不全，按规则不能给出账本值，建议沿用。" : `按既有规则累计窗口内已执行普遍人民币调整=${value}基点。确认即作为对12期月表与公告复核的逐月确认（policyReviewComplete）。`,
    candidate, editable: null, limitation: "月表‘—/-’只证明披露覆盖；确认前请核对公告范围（普遍/定向/外币）与例外机构说明。",
  };
}

const BUILDERS = { F09: leverage, F10: leverage, P03A: policy, P03B: policy, P04A: policy, P04B: policy, P02E: rrr };

/** One suggestion per judgement item; `key` changes whenever evidence/suggestion changes (stale decisions are ignored). */
export function buildSuggestions({ framework, current, jev = {}, ev = {}, asOf }) {
  const out = {};
  for (const id of JUDGEMENT_IDS) {
    const rule = framework.indicators.find((r) => r.id === id), prev = current.observations[id];
    if (!rule || !prev) continue;
    let s;
    try { s = BUILDERS[id]({ rule, prev, jev, ev, asOf }); } catch (e) { s = { suggestedValue: null, evidence: [], signals: [], rationale: `建议生成出错：${e.message}`, candidate: null, editable: null }; }
    const key = hash([id, s.period, s.suggestedValue, s.evidence.map((e) => [e.url, e.value]), prev.period, prev.value]);
    out[id] = { id, name: rule.name, label: LABEL, previousValue: prev.value, previousPeriod: prev.period, ...s, key };
  }
  return out;
}

/** Apply a user decision to a suggestion. Returns { obs, error }. obs passes scoreIndicator or is null. */
export function applyDecision({ rule, prev, suggestion, decision, asOf, freshness }) {
  if (!decision || decision.key !== suggestion.key) return { obs: null };
  if (decision.action === "keep") return { obs: clone(prev), kept: true };
  if (!suggestion.candidate) return { obs: null, error: "该建议无可直接套用的观察（需人工补齐结构化复核）" };
  const o = clone(suggestion.candidate);
  if (decision.action === "edit") {
    const e = suggestion.editable;
    if (!e || !fin(decision.value) || decision.value < e.min || decision.value > e.max || Math.round(decision.value / e.step) * e.step !== decision.value) return { obs: null, error: "该项不支持此改分" };
    o.value = decision.value;
    if (o.policyReview) o.policyReview.direction = o.value >= 4 ? "改善" : o.value <= 2 ? "恶化" : "中性或混合";
  }
  const note = decision.note ? `；用户说明：${decision.note}` : "";
  if (o.policyReview) { o.reason = `${decision.action === "edit" ? "用户改档" : "用户确认建议"}（${decision.at}）${note}。${prev.reason ?? ""}`; o.policyReview.scoreReason = `${o.reason}`; }
  if (o.rrrActionLedger) {
    for (const c of o.rrrActionLedger.monthlyChecks) c.policyReviewComplete = true;
    o.rrrActionLedger.attestation = { confirmedAt: decision.at, by: decision.by || "portal", note: decision.note || null, scope: "逐月工具表与调整公告复核（用户点击确认）" };
  }
  if (o.leverageReview) o.userConfirmation = { confirmedAt: decision.at, note: decision.note || null };
  const score = scoreIndicator(rule, o, asOf, freshness);
  return score === null ? { obs: null, error: "确认后的观察未通过既有规则核验，草稿继续沿用" } : { obs: o };
}
