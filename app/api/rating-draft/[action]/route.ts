import { isAuthorized } from "../../../../lib/auth";
import { sidecar } from "../../../../lib/rating-sidecar";

export async function POST(_request: Request, context: { params: Promise<{ action: string }> }) {
  if (!(await isAuthorized())) return Response.json({ error: "未登录" }, { status: 401 });
  const { action } = await context.params;
  if (action !== "publish" && action !== "discard") return Response.json({ error: "未知操作" }, { status: 404 });
  const result = await sidecar(action === "publish" ? "/publish" : "/discard", "POST");
  return Response.json(result.body, { status: result.status });
}
