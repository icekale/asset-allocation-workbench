"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "密码不正确，请重试。");
        return;
      }
      window.location.reload();
    } catch {
      setError("暂时无法连接，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-mark">MA</div>
        <p className="eyebrow">受控访问</p>
        <h1 id="login-title">资产配置工作台</h1>
        <p className="login-copy">请输入访问密码，查看最新配置、因子证据与调仓建议。</p>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="portal-password">访问密码</label>
          <input
            id="portal-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入密码"
            required
            autoFocus
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={loading}>
            {loading ? "正在验证…" : "进入系统"}
          </button>
        </form>
        <p className="login-footnote">数据仅供授权人员查看。系统不构成投资建议。</p>
      </section>
    </main>
  );
}
