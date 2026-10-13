import { isAuthorized } from "../../../lib/auth";
import { sidecar } from "../../../lib/rating-sidecar";

export async function GET() {
  if (!(await isAuthorized())) return Response.json({ error: "未登录" }, { status: 401 });
  const result = await sidecar("/attribution");
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) return Response.json({ error: "未登录" }, { status: 401 });
  const payload = await request.json().catch(() => ({}));
  const result = await sidecar("/simulate", "POST", payload);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "private, no-store" } });
}
