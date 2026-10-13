// Version-to-version score attribution from archived history snapshots. Read-only.
export function attributeSnapshots(prev, next) {
  if (!prev || !next) return null;
  const byId = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r]));
  const a = byId(prev.rows), b = byId(next.rows);
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const drivers = ids.map((id) => {
    const x = a[id], y = b[id];
    const oldC = x?.contribution ?? (x?.points != null && x?.weight != null ? x.points * x.weight : null);
    const newC = y?.contribution ?? (y?.points != null && y?.weight != null ? y.points * y.weight : null);
    const delta = oldC != null && newC != null ? newC - oldC : null;
    return { id, name: y?.name || x?.name || id, pillar: y?.pillar || x?.pillar || null,
      weight: y?.weight ?? x?.weight ?? null, oldPoints: x?.points ?? null, newPoints: y?.points ?? null,
      oldContribution: oldC, newContribution: newC, contributionDelta: delta };
  }).filter((r) => r.contributionDelta != null && Math.abs(r.contributionDelta) > 1e-12)
    .sort((p, q) => Math.abs(q.contributionDelta) - Math.abs(p.contributionDelta));
  return {
    previous: { version: prev.version, asOf: prev.asOf, score: prev.score, grade: prev.grade },
    current: { version: next.version, asOf: next.asOf, score: next.score, grade: next.grade },
    totalDelta: prev.score != null && next.score != null ? next.score - prev.score : null,
    drivers, topUp: drivers.filter((d) => d.contributionDelta > 0).slice(0, 5),
    topDown: drivers.filter((d) => d.contributionDelta < 0).slice(0, 5),
  };
}

export function attributeHistory(history) {
  const snaps = [...(history?.snapshots || [])].sort((a, b) => String(a.asOf).localeCompare(String(b.asOf)) || String(a.version).localeCompare(String(b.version)));
  const out = [];
  for (let i = 1; i < snaps.length; i += 1) out.push(attributeSnapshots(snaps[i - 1], snaps[i]));
  return out.filter(Boolean);
}
