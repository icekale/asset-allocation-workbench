// Map macro tier / pillar scores to allocation suggestion ranges. Advisory only — never writes ratings or D1.
export const TIER_RANGES = [
  { gradePrefix: "I档", equity: [0.55, 0.70], rates: [0.10, 0.20], credit: [0.10, 0.20], commodity: [0.05, 0.10], cash: [0.05, 0.10], stance: "权益偏积极" },
  { gradePrefix: "II档", equity: [0.45, 0.60], rates: [0.15, 0.25], credit: [0.10, 0.20], commodity: [0.05, 0.10], cash: [0.05, 0.15], stance: "权益适度超配" },
  { gradePrefix: "III档", equity: [0.35, 0.50], rates: [0.20, 0.30], credit: [0.10, 0.20], commodity: [0.05, 0.10], cash: [0.10, 0.20], stance: "均衡配置" },
  { gradePrefix: "IV档", equity: [0.20, 0.35], rates: [0.25, 0.40], credit: [0.10, 0.20], commodity: [0.05, 0.10], cash: [0.15, 0.30], stance: "降低权益、提高防御" },
  { gradePrefix: "V档", equity: [0.10, 0.25], rates: [0.30, 0.45], credit: [0.05, 0.15], commodity: [0.05, 0.10], cash: [0.20, 0.40], stance: "防御为主" },
];

const matchTier = (grade) => TIER_RANGES.find((t) => (grade || "").startsWith(t.gradePrefix)) || null;

/** Adjust equity band by pillar observed scores (1–5). Missing pillars → no tilt. */
export function adviseAllocation({ grade, pillars = [] }) {
  const base = matchTier(grade);
  if (!base) return { label: "建议（仅供参考）", available: false, reason: "无正式档位，不给出配置区间" };
  const by = Object.fromEntries(pillars.map((p) => [p.name, p.observedScore]));
  const credit = by["金融信贷"], growth = by["增长动力"], policy = by["宏观调控"];
  let equityTilt = 0;
  if (credit != null && credit < 2.5) equityTilt -= 0.05;
  if (credit != null && credit >= 3.5) equityTilt += 0.03;
  if (growth != null && growth < 2.5) equityTilt -= 0.03;
  if (policy != null && policy >= 4) equityTilt += 0.02;
  const clip = (lo, hi) => [Math.max(0.05, lo + equityTilt), Math.min(0.75, hi + equityTilt)];
  const equity = clip(base.equity[0], base.equity[1]);
  return {
    label: "建议（仅供参考，非正式投顾）", available: true, grade, stance: base.stance,
    ranges: {
      权益: equity, 利率债: base.rates, 信用债: base.credit, 商品: base.commodity, 现金及货币: base.cash,
    },
    tilts: { equityTilt, note: "金融信贷/增长动力偏低时下调权益上限；政策高分仅小幅上调，不单独决定仓位。" },
    disclaimer: "本面板把宏观正式档位映射为示意性大类权重区间，不是交易指令，也不构成投资建议。区间为研究试用映射，未经完整样本外回测优化。",
  };
}

/**
 * Back-test: for each archived formal rating, map grade → equity midpoint, compare to next-period
 * equity proxy return from advisory annual history (GDP is not used; prefer equity-like series if present).
 * Falls back to Shanghai/CSI-like annual values in macroHistory when labelled as equity.
 */
export function backtestAllocationSignal({ history, macroHistory }) {
  const snaps = (history?.snapshots || []).filter((s) => s.score != null && s.grade);
  const series = (macroHistory?.series || []).find((s) => /沪深|上证|权益|股票|A股/.test(s.metric || ""))
    || (macroHistory?.series || []).find((s) => /GDP 实际增速/.test(s.metric || ""));
  const periods = macroHistory?.periods || [];
  const annual = {};
  if (series && periods.length) periods.forEach((p, i) => { annual[String(p)] = series.values?.[i]; });
  const rows = snaps.map((s) => {
    const adv = adviseAllocation({ grade: s.grade, pillars: s.pillars || [] });
    const mid = adv.available ? (adv.ranges.权益[0] + adv.ranges.权益[1]) / 2 : null;
    const year = String(s.asOf || "").slice(0, 4);
    return { version: s.version, asOf: s.asOf, grade: s.grade, score: s.score, equityMid: mid,
      proxyYear: year, proxyReturn: annual[year] ?? null, proxyMetric: series?.metric || null };
  });
  const paired = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    const a = rows[i], b = rows[i + 1];
    if (a.equityMid == null || b.score == null) continue;
    paired.push({ from: a, to: b, signalDelta: b.equityMid - a.equityMid, scoreDelta: b.score - a.score });
  }
  return {
    method: "档位→权益区间中点作为信号；收益代理优先取宏观史中的权益/指数年收益，否则用 GDP 实际增速仅作占位（标注 proxyMetric）。样本极短，结果只作方法演示。",
    proxyMetric: series?.metric || null, rows, paired,
    limitation: "可用指数日频历史未入库；当前仅有少量正式评分快照与年度序列，不构成统计显著回测。",
  };
}
