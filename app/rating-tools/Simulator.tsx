"use client";
import { useState } from "react";

type Row = { id: string; name: string; weight: number; oldValue: number | null; unit?: string };
type Props = { indicators: Row[] };

export function Simulator({ indicators }: Props) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setError("");
    const overrides: Record<string, { value: number }> = {};
    for (const [id, text] of Object.entries(edits)) {
      if (text.trim() === "") continue;
      const value = Number(text);
      if (!Number.isFinite(value)) { setError(`${id} 不是有效数字`); setBusy(false); return; }
      overrides[id] = { value };
    }
    const res = await fetch("/api/rating-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overrides }) });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(String(body.error || res.status)); return; }
    setResult(body);
  }

  const scenario = result?.scenario as { score?: number; grade?: string; status?: string } | undefined;
  const base = result?.base as { score?: number; grade?: string } | undefined;
  return (
    <section>
      <h2>情景模拟（只读，不写库）</h2>
      <p style={{ color: "#555" }}>修改下列指标原值后重算总分/档位。请求只在内存计分，不改 draft / current / history / D1。</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
        {indicators.slice(0, 24).map((r) => (
          <label key={r.id} style={{ fontSize: 13, border: "1px solid #eee", padding: 8, borderRadius: 6 }}>
            <div>{r.id} {r.name}</div>
            <div style={{ color: "#888" }}>当前 {r.oldValue ?? "—"} · 权重 {(r.weight * 100).toFixed(1)}%</div>
            <input value={edits[r.id] ?? ""} placeholder="覆盖原值" onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
          </label>
        ))}
      </div>
      <p style={{ marginTop: 12 }}>
        <button type="button" onClick={run} disabled={busy}>{busy ? "计算中…" : "模拟"}</button>
        {error ? <span style={{ color: "#c00", marginLeft: 12 }}>{error}</span> : null}
      </p>
      {result ? (
        <p>基准 {base?.score?.toFixed?.(4) ?? base?.score}（{base?.grade}）→ 情景 {scenario?.score?.toFixed?.(4) ?? scenario?.score}（{scenario?.grade} · {scenario?.status}）· Δ {Number(result.totalDelta ?? 0).toFixed(4)}</p>
      ) : null}
    </section>
  );
}
