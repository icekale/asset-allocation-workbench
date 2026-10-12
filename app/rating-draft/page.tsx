import { LoginForm } from "../components/LoginForm";
import { isAuthorized } from "../../lib/auth";
import { sidecar } from "../../lib/rating-sidecar";
import { DraftActions } from "./DraftActions";

export const dynamic = "force-dynamic";

type Row = { id: string; name: string; pillar: string; weight: number; source: string; note: string; oldValue: number | null; oldPeriod: string | null;
  newValue: number | null; newPeriod: string | null; oldScore: number | null; newScore: number | null; contributionDelta: number | null; missing: boolean };
type Draft = { generatedAt: string; asOf: string; baseVersion: string; baseAsOf: string; rulesVersion: string; policy: string; totalDelta: number | null;
  tierChanged: boolean; notable: boolean; counts: Record<string, number>;
  before: { score: number | null; grade: string | null; pillars: Record<string, number | null> };
  after: { score: number | null; grade: string | null; status: string; pillars: Record<string, number | null> }; rows: Row[] };

const f = (v: number | null | undefined, d = 2) => v === null || v === undefined ? "—" : v.toFixed(d);
const sourceLabel: Record<string, string> = { auto: "自动新一期", "auto-no-new": "无更新", "auto-rejected": "新数据未通过核验", "manual-carry": "人工项·沿用" };

export default async function RatingDraftPage() {
  if (!(await isAuthorized())) return <LoginForm />;
  const { status, body } = await sidecar("/draft");
  const draft = (body.draft ?? null) as Draft | null;
  const cell = { padding: "4px 8px", borderBottom: "1px solid #eee", textAlign: "left" as const, fontSize: 13 };
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24, fontFamily: "inherit" }}>
      <p><a href="/">← 返回工作台</a></p>
      <h1>待发布评分</h1>
      {!draft ? <p>{status === 404 ? "当前没有待发布的评分草稿。采集 apply 完成后会自动生成。" : `无法读取草稿：${String(body.error ?? status)}`}</p> : (
        <>
          <p style={{ color: "#555" }}>{draft.policy}</p>
          <p>基于 {draft.baseVersion}（截止 {draft.baseAsOf}）→ 草稿截止 {draft.asOf}；规则冻结版本 {draft.rulesVersion}；生成于 {draft.generatedAt}</p>
          <h2>总分 {f(draft.before.score)} → {f(draft.after.score)}（Δ {f(draft.totalDelta, 3)}）{draft.notable && <span style={{ color: "#c00" }}> · 显著变化</span>}</h2>
          <p>档位：{draft.before.grade ?? "—"} → {draft.after.grade ?? "—"}{draft.tierChanged ? "（档位变化）" : ""}；状态 {draft.after.status}</p>
          <p>自动新一期 {draft.counts.auto} 项 · 可自动但无更新 {draft.counts.autoNoNew ?? 0} 项 · 新数据未通过核验 {draft.counts.autoRejected ?? 0} 项 · 人工项沿用 {draft.counts.manualCarry} 项 · 缺数据 {draft.counts.missing} 项（缺数据不重新分配权重）</p>
          <table style={{ borderCollapse: "collapse", width: "100%", margin: "8px 0" }}>
            <thead><tr>{["大类", "旧分", "新分"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>{Object.keys(draft.before.pillars).map((name) => <tr key={name}><td style={cell}>{name}</td><td style={cell}>{f(draft.before.pillars[name])}</td><td style={cell}>{f(draft.after.pillars[name])}</td></tr>)}</tbody>
          </table>
          <DraftActions canPublish={draft.after.status === "正式"} />
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["指标", "权重", "旧值(期)", "新值(期)", "旧分", "新分", "贡献Δ", "来源", "说明"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>{draft.rows.map((r) => (
              <tr key={r.id} style={{ background: r.missing ? "#fde8e8" : r.source === "auto" ? "#e8f4fd" : undefined }}>
                <td style={cell}>{r.id} {r.name}</td><td style={cell}>{(r.weight * 100).toFixed(2)}%</td>
                <td style={cell}>{r.oldValue ?? "—"}（{r.oldPeriod ?? "—"}）</td><td style={cell}>{r.newValue ?? "—"}（{r.newPeriod ?? "—"}）</td>
                <td style={cell}>{f(r.oldScore)}</td><td style={cell}>{r.missing ? "缺" : f(r.newScore)}</td><td style={cell}>{f(r.contributionDelta, 4)}</td>
                <td style={cell}>{sourceLabel[r.source] ?? r.source}</td><td style={cell}>{r.note}</td>
              </tr>))}</tbody>
          </table>
        </>
      )}
    </main>
  );
}
