import { LoginForm } from "../components/LoginForm";
import { isAuthorized } from "../../lib/auth";
import { sidecar } from "../../lib/rating-sidecar";
import current from "../data/macro-rating-current.json";
import framework from "../data/macro-rating-v1.json";
import history from "../data/macro-rating-history.json";
import advisory from "../data/advisory.json";
import { attributeHistory } from "../../lib/macro-rating-attribution.mjs";
import { adviseAllocation, backtestAllocationSignal } from "../../lib/allocation-advisory.mjs";
import { evaluateMacroRating } from "../../lib/macro-rating.mjs";
import { Simulator } from "./Simulator";

export default async function RatingToolsPage() {
  if (!(await isAuthorized())) return <LoginForm />;
  const attributions = attributeHistory(history);
  const live = evaluateMacroRating(framework as never, current as never);
  // Prefer draft grade if present via sidecar; else current formal
  const draft = await sidecar("/draft");
  const draftBody = draft.body as { draft?: { after?: { score?: number; grade?: string }; rulesVersion?: string } };
  const grade = draftBody.draft?.after?.grade || live.grade;
  const pillars = live.pillars;
  const advice = adviseAllocation({ grade, pillars });
  const bt = backtestAllocationSignal({ history, macroHistory: (advisory as { macroHistory: unknown }).macroHistory });
  const cell = { padding: "4px 8px", borderBottom: "1px solid #eee", textAlign: "left" as const, fontSize: 13 };
  const indicators = (framework as { indicators: Array<{ id: string; name: string; weight: number }> }).indicators.map((r) => ({
    id: r.id, name: r.name, weight: r.weight,
    oldValue: (current as { observations: Record<string, { value?: number }> }).observations[r.id]?.value ?? null,
  }));
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <p><a href="/">← 返回工作台</a> · <a href="/rating-draft">评分草稿</a> · <a href="/ops">运维健康</a></p>
      <h1>评分归因 · 情景模拟 · 配置建议</h1>

      <section style={{ marginBottom: 28 }}>
        <h2>版本归因</h2>
        <p style={{ color: "#555" }}>相邻正式快照之间，哪些指标贡献变化最大（只读历史，不改规则）。</p>
        {attributions.length === 0 ? <p>暂无足够快照。</p> : attributions.map((att) => (
          <details key={`${att.previous.version}-${att.current.version}`} open={att.current.version === attributions.at(-1)?.current.version} style={{ marginBottom: 10 }}>
            <summary>{att.previous.version}（{att.previous.score?.toFixed?.(3)}）→ {att.current.version}（{att.current.score?.toFixed?.(3)}）· Δ {att.totalDelta?.toFixed?.(4)} · {att.current.grade}</summary>
            <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
              <thead><tr>{["方向", "指标", "旧分", "新分", "贡献Δ"].map((t) => <th key={t} style={cell}>{t}</th>)}</tr></thead>
              <tbody>
                {[...att.topUp.map((d) => ({ ...d, dir: "↑" })), ...att.topDown.map((d) => ({ ...d, dir: "↓" }))].map((d) => (
                  <tr key={d.id}><td style={cell}>{d.dir}</td><td style={cell}>{d.id} {d.name}</td><td style={cell}>{d.oldPoints}</td><td style={cell}>{d.newPoints}</td><td style={cell}>{d.contributionDelta?.toFixed?.(4)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </section>

      <Simulator indicators={indicators} />

      <section style={{ marginTop: 28, border: "2px dashed #c90", padding: 16, borderRadius: 8, background: "#fffbeb" }}>
        <h2>配置建议（顾问示意 · 非正式投顾）</h2>
        <p><strong>{advice.label}</strong></p>
        {!advice.available ? <p>{advice.reason}</p> : (
          <>
            <p>依据档位：{advice.grade} · 立场：{advice.stance}{draftBody.draft ? `（草稿规则 ${draftBody.draft.rulesVersion}，正式发布前仅供对照）` : ""}</p>
            <table style={{ borderCollapse: "collapse" }}>
              <thead><tr>{["大类", "建议权重区间"].map((t) => <th key={t} style={cell}>{t}</th>)}</tr></thead>
              <tbody>{Object.entries(advice.ranges).map(([k, v]) => <tr key={k}><td style={cell}>{k}</td><td style={cell}>{(v[0] * 100).toFixed(0)}% – {(v[1] * 100).toFixed(0)}%</td></tr>)}</tbody>
            </table>
            <p style={{ fontSize: 13 }}>{advice.tilts.note}</p>
            <p style={{ fontSize: 12, color: "#664" }}>{advice.disclaimer}</p>
          </>
        )}
        <h3>信号回测（方法演示）</h3>
        <p style={{ fontSize: 13 }}>{bt.method}</p>
        <p style={{ fontSize: 12, color: "#664" }}>{bt.limitation} 代理指标：{bt.proxyMetric || "无"}</p>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["版本", "截止", "档位", "总分", "权益中点", "代理年", "代理值"].map((t) => <th key={t} style={cell}>{t}</th>)}</tr></thead>
          <tbody>{bt.rows.map((r) => <tr key={r.version + r.asOf}><td style={cell}>{r.version}</td><td style={cell}>{r.asOf}</td><td style={cell}>{r.grade}</td><td style={cell}>{r.score?.toFixed?.(3)}</td><td style={cell}>{r.equityMid == null ? "—" : `${(r.equityMid * 100).toFixed(1)}%`}</td><td style={cell}>{r.proxyYear}</td><td style={cell}>{r.proxyReturn ?? "—"}</td></tr>)}</tbody>
        </table>
      </section>
    </main>
  );
}
