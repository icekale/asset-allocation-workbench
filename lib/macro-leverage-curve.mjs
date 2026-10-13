// V1.22-candidate (STAGED, not active): F09/F10 scored by fixed piecewise-linear curves on CNBS sector leverage.
// score = levelWeight * curve(level) + (1 - levelWeight) * curve(YoY change in pp). No neutral fill: missing year-ago => null.
export const interp = (anchors, x) => {
  const a = [...anchors].sort((p, q) => p[0] - q[0]);
  if (x <= a[0][0]) return a[0][1];
  if (x >= a.at(-1)[0]) return a.at(-1)[1];
  for (let i = 1; i < a.length; i += 1) if (x <= a[i][0]) {
    const [x0, y0] = a[i - 1], [x1, y1] = a[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return null;
};
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const qn = (p) => { const m = /^(\d{4})-Q([1-4])$/.exec(p || ""); return m ? Number(m[1]) * 4 + Number(m[2]) : null; };

export function scoreLeverageCurve(rule, o) {
  const s = rule?.scoring;
  if (!s || s.method !== "leverage-curve-composite" || !Array.isArray(s.levelAnchors) || !Array.isArray(s.yoyAnchors) || !fin(s.levelWeight)) return null;
  if (!fin(o?.leverageRatio) || !fin(o?.yearAgoLeverageRatio) || !fin(o?.value) || Math.abs(o.value - o.leverageRatio) > 1e-9) return null;
  if (qn(o.period) === null || qn(o.yearAgoPeriod) !== qn(o.period) - 4) return null;
  const yoy = o.leverageRatio - o.yearAgoLeverageRatio;
  return s.levelWeight * interp(s.levelAnchors, o.leverageRatio) + (1 - s.levelWeight) * interp(s.yoyAnchors, yoy);
}

const qAdd = (q, k) => { const [y, n] = q.split("-Q").map(Number); const t = y * 4 + n - 1 + k; return `${Math.floor(t / 4)}-Q${(t % 4) + 1}`; };

/** Curve observations per CNBS quarter from collected evidence (verified original values only). */
export function cnbsObservations(cnbs, id) {
  const side = id === "F09" ? "household" : "corporate", level = {};
  for (const [q, r] of Object.entries(cnbs)) { if (Number.isFinite(r[side]?.previous) && level[qAdd(q, -1)] === undefined) level[qAdd(q, -1)] = { v: r[side].previous, src: r.sourceUrl, rel: r.releaseDate, prevField: true }; }
  for (const [q, r] of Object.entries(cnbs)) if (Number.isFinite(r[side]?.value)) level[q] = { v: r[side].value, src: r.sourceUrl, rel: r.releaseDate };
  return Object.keys(cnbs).sort().map((q) => {
    const r = cnbs[q], ya = level[qAdd(q, -4)];
    return { quarter: q, obs: { value: r[side].value, leverageRatio: r[side].value, yearAgoLeverageRatio: ya?.v ?? null, yearAgoPeriod: qAdd(q, -4),
      unit: "%", basis: "部门债务/过去四季名义GDP", originalPublisher: "国家资产负债表研究中心", period: q, latestAvailablePeriod: q,
      sourceUrl: r.sourceUrl, releaseDate: r.releaseDate, verified: true, verifiedAt: r.releaseDate, yearAgoNote: ya ? (ya.prevField ? "上年同季取自下一季报告“上季”原值" : "上年同季取自当季报告原值") : "无上年同季原值" } };
  });
}

