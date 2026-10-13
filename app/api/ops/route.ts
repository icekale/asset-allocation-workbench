import { isAuthorized } from "../../../lib/auth";
import { sidecar } from "../../../lib/rating-sidecar";

export async function GET() {
  if (!(await isAuthorized())) return Response.json({ error: "未登录" }, { status: 401 });
  const [health, alerts] = await Promise.all([sidecar("/health-sources"), sidecar("/alerts")]);
  return Response.json({ health: health.body, alerts: alerts.body, healthStatus: health.status, alertsStatus: alerts.status }, { headers: { "cache-control": "private, no-store" } });
}
