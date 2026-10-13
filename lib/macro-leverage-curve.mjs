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
