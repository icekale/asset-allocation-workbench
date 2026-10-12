"use client";

import { useState } from "react";

export function DraftActions({ canPublish }: { canPublish: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: "publish" | "discard") {
    const text = action === "publish" ? "确认发布为新版本？发布后追加进评分历史，不可覆盖。" : "确认忽略并删除这份草稿？正式评分不变。";
    if (!window.confirm(text)) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/rating-draft/${action}`, { method: "POST", credentials: "same-origin" });
    const body = (await response.json().catch(() => ({}))) as { error?: string; result?: string };
    setBusy(false);
    if (!response.ok) { setMessage(`失败：${body.error ?? response.status}`); return; }
    setMessage(action === "publish" ? `已发布 ${body.result ?? ""}；门户正在重建，约数分钟后首页显示新版本。` : "草稿已忽略。");
  }
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0" }}>
      <button disabled={busy || !canPublish} onClick={() => act("publish")} style={{ padding: "8px 18px", background: "#1f6feb", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>发布</button>
      <button disabled={busy} onClick={() => act("discard")} style={{ padding: "8px 18px", border: "1px solid #999", borderRadius: 6, background: "#fff", cursor: "pointer" }}>忽略</button>
      {message && <span>{message}</span>}
    </div>
  );
}
