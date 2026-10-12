import { latestPayload } from "../../../lib/database";

/** 数据超过该小时数未更新即视为陈旧，供外部监控直接断言。 */
const STALE_AFTER_HOURS = 72;

export async function GET() {
  const base = { ok: true, service: "multi-asset-allocation", time: new Date().toISOString() };
  try {
    const payload = await latestPayload();
    const observed = Date.parse(payload.collectedAt);
    const ageHours = Number.isFinite(observed) ? Math.max(0, Math.round((Date.now() - observed) / 3_600_000)) : null;
    return Response.json({
      ...base,
      asOf: payload.asOf,
      collectedAt: payload.collectedAt,
      status: payload.status,
      ageHours,
      stale: payload.status === "seed" || ageHours === null || ageHours > STALE_AFTER_HOURS,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // latestPayload 内部已有 seed 兜底；能走到这里说明 D1 或校验出现异常，需要显式暴露。
    return Response.json({
      ...base,
      ok: false,
      data: "unavailable",
      error: error instanceof Error ? error.message : "unknown error",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
