"use client";

import { useState } from "react";

export type Evidence = { label: string; value: string; period?: string; url?: string; releaseDate?: string | null };
export type Suggestion = { id: string; name: string; label: string; previousValue: number | null; previousPeriod: string | null; suggestedValue: number | null;
  period: string; evidence: Evidence[]; signals: string[]; rationale: string; limitation?: string; key: string; hasCandidate: boolean;
  editable: { min: number; max: number; step: number } | null };
export type Decision = { action: string; at: string; value?: number | null; note?: string | null; applied?: boolean; error?: string | null; stale?: boolean } | null;

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）"; };
const actionName: Record<string, string> = { confirm: "确认建议", edit: "改档", keep: "沿用上一版" };

export function SuggestionCard({ s, source, decision }: { s: Suggestion; source: string; decision: Decision }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [value, setValue] = useState(s.suggestedValue === null ? "" : String(s.suggestedValue));
  const [note, setNote] = useState("");
  async function decide(action: "confirm" | "edit" | "keep") {
    const text = action === "confirm" ? (s.id === "P02E" ? "确认即视为已逐月复核12期工具表与调整公告（作为本期月度核验声明）。继续？" : `确认采用建议值 ${s.suggestedValue}？`)
      : action === "edit" ? `改为 ${value} 分？` : "本期沿用上一版观察？";
    if (!window.confirm(text)) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/rating-draft/decide", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: s.id, action, key: s.key, value: action === "edit" ? Number(value) : null, note }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string; decision?: Decision };
    setBusy(false);
    if (!response.ok) { setMessage(`失败：${body.error ?? response.status}`); return; }
    setMessage(body.decision?.error ? `已记录，但${body.decision.error}` : "已记录，草稿已重建；刷新页面查看。");
  }
  const box = { border: "1px solid #d0d7de", borderRadius: 8, padding: 12, margin: "10px 0", background: source.startsWith("manual-") && source !== "manual-carry" ? "#effaf0" : "#fffbea" };
  return (
    <div style={box}>
      <strong>{s.id} {s.name}</strong> <span style={{ color: "#9a6700" }}>【{s.label}】</span>
      <div>上一版 {s.previousValue ?? "—"}（{s.previousPeriod ?? "—"}） → 建议 {s.suggestedValue ?? "—"}（{s.period}） · 草稿当前：{source === "manual-carry" ? "沿用（未确认）" : source}</div>
      <div style={{ fontSize: 13, margin: "6px 0" }}>{s.rationale}</div>
      {s.signals.length > 0 && <ul style={{ fontSize: 13, margin: "4px 0" }}>{s.signals.map((t) => <li key={t}>{t}</li>)}</ul>}
      <details><summary style={{ cursor: "pointer", fontSize: 13 }}>证据 {s.evidence.length} 条</summary>
        <ul style={{ fontSize: 12 }}>{s.evidence.map((e, i) => <li key={i}>{e.label}：{e.value}{e.period ? `（${e.period}）` : ""}{e.releaseDate ? ` 发布 ${e.releaseDate}` : ""} {e.url && <a href={e.url} target="_blank" rel="noreferrer">原文</a>}</li>)}</ul>
      </details>
      {s.limitation && <div style={{ fontSize: 12, color: "#666" }}>限制：{s.limitation}</div>}
      {decision && <div style={{ fontSize: 13, marginTop: 4 }}>最近操作：{actionName[decision.action] ?? decision.action} · {when(decision.at)}{decision.value != null ? ` · ${decision.value}分` : ""}{decision.stale ? " · 已过期（建议已更新）" : ""}{decision.error ? ` · ${decision.error}` : ""}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button disabled={busy || !s.hasCandidate} onClick={() => decide("confirm")}>确认建议</button>
        {s.editable && <>
          <input type="number" min={s.editable.min} max={s.editable.max} step={s.editable.step} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 64 }} />
          <input placeholder="改档理由（必填）" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 260 }} />
          <button disabled={busy || !note.trim()} onClick={() => decide("edit")}>改档</button>
        </>}
        <button disabled={busy} onClick={() => decide("keep")}>沿用上一版</button>
        {!s.hasCandidate && <span style={{ fontSize: 12, color: "#666" }}>（该建议无可直接套用的观察，只能沿用）</span>}
        {message && <span>{message}</span>}
      </div>
    </div>
  );
}
