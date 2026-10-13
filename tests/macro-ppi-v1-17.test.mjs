import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { continuousScoreDetails, interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import * as researchEngine from "../lib/macro-rating-research.mjs";
import * as summaryEngine from "../lib/macro-rating-summary.mjs";
import * as breadthEngine from "../lib/macro-profit-breadth.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
// Keep the V1.17 regression tied to its immutable release, not the newest live rules.
const framework = read("deliverables/macro-rating-framework-before-v1-18-2026-10-11.json");
const current = read("deliverables/macro-rating-current-before-v1-18-2026-10-11.json");
const history = read("deliverables/macro-rating-history-before-v1-18-2026-10-11.json");
const before = read("deliverables/macro-rating-framework-before-v1-17-2026-10-11.json");
const beforeCurrent = read("deliverables/macro-rating-current-before-v1-17-2026-10-11.json");
const beforeHistory = read("deliverables/macro-rating-history-before-v1-17-2026-10-11.json");
const audit = read("deliverables/macro-v1-17-ppi-calibration.json");
const rule = framework.indicators.find((entry) => entry.id === "E04");
const oldRule = before.indicators.find((entry) => entry.id === "E04");
const near = (actual, expected, label, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${label}: finite numeric values required`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
};
const rawObservation = (value) => {
  const copy = structuredClone(value);
  delete copy.rationale;
  return copy;
};

test("the PPI revision preserves all 37 IDs, individual weights and unchanged raw evidence at the same cutoff", () => {
  assert.equal(framework.version, "V1.17");
  assert.equal(current.version, framework.version);
  assert.equal(before.version, "V1.16");
  assert.equal(beforeCurrent.version, before.version);
  assert.equal(current.asOf, beforeCurrent.asOf);
  assert.equal(framework.indicators.length, 37);
  assert.deepEqual(framework.pillars, before.pillars);
  assert.deepEqual(framework.ratingBands, before.ratingBands);
  assert.deepEqual(framework.freshness, before.freshness);
  assert.deepEqual(framework.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })),
    before.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })));
  assert.deepEqual(Object.keys(current.observations), Object.keys(beforeCurrent.observations));
  for (const item of framework.indicators) {
    assert.deepEqual(rawObservation(current.observations[item.id]), rawObservation(beforeCurrent.observations[item.id]),
      `${item.id}: a score-curve revision cannot rewrite statistical observations or evidence`);
    if (item.id !== "E04") {
      assert.deepEqual(item, before.indicators.find((entry) => entry.id === item.id),
        `${item.id}: this authorization applies only to PPI`);
    }
  }
  for (const key of ["sourcePriority", "sourceChecks", "latestReleaseChecks", "gaps", "researchAssessments"]) {
    assert.deepEqual(current[key], beforeCurrent[key], `${key}: preserve the current evidence collection`);
  }
  const originalLimits = beforeCurrent.evidenceLimitations.filter((item) => item.reason !== before.scoringMethod.calibration);
  assert.deepEqual(current.evidenceLimitations.filter((item) => item.reason !== framework.scoringMethod.calibration), originalLimits,
    "an updated calibration disclaimer must not remove a raw-evidence limitation");
  assert.deepEqual(current.evidenceLimitations.find((item) => item.reason === framework.scoringMethod.calibration)?.items, ["E04"]);
});

test("PPI keeps its official monthly definition, method and entire nonpositive branch", () => {
  for (const key of ["id", "name", "weight", "pillar", "mode", "frequency", "unit", "originalPublisher", "measurementBasis", "requirements"]) {
    assert.deepEqual(rule[key], oldRule[key], `${key}: do not redefine PPI or weaken its inputs`);
  }
  assert.equal(rule.scoring.method, "piecewise-linear");
  assert.deepEqual(rule.scoring.anchors.filter(([value]) => value <= 0),
    oldRule.scoring.anchors.filter(([value]) => value <= 0));
  for (let step = -200; step <= 0; step++) {
    const value = step / 10;
    near(interpolateScore(value, rule.scoring.anchors), interpolateScore(value, oldRule.scoring.anchors), `negative PPI ${value}%`);
  }
});

test("the revised PPI curve is continuous, bounded and unimodal rather than a discontinuous inflation cliff", () => {
  const anchors = rule.scoring.anchors;
  assert.ok(anchors.length >= 5);
  assert.equal(Math.min(...anchors.map(([, points]) => points)), 1);
  assert.equal(Math.max(...anchors.map(([, points]) => points)), 5);
  let declining = false;
  for (let index = 0; index < anchors.length; index++) {
    const [value, points] = anchors[index];
    assert.ok(points >= 1 && points <= 5);
    if (index > 0) {
      assert.ok(value > anchors[index - 1][0]);
      const change = points - anchors[index - 1][1];
      if (change < 0) declining = true;
      if (declining) assert.ok(change <= 0, "a higher PPI cannot regain a second high-score peak");
    }
    near(interpolateScore(value, anchors), points, `PPI reference ${value}%`);
    for (const delta of [-1e-9, 1e-9]) {
      near(interpolateScore(value + delta, anchors), points, `PPI continuity around ${value}%`, 1e-6);
    }
  }
  assert.ok(declining, "PPI above the favorable range must eventually reduce the score");
  for (let step = -2000; step <= 2000; step++) {
    const points = interpolateScore(step / 100, anchors);
    assert.ok(points >= 1 && points <= 5, `PPI ${step / 100}%`);
  }
  const peak = anchors.filter(([, points]) => points === 5).map(([value]) => value);
  assert.ok(Math.min(...peak) > 0 && Math.max(...peak) < 3, "the former 2–3% plateau must not remain unchanged");
  for (const value of [3, 4, 5]) {
    assert.ok(interpolateScore(value, anchors) < interpolateScore(value, oldRule.scoring.anchors),
      `${value}% should no longer receive the former optimistic high score`);
  }
});

test("a revised PPI favorable range never bypasses verification, definition or release-date gates", () => {
  for (const item of framework.indicators) {
    const observation = current.observations[item.id];
    assert.notEqual(scoreIndicator(item, observation, current.asOf, framework.freshness), null, item.id);
    assert.equal(scoreIndicator(item, null, current.asOf, framework.freshness), null, item.id);
    for (const mutation of [{ verified: false }, { value: null }, { sourceUrl: "https://example.com/not-official" },
      { releaseDate: "2099-01-01" }, { verifiedAt: "2099-01-01" }, { unit: "错误单位" },
      { basis: "错误口径" }, { latestAvailablePeriod: "2099-01" }]) {
      assert.equal(scoreIndicator(item, { ...structuredClone(observation), ...mutation }, current.asOf, framework.freshness),
        null, `${item.id}: invalid evidence must remain unscored`);
    }
  }
});

test("the new total and latest-only record reproduce precisely one PPI rule change, not an economic-data change", () => {
  const result = evaluateMacroRating(framework, current);
  const prior = evaluateMacroRating(before, beforeCurrent);
  assert.equal(result.status, "正式");
  near(result.coverage, 1, "verified coverage");
  const changed = framework.indicators.filter((item) => {
    const old = before.indicators.find((entry) => entry.id === item.id);
    return Math.abs(scoreIndicator(item, current.observations[item.id], current.asOf, framework.freshness)
      - scoreIndicator(old, beforeCurrent.observations[item.id], beforeCurrent.asOf, before.freshness)) > 1e-9;
  });
  assert.ok(changed.every((item) => item.id === "E04"), "no other indicator point value can change");
  const ppiDifference = scoreIndicator(rule, current.observations.E04, current.asOf, framework.freshness)
    - scoreIndicator(oldRule, beforeCurrent.observations.E04, beforeCurrent.asOf, before.freshness);
  near(result.formalScore - prior.formalScore, rule.weight * ppiDifference, "whole-score difference comes only from PPI");
  for (const pillar of result.pillars.filter((entry) => entry.name !== "经济运行")) {
    assert.deepEqual(pillar, prior.pillars.find((entry) => entry.name === pillar.name), `${pillar.name}: unchanged pillar`);
  }
  assert.match(current.revisionComparison.kind, /不是经济变化/);
  near(current.revisionComparison.rows.reduce((sum, row) => sum + row.contributionChange, 0),
    result.formalScore - prior.formalScore, "revision math");
  assert.deepEqual(history.snapshots, [createMacroRatingRecord(framework, current)]);
  assert.equal(history.snapshots[0].version, "V1.17");
  assert.equal(history.snapshots[0].score, Number(result.formalScore.toFixed(6)));
  assert.deepEqual(beforeHistory.snapshots, [createMacroRatingRecord(before, beforeCurrent)],
    "the V1.16 record remains independently recoverable, with its own rules and evidence");
});

const monthNumber = (period) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const rowsForWindow = (key) => {
  const startEnd = {
    all: ["2015-01", "2026-08"], "pre-pandemic": ["2015-01", "2019-12"],
    "recovery2016-2017": ["2016-01", "2017-12"], "pandemic2020-2022": ["2020-01", "2022-12"],
    "shock2021-2022": ["2021-01", "2022-12"], reopening2023: ["2023-01", "2023-12"],
    since2023: ["2023-01", "2026-08"], recent: ["2024-01", "2026-08"],
  };
  const range = startEnd[key] ?? (/^year20\d{2}$/.test(key) ? [key.slice(4) + "-01", key.slice(4) + "-12"] : null);
  assert.ok(range, `${key}: a diagnostic window must expose a reproducible definition`);
  return audit.data.rows.filter((item) => item.period >= range[0] && item.period <= range[1]);
};

test("all four PPI candidates compare the same 140 original months without rebranding source-link checks as new content verification", () => {
  const originals = read("app/data/macro-price-history.json").rows
    .filter((item) => item.period >= "2015-01" && item.period <= "2026-08")
    .map((item) => ({ period: item.period, value: item.ppi, sourceUrl: item.ppiUrl,
      originalPublisher: "国家统计局", unit: "%", basis: "当月同比" }))
    .sort((left, right) => left.period.localeCompare(right.period));
  assert.equal(audit.baseVersion, "V1.16");
  assert.equal(audit.version, "V1.17");
  assert.equal(audit.asOf, current.asOf);
  assert.equal(audit.id, "E04");
  assert.equal(audit.data.expectedMonthCount, 140);
  assert.equal(audit.data.rows.length, 140);
  // Frozen V1.17 audit: values/periods must match live NBS history exactly; NBS serves the same release under
  // two equivalent stats.gov.cn paths (sj/zxfb vs xxgk/sjfb/zxfb2020), so URLs are compared by host + release id.
  const strip = (r) => ({ ...r, sourceUrl: undefined });
  assert.deepEqual(audit.data.rows.map(strip), originals.map(strip));
  const rid = (u) => /t(\d{8})_\d+\.html$/.exec(u)?.[1];
  audit.data.rows.forEach((r, i) => assert.equal(rid(r.sourceUrl)?.slice(0, 6), rid(originals[i].sourceUrl)?.slice(0, 6), r.period));
  assert.equal(new Set(originals.map((item) => item.period)).size, 140);
  assert.ok(originals.every((item, index) => Number.isFinite(item.value)
    && (index === 0 || monthNumber(item.period) - monthNumber(originals[index - 1].period) === 1)));
  for (const item of originals) {
    const url = new URL(item.sourceUrl);
    assert.equal(url.protocol, "https:");
    assert.ok(url.hostname === "stats.gov.cn" || url.hostname.endsWith(".stats.gov.cn"));
  }
  assert.deepEqual(audit.candidates.map((item) => item.key), ["baseline", "A", "B", "C"]);
  assert.deepEqual(audit.candidates.find((item) => item.key === "baseline").anchors, oldRule.scoring.anchors);
  const selected = audit.candidates.find((item) => item.key === audit.selectedCandidate);
  assert.ok(selected);
  assert.deepEqual(audit.scoring, selected.scoring);
  assert.deepEqual(rule.scoring, audit.scoring);
  assert.ok(audit.candidates.every((item) => item.diagnostics.find((window) => window.key === "all").n === 140));
  assert.match(audit.data.sourceContentVerification, /不.*重新|不.*每个页面内容/);
  assert.match(audit.candidateProtocol, /固定候选|固定.*候选/);
  assert.ok(audit.limitations.some((item) => /不是.*PIT|不是逐期可得/.test(item)));
  assert.ok(audit.limitations.some((item) => /没有.*经济状态标签|不能称.*误报率/.test(item)));
  assert.ok(audit.limitations.some((item) => /没有.*样本外资产回报/.test(item)));
  assert.match(audit.diagnosticDefinitions.positiveCostPressureSampleCount, /不构成官方/);
});

test("full, staged and yearly PPI scale statistics independently reproduce the unchanged raw values", () => {
  const expectedWindowKeys = ["all", "pre-pandemic", "recovery2016-2017", "pandemic2020-2022", "shock2021-2022",
    "reopening2023", "since2023", "recent", ...Array.from({ length: 12 }, (_, index) => `year${2015 + index}`)];
  for (const candidate of audit.candidates) {
    assert.deepEqual(candidate.diagnostics.map((item) => item.key), expectedWindowKeys,
      `${candidate.key}: do not omit difficult pandemic, base-effect or individual-year samples`);
    for (const diagnostic of candidate.diagnostics) {
      const originalRows = rowsForWindow(diagnostic.key);
      const points = originalRows.map((item) => interpolateScore(item.value, candidate.anchors));
      const deltas = originalRows.slice(1).map((item, index) => ({ period: item.period,
        previousPeriod: originalRows[index].period, delta: points[index + 1] - points[index] }));
      const jumps = deltas.filter((item) => Math.abs(item.delta) > .5 + 1e-10);
      const reversals = deltas.slice(1).filter((item, index) => item.delta * deltas[index].delta < 0
        && Math.abs(item.delta) >= .25 - 1e-10 && Math.abs(deltas[index].delta) >= .25 - 1e-10);
      const roundingWidths = originalRows.map((item) => Math.abs(interpolateScore(item.value + .05, candidate.anchors)
        - interpolateScore(item.value - .05, candidate.anchors)));
      assert.equal(diagnostic.n, originalRows.length, `${candidate.key}/${diagnostic.key}`);
      assert.equal(diagnostic.first, originalRows[0].period);
      assert.equal(diagnostic.last, originalRows.at(-1).period);
      assert.equal(diagnostic.consecutivePairCount, deltas.length);
      assert.equal(diagnostic.floorCount, points.filter((value) => value <= 1 + 1e-10).length);
      assert.equal(diagnostic.ceilingCount, points.filter((value) => value >= 5 - 1e-10).length);
      assert.equal(diagnostic.endpointScoreCount, diagnostic.floorCount + diagnostic.ceilingCount);
      assert.equal(diagnostic.nearTailScoreCount, points.filter((value) => value <= 1.25 + 1e-10 || value >= 4.75 - 1e-10).length);
      near(diagnostic.scoreMean, mean(points), `${candidate.key}/${diagnostic.key}: mean`);
      near(diagnostic.scoreStd, Math.sqrt(mean(points.map((value) => (value - mean(points)) ** 2))),
        `${candidate.key}/${diagnostic.key}: population standard deviation`);
      near(diagnostic.meanAbsoluteScoreChange, mean(deltas.map((item) => Math.abs(item.delta))),
        `${candidate.key}/${diagnostic.key}: average monthly score movement`);
      near(diagnostic.maximumAbsoluteScoreChange, Math.max(...deltas.map((item) => Math.abs(item.delta))),
        `${candidate.key}/${diagnostic.key}: largest monthly score movement`);
      assert.equal(diagnostic.scoreChangeOver0_5Count, jumps.length);
      assert.deepEqual(diagnostic.largeChanges.map(({ period, previousPeriod }) => ({ period, previousPeriod })),
        jumps.map(({ period, previousPeriod }) => ({ period, previousPeriod })));
      diagnostic.largeChanges.forEach((item, index) => near(item.delta, jumps[index].delta, "stored jump"));
      assert.equal(diagnostic.consecutiveTripletReversalsOver0_25Count, reversals.length);
      assert.deepEqual(diagnostic.reversals.map((item) => item.period), reversals.map((item) => item.period));
      near(diagnostic.plus0_1MeanAbsoluteScoreResponse, mean(originalRows.map((item) => Math.abs(
        interpolateScore(item.value + .1, candidate.anchors) - interpolateScore(item.value, candidate.anchors)))),
      `${candidate.key}/${diagnostic.key}: 0.1-point input sensitivity`);
      near(diagnostic.knownRoundingWidthMean, mean(roundingWidths), `${candidate.key}/${diagnostic.key}: known rounding width`);
      near(diagnostic.knownRoundingWidthMaximum, Math.max(...roundingWidths), `${candidate.key}/${diagnostic.key}: max rounding width`);
      assert.equal(diagnostic.scoreBands.reduce((sum, item) => sum + item.count, 0), originalRows.length);
      const highRows = originalRows.filter((item) => item.value > 3);
      assert.equal(diagnostic.positiveCostPressureSampleCount, highRows.length);
      if (highRows.length) near(diagnostic.positiveCostPressureMeanScore,
        mean(highRows.map((item) => interpolateScore(item.value, candidate.anchors))), `${candidate.key}/${diagnostic.key}: high-PPI sample`);
      else assert.equal(diagnostic.positiveCostPressureMeanScore, null);
    }
  }
});

test("PPI rounding ranges and reference scores show arithmetic sensitivity rather than statistical confidence or an official target", () => {
  for (const candidate of audit.candidates) {
    near(candidate.currentScore, interpolateScore(current.observations.E04.value, candidate.anchors), `${candidate.key}: current score`);
    for (const item of candidate.referenceScores) {
      near(item.points, interpolateScore(item.value, candidate.anchors), `${candidate.key}: reference ${item.value}%`);
    }
    const range = candidate.currentPrecisionRange;
    assert.equal(range.reportedIncrement, .1);
    near(range.lowerInput, current.observations.E04.value - .05, `${candidate.key}: original lower rounding bound`);
    near(range.upperInput, current.observations.E04.value + .05, `${candidate.key}: original upper rounding bound`);
    const endpoints = [range.lowerInput, range.upperInput].map((value) => interpolateScore(value, candidate.anchors));
    near(range.scoreInterval[0], Math.min(...endpoints), `${candidate.key}: min score rounding bound`);
    near(range.scoreInterval[1], Math.max(...endpoints), `${candidate.key}: max score rounding bound`);
    assert.match(range.interpretation, /不是.*置信区间/);
  }
  const selectedRounding = audit.candidates.find((item) => item.key === audit.selectedCandidate).currentPrecisionRange;
  assert.deepEqual(audit.precisionRange.detail, selectedRounding);
  assert.equal(audit.precisionRange.minimum, selectedRounding.scoreInterval[0]);
  assert.equal(audit.precisionRange.maximum, selectedRounding.scoreInterval[1]);
  assert.equal(audit.precisionRange.rawBound, .05);
  assert.equal(audit.precisionRange.unit, "百分点");
  assert.deepEqual(rule.calibration.precisionRange, audit.precisionRange);
  assert.match(rule.thresholdStatus, /试行/);
  assert.match(rule.thresholdStatus, /非官方PPI目标/);
  assert.match(rule.scoringBasis, /不提供官方PPI目标|不是官方.*评分/);
  assert.ok(audit.evidenceSources.length >= 3);
  for (const item of audit.evidenceSources) {
    const url = new URL(item.url);
    assert.equal(url.protocol, "https:");
    assert.ok(["stats.gov.cn", "ndrc.gov.cn", "pbc.gov.cn"].some((domain) => url.hostname === domain || url.hostname.endsWith("." + domain)));
  }
  const baseline = audit.candidates.find((item) => item.key === "baseline").diagnostics.find((item) => item.key === "all");
  const selected = audit.candidates.find((item) => item.key === audit.selectedCandidate).diagnostics.find((item) => item.key === "all");
  if (selected.maximumAbsoluteScoreChange > baseline.maximumAbsoluteScoreChange) {
    assert.ok(audit.limitations.some((item) => /最大单次|最大.*变分/.test(item)),
      "a larger maximum jump must not be hidden behind a one-sided smoother claim");
  }
});

test("the shared standards UI identifies a one-item PPI review and displays linked official mechanism evidence without claiming official anchors", () => {
  const source = fs.readFileSync(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
  assert.deepEqual({ reviewed: framework.calibrationReview.reviewedCount, adjusted: framework.calibrationReview.adjustedCount,
    retained: framework.calibrationReview.retainedCount, indicatorCount: framework.calibrationReview.indicatorCount },
  { reviewed: 1, adjusted: 1, retained: 36, indicatorCount: 37 });
  assert.match(framework.calibrationReview.summary, /PPI专项复核1项/);
  assert.match(framework.calibrationReview.summary, /36项沿用V1\.16/);
  assert.match(framework.calibrationReview.scope, /仅PPI/);
  assert.match(source, /textValue\(review\.summary\) \?\?/);
  assert.match(source, /textValue\(review\.scope\)/);
  assert.match(source, /官方机制依据/);
  assert.match(source, /evidenceSources\.map/);
  assert.match(source, /href=\{textValue\(source\.url\) \?\? "#"\}/);
  assert.match(source, /这些材料解释经济机制，不提供官方评分参考点/);
  assert.deepEqual(rule.calibration.evidenceSources, audit.evidenceSources);
  assert.deepEqual(rule.calibration.comparisons, audit.comparisons);
  assert.equal(rule.calibration.comparisons.length, 4);
  assert.ok(rule.calibration.comparisons.every((item) => item.label && item.summary));
  assert.equal(rule.calibration.version, framework.version);
  assert.ok(framework.indicators.filter((item) => item.id !== "E04").every((item) => item.calibration.version === "V1.16"),
    "older unchanged rule diagnostics retain their true review version");
});

test("real rendered standards and records display the revised PPI references, linked sources and current score together", () => {
  const source = fs.readFileSync(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { fileName: "MacroRatingV1.tsx", reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  assert.equal(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
  const externalRequire = createRequire(import.meta.url);
  const module = { exports: {} };
  runInNewContext(compiled.outputText, { module, exports: module.exports, console,
    require(specifier) {
      if (specifier === "../data/macro-rating-v1.json") return framework;
      if (specifier === "../data/macro-rating-current.json") return current;
      if (specifier === "../data/macro-rating-history.json") return history;
      if (specifier === "../../lib/macro-rating.mjs") return { evaluateMacroRating, scoreIndicator };
      if (specifier === "../../lib/macro-rating-research.mjs") return researchEngine;
      if (specifier === "../../lib/macro-rating-summary.mjs") return summaryEngine;
      if (specifier === "../../lib/macro-profit-breadth.mjs") return breadthEngine;
      if (specifier === "../../lib/macro-scoring-continuous.mjs") return { continuousScoreDetails };
      return externalRequire(specifier);
    },
  });
  const standards = renderToStaticMarkup(React.createElement(module.exports.MacroRatingIndicators, { selectedRuleId: "E04" }));
  assert.ok(standards.includes(framework.calibrationReview.summary));
  assert.ok(standards.includes(framework.calibrationReview.scope));
  assert.match(standards, /官方机制依据/);
  assert.match(standards, /这些材料解释经济机制，不提供官方评分参考点/);
  for (const item of audit.evidenceSources) assert.ok(standards.includes(`href="${item.url}"`), item.title);
  const ppiStart = standards.indexOf('id="macro-rule-E04"');
  const ppiEnd = standards.indexOf('id="macro-rule-E05"', ppiStart);
  assert.ok(ppiStart >= 0 && ppiEnd > ppiStart);
  const ppi = standards.slice(ppiStart, ppiEnd);
  assert.match(ppi, /原值评分参照点/);
  assert.match(ppi, /1—2%/);
  assert.match(ppi, /3\.60 分/);
  assert.match(ppi, /原值3\.8%|原始观察为3\.8%/);
  const recordHtml = renderToStaticMarkup(React.createElement(module.exports.MacroRatingHistory));
  assert.match(recordHtml, /V1\.17/);
  assert.match(recordHtml, /2\.89/);
  assert.match(recordHtml, /3\.60/);
  assert.doesNotMatch(recordHtml, /2026-10-11-V1\.16/);
});
