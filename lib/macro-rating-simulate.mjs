// In-memory scenario: clone current observations, overlay value edits, re-score. Never writes.
import { evaluateMacroRating, scoreIndicator } from "./macro-rating.mjs";

export function simulateRating({ framework, current, overrides = {} }) {
  const observations = structuredClone(current.observations || {});
  const applied = [];
  for (const [id, patch] of Object.entries(overrides)) {
    if (!observations[id]) continue;
    const next = { ...observations[id], ...patch };
    if (patch.value !== undefined) next.value = Number(patch.value);
    observations[id] = next;
    applied.push(id);
  }
  const draftCurrent = { ...structuredClone(current), observations };
  const result = evaluateMacroRating(framework, draftCurrent);
  const rows = framework.indicators.map((rule) => {
    const prev = current.observations[rule.id];
    const obs = observations[rule.id];
    const oldPoints = scoreIndicator(rule, prev, current.asOf, framework.freshness);
    const newPoints = scoreIndicator(rule, obs, current.asOf, framework.freshness);
    return { id: rule.id, name: rule.name, pillar: rule.pillar, weight: rule.weight,
      oldValue: prev?.value ?? null, newValue: obs?.value ?? null, oldScore: oldPoints, newScore: newPoints,
      contributionDelta: oldPoints != null && newPoints != null ? (newPoints - oldPoints) * rule.weight : null,
      overridden: applied.includes(rule.id) };
  });
  const base = evaluateMacroRating(framework, current);
  return {
    kind: "scenario-simulation", write: false,
    base: { score: base.formalScore, grade: base.grade, status: base.status },
    scenario: { score: result.formalScore, grade: result.grade, status: result.status },
    totalDelta: base.formalScore != null && result.formalScore != null ? result.formalScore - base.formalScore : null,
    applied, rows: rows.filter((r) => r.overridden || (r.contributionDelta != null && Math.abs(r.contributionDelta) > 1e-12)),
  };
}
