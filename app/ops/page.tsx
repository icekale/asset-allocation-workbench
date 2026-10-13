import { LoginForm } from "../components/LoginForm";
import { isAuthorized } from "../../lib/auth";
import { sidecar } from "../../lib/rating-sidecar";

export default async function OpsPage() {
  if (!(await isAuthorized())) return <LoginForm />;
  const health = await sidecar("/health-sources");
  const alerts = await sidecar("/alerts");
  const h = health.body as { summary?: Record<string, number>; sources?: Array<Record<string, unknown>>; today?: string; notification?: { note?: string; optionsNeedingUserInput?: Array<{ channel: string; needs: string[] }> }; generatedAt?: string };
  const a = alerts.body as { alerts?: Array<Record<string, unknown>> };
  const cell = { padding: "4px 8px", borderBottom: "1px solid #eee", textAlign: "left" as const, fontSize: 13 };
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <p><a href="/">← 返回工作台</a> · <a href="/rating-draft">评分草稿</a> · <a href="/rating-tools">归因与情景</a></p>
      <h1>运维健康</h1>
      <p style={{ color: "#555" }}>各数据源最近成功时间、预期下次发布与过期标记。告警只写本地文件并在此展示，不外发。</p>
      {health.status !== 200 ? <p>健康报告不可用（{String((health.body as { error?: string }).error || health.status)}）。请在 DMIT 运行 <code>node scripts/source-health.mjs</code>。</p> : (
        <>
          <p>生成于 {h.generatedAt}（上海日历日 {h.today}）· 共 {h.summary?.total} 项 · 正常 {h.summary?.ok} · 过期 {h.summary?.stale} · 超窗 {h.summary?.overdue}</p>
          <h2>告警（{a.alerts?.length ?? h.summary?.alerts ?? 0}）</h2>
          {(a.alerts || []).length === 0 ? <p>当前无告警。</p> : (
            <ul>{(a.alerts || []).map((x) => <li key={String(x.id)}><strong>{String(x.severity)}</strong> {String(x.title)} · 最近成功 {String(x.lastSuccess ?? "—")} · 预期下次 {String(x.expectedNextRelease ?? "—")}</li>)}</ul>
          )}
          <h2>数据源</h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["状态", "名称", "最近成功", "预期下次", "年龄(天)", "来源"].map((t) => <th key={t} style={cell}>{t}</th>)}</tr></thead>
            <tbody>
              {(h.sources || []).map((s) => (
                <tr key={String(s.id)}>
                  <td style={cell}>{String(s.severity)}</td>
                  <td style={cell}>{String(s.label)}</td>
                  <td style={cell}>{String(s.lastSuccess ?? "—")}</td>
                  <td style={cell}>{String(s.expectedNextRelease ?? "—")}</td>
                  <td style={cell}>{String(s.ageDays ?? "—")}</td>
                  <td style={cell}>{String(s.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>外部通知（未启用）</h2>
          <p>{h.notification?.note}</p>
          <ul>{(h.notification?.optionsNeedingUserInput || []).map((o) => <li key={o.channel}><strong>{o.channel}</strong>：需要 {o.needs.join("、")}</li>)}</ul>
        </>
      )}
    </main>
  );
}
