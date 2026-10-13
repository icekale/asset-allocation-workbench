import { env } from "cloudflare:workers";

function value(name: "AAW_RATING_SIDECAR_URL" | "AAW_RATING_TOKEN") {
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" ? v : "";
}

export async function sidecar(pathname: "/draft" | "/publish" | "/discard" | "/decide", method: "GET" | "POST" = "GET", payload?: unknown) {
  const base = value("AAW_RATING_SIDECAR_URL") || "http://127.0.0.1:8791";
  const token = value("AAW_RATING_TOKEN");
  if (!token) return { status: 503, body: { error: "评分草稿服务未配置" } as Record<string, unknown> };
  try {
    const response = await fetch(base + pathname, { method, headers: { authorization: `Bearer ${token}`, ...(payload ? { "content-type": "application/json" } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 502, body: { error: "评分草稿服务不可用" } as Record<string, unknown> };
  }
}
