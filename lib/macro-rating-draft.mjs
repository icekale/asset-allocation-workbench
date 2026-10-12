// Semi-automatic macro rating draft: recompute with FROZEN rules, never auto-publish.
// Rules (indicators, curves, anchors, weights, pillars, bands, freshness, coverage) are hashed and locked;
// any change to them makes draft/publish refuse to run. Only observations may change.
import { BUILDERS } from "./macro-rating-builders.mjs";
import crypto from "node:crypto";
import { evaluateMacroRating, scoreIndicator } from "./macro-rating.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "./macro-rating-record.mjs";

export const NOTABLE_TOTAL_DELTA = 0.05;
const RULE_KEYS = ["pillars", "ratingBands", "coverage", "freshness", "indicators", "researchAssessmentPolicy", "policyMethod"];

const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`
    : JSON.stringify(value);

/** Hash of every scoring-relevant rule field; version labels/notes are excluded. */
export function rulesHash(framework) {
  const picked = Object.fromEntries(RULE_KEYS.map((key) => [key, framework[key] ?? null]));
  return crypto.createHash("sha256").update(stable(picked)).digest("hex");
}

export function assertRulesLocked(framework, lock) {
  const hash = rulesHash(framework);
  if (!lock || hash !== lock.sha256) {
    throw new Error(`评分规则与冻结配置不一致（${hash.slice(0, 12)} ≠ ${lock?.sha256?.slice(0, 12)}）；草稿流程不允许修改评分因子/模型`);
  }
  return hash;
}

const r6 = (v) => v === null || v === undefined ? null : Number(Number(v).toFixed(6));

/** Reproduce an archived snapshot from its own framework + observations. */
export function reproduceSnapshot(framework, current, snapshot) {
  const result = evaluateMacroRating(framework, current);
  const mismatches = [];
  for (const row of snapshot.rows ?? []) {
    const rule = framework.indicators.find((item) => item.id === row.id);
    const points = scoreIndicator(rule, current.observations?.[row.id], current.asOf, framework.freshness);
    if (r6(points) !== r6(row.points)) mismatches.push({ id: row.id, archived: row.points, recomputed: points });
  }
  for (const pillar of snapshot.pillars ?? []) {
    const mine = result.pillars.find((item) => item.name === pillar.name);
    if (r6(mine?.observedScore) !== r6(pillar.observedScore)) mismatches.push({ id: pillar.name, archived: pillar.observedScore, recomputed: mine?.observedScore });
  }
  if (r6(result.formalScore) !== r6(snapshot.score)) mismatches.push({ id: "total", archived: snapshot.score, recomputed: result.formalScore });
  if ((result.grade ?? "未发布正式档位") !== snapshot.grade) mismatches.push({ id: "grade", archived: snapshot.grade, recomputed: result.grade });
  return { ok: mismatches.length === 0, indicatorCount: snapshot.rows?.length ?? 0, total: result.formalScore, grade: result.grade, mismatches };
}

const releaseDateFromStatsUrl = (url) => {
  const m = /\/t(\d{4})(\d{2})(\d{2})_\d+\.html?$/.exec(url || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const releaseDateFromPbcUrl = (url) => {
  const m = /\/(\d{4})(\d{2})(\d{2})\d+\/index\.html$/.exec(url || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const base = (obs) => { const copy = structuredClone(obs); delete copy.rationale; return copy; };

/**
 * Auto-mappers: only indicators whose V1.21 input is a single official value published directly in a
 * collector data file. Everything else is manual-carry (previous verified observation kept, flagged).
 */
// Indicators intentionally left to analysts: their inputs are judgement or attested reviews, not a published number.
export const MANUAL_REASONS = {
  F09: "杠杆判断项，依赖分析师对部门杠杆与偿债压力的综合判断；规则无可复算公式。日后可用：国家金融与发展实验室(CNBS)宏观杠杆率、BIS私人非金融部门偿债比率(DSR)。",
  F10: "杠杆判断项，同上，需人工判断部门结构与可持续性。日后可用：CNBS分部门杠杆率季度表、BIS信用/GDP缺口。",
  P03A: "政策判断项，依赖对政策文件力度与方向的定性评估。日后可用：国务院/部委政策文件计数与关键词分类、专项债发行与使用进度。",
  P03B: "政策判断项，同上。日后可用：政策落地指标（政策性金融工具投放、设备更新/以旧换新资金下达进度）。",
  P04A: "政策判断项，依赖对改革/监管取向的定性评估。日后可用：政策文件计数、执行类量化指标。",
  P04B: "政策判断项，同上。日后可用：政策文件计数、执行类量化指标。",
  P02E: "降准台账要求逐月“货币政策工具表+政策复核完成”人工核验声明与交叉核对；自动设置复核完成即属伪造核验。日后可半自动：抓取央行月度工具流动性表与降准公告生成台账草稿，由人工确认后填入。",
};

export const AUTO_MAPPERS = {
  E02: (data, prev, asOf) => priceMapper(data, prev, asOf, "cpi", "cpiUrl", "CPI"),
  E03: (data, prev, asOf) => priceMapper(data, prev, asOf, "coreCpi", "coreCpiUrl", "核心CPI"),
  E04: (data, prev, asOf) => priceMapper(data, prev, asOf, "ppi", "ppiUrl", "PPI"),
  F05: (data, prev, asOf) => {
    const row = [...(data.money?.rows ?? [])].reverse().find((item) => item.m1Basis === "revised" && Number.isFinite(item.m1) && Number.isFinite(item.m2) && item.sourceUrl);
    if (!row || row.period <= prev.period) return null;
    const releaseDate = releaseDateFromPbcUrl(row.sourceUrl);
    if (!releaseDate || releaseDate > asOf) return null;
    const part = (series, value) => ({ period: row.period, value, unit: "%", basis: "月末余额同比", series, sourceUrl: row.sourceUrl, releaseDate, originalPublisher: "中国人民银行" });
    return { ...base(prev), value: Number((row.m1 - row.m2).toFixed(6)), period: row.period, latestAvailablePeriod: row.period,
      sourceUrl: row.sourceUrl, releaseDate, verifiedAt: asOf, verified: true,
      components: [part("m1New", row.m1), part("m2", row.m2)],
      derivationNote: `按央行公布增速M1 ${row.m1}% − M2 ${row.m2}%（采集自 app/data/macro-money-supply.json，待人工复核）。`,
      rationale: `草稿自动映射：${row.period} M1 ${row.m1}% − M2 ${row.m2}%；规则沿用冻结版本，未改曲线与权重。` };
  },
};
function priceMapper(data, prev, asOf, key, urlKey, label) {
  const row = [...(data.prices?.rows ?? [])].reverse().find((item) => Number.isFinite(item[key]) && item[urlKey]);
  if (!row || row.period <= prev.period) return null;
  const releaseDate = releaseDateFromStatsUrl(row[urlKey]);
  if (!releaseDate || releaseDate > asOf) return null;
  return { ...base(prev), value: row[key], period: row.period, latestAvailablePeriod: row.period, sourceUrl: row[urlKey],
    releaseDate, verifiedAt: asOf, verified: true,
    rationale: `草稿自动映射：${row.period} ${label}同比 ${row[key]}%（国家统计局，采集自 app/data/macro-price-history.json，待人工复核）；规则沿用冻结版本。` };
}

const pillarRows = (result) => Object.fromEntries(result.pillars.map((p) => [p.name, p.observedScore]));

/** Build a draft. Pure: reads inputs, returns the draft object. */
export function buildDraft({ framework, current, lock, data, asOf, now = new Date().toISOString() }) {
  const hash = assertRulesLocked(framework, lock);
  if (current.version !== framework.version) throw new Error("current 与规则版本不一致");
  const before = evaluateMacroRating(framework, current);
  const observations = {};
  const rows = framework.indicators.map((rule) => {
    const prev = current.observations[rule.id];
    const oldPoints = scoreIndicator(rule, prev, current.asOf, framework.freshness);
    let source = "manual-carry", obs = structuredClone(prev), note = "沿用上一版已核验观察值（该项需人工更新）";
    const mapper = AUTO_MAPPERS[rule.id] || (BUILDERS[rule.id] && ((d, p, a) => {
      const built = BUILDERS[rule.id]({ ev: d.ev || {}, data: d, template: p, asOf: a });
      return built && built.period > p.period && !(built.releaseDate > a) ? built : null;
    }));
    if (!mapper && MANUAL_REASONS[rule.id]) note = `人工项·沿用：${MANUAL_REASONS[rule.id]}`;
    if (mapper) {
      let candidate = null;
      try { candidate = mapper(data, prev, asOf); } catch (e) { candidate = null; note = `自动构建出错：${e.message}`; }
      if (candidate && scoreIndicator(rule, candidate, asOf, framework.freshness) !== null) {
        obs = candidate; source = "auto"; note = "采集数据自动映射新一期";
      } else if (candidate) { source = "auto-rejected"; note = "采集到新一期但未通过规则核验，沿用上一版"; }
      else { source = "auto-no-new"; note = "可自动映射，但暂无比上一版更新的一期，沿用上一版"; }
    }
    observations[rule.id] = obs;
    const newPoints = scoreIndicator(rule, obs, asOf, framework.freshness);
    const contribOld = oldPoints === null ? null : oldPoints * rule.weight;
    const contribNew = newPoints === null ? null : newPoints * rule.weight;
    return { id: rule.id, name: rule.name, pillar: rule.pillar, weight: rule.weight, source, note,
      oldValue: prev?.value ?? null, oldPeriod: prev?.period ?? null, newValue: obs?.value ?? null, newPeriod: obs?.period ?? null,
      oldScore: oldPoints, newScore: newPoints, oldContribution: contribOld, newContribution: contribNew,
      contributionDelta: contribOld !== null && contribNew !== null ? contribNew - contribOld : null,
      missing: newPoints === null, changed: source === "auto" };
  });
  const draftCurrent = { ...structuredClone(current), asOf, observations };
  const after = evaluateMacroRating(framework, draftCurrent);
  const delta = before.formalScore !== null && after.formalScore !== null ? after.formalScore - before.formalScore : null;
  const tierChanged = (before.grade ?? null) !== (after.grade ?? null);
  return {
    kind: "macro-rating-draft", generatedAt: now, asOf, baseVersion: current.version, baseAsOf: current.asOf,
    rulesVersion: lock.rulesVersion, rulesSha256: hash,
    policy: "规则冻结：不改评分因子、曲线、锚点、权重与指标集；缺数据不重新分配权重；须人工发布。",
    before: { score: before.formalScore, grade: before.grade, status: before.status, pillars: pillarRows(before) },
    after: { score: after.formalScore, grade: after.grade, status: after.status, coverage: after.coverage, pillars: pillarRows(after) },
    totalDelta: delta, tierChanged,
    notable: tierChanged || delta === null || Math.abs(delta) > NOTABLE_TOTAL_DELTA,
    counts: { auto: rows.filter((r) => r.source === "auto").length, autoNoNew: rows.filter((r) => r.source === "auto-no-new").length, autoRejected: rows.filter((r) => r.source === "auto-rejected").length, manualCarry: rows.filter((r) => r.source === "manual-carry").length, missing: rows.filter((r) => r.missing).length },
    rows, observations,
  };
}

export const nextVersion = (version) => {
  const m = /^V(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`无法识别版本 ${version}`);
  return `V${m[1]}.${Number(m[2]) + 1}`;
};

/** Publish: returns new framework/current/history. Append-only; refuses if base moved or rules changed. */
export function publishDraft({ framework, current, history, lock, draft }) {
  assertRulesLocked(framework, lock);
  if (draft.rulesSha256 !== lock.sha256) throw new Error("草稿规则哈希与冻结配置不符");
  if (draft.baseVersion !== current.version || draft.baseAsOf !== current.asOf) throw new Error("正式评分已变化，请重新生成草稿");
  if (draft.after.status !== "正式") throw new Error(`草稿覆盖率不足（${draft.after.status}），不能发布正式评分`);
  const version = nextVersion(current.version);
  const newFramework = { ...structuredClone(framework), version, versionDate: draft.asOf, rulesFrozenFrom: lock.rulesVersion };
  const prevResult = evaluateMacroRating(framework, current);
  const newCurrent = { ...structuredClone(current), asOf: draft.asOf, version, observations: structuredClone(draft.observations),
    reviewSummary: `${version}为数据更新：评分规则冻结沿用${lock.rulesVersion}（因子、曲线、锚点、权重不变）；${draft.counts.auto}项自动映射新一期、${draft.counts.manualCarry}项沿用上一版。` + (current.reviewSummary ? ` 规则说明：${current.reviewSummary}` : ""),
    revisionComparison: { previousVersion: current.version, currentVersion: version, kind: "数据更新（规则冻结，人工审核发布）",
      previousScore: prevResult.formalScore, currentScore: null,
      rows: draft.rows.map((r) => ({ id: r.id, name: r.name, previousScore: r.oldScore, currentScore: r.newScore, weight: r.weight,
        previousWeight: r.weight, currentWeight: r.weight, contributionChange: r.contributionDelta ?? 0, reason: r.note })) } };
  const result = evaluateMacroRating(newFramework, newCurrent);
  if (Math.abs(result.formalScore - draft.after.score) > 1e-12) throw new Error("发布复算与草稿不一致");
  newCurrent.revisionComparison.currentScore = result.formalScore;
  if (rulesHash(newFramework) !== lock.sha256) throw new Error("发布会改变规则，拒绝");
  const record = createMacroRatingRecord(newFramework, newCurrent);
  const newHistory = { ...appendMacroRatingRecord(history, record), updatedAt: draft.asOf };
  if (stable(newHistory.snapshots.slice(0, -1)) !== stable(history.snapshots)) throw new Error("历史记录被改动，拒绝");
  return { framework: newFramework, current: newCurrent, history: newHistory, record: { id: record.id, version, score: record.score, grade: record.grade } };
}

/** Load collector outputs used by builders. `read` maps a repo-relative path to parsed JSON (or throws). */
export function loadDraftData(read) {
  const tryRead = (f) => { try { return read(f); } catch { return null; } };
  const ev = tryRead("app/data/macro-rating-evidence.json") || {};
  const data = { prices: tryRead("app/data/macro-price-history.json"), money: tryRead("app/data/macro-money-supply.json"),
    secondhand: tryRead("app/data/macro-secondhand-price.json"), gdp: tryRead("app/data/macro-gdp-deflator-history.json"),
    credit: tryRead("app/data/macro-finance-credit.json") };
  return { ev, data };
}
