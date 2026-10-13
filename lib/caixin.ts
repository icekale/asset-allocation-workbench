export const CAIXIN_DEFAULT_BASE_URL = "https://cxdata.053727.xyz";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 8_000;

export type CaixinConfig = {
  apiKey: string;
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
};

export type CaixinMeta = {
  request_id?: string;
  total?: number;
  page?: number;
  page_size?: number;
  ignored_params?: string[];
  has_more?: boolean;
  [key: string]: unknown;
};

export type CaixinApiErrorCode =
  | "not_configured"
  | "upstream_http"
  | "upstream_html"
  | "invalid_json"
  | "invalid_response"
  | "timeout"
  | "network"
  | "no_data";

export class CaixinApiError extends Error {
  readonly code: CaixinApiErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code: CaixinApiErrorCode;
      status?: number;
      requestId?: string;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = "CaixinApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
  }
}

export type CaixinEnvelope<T> = {
  ok: true;
  data: T;
  meta?: CaixinMeta;
} | {
  ok: false;
  error?: { code?: string; message?: string };
  meta?: CaixinMeta;
};

export type CaixinSeriesSummary = {
  series_id: string;
  name: string;
  country?: string;
  unit?: string;
  frequency?: string;
  source?: string;
  tb_id?: string;
  has_data?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  [key: string]: unknown;
};

export type CaixinSeriesData = CaixinSeriesSummary & {
  observations: unknown;
  description?: unknown;
};

export type NormalizedObservation = {
  date: string;
  value: number | null;
};

export type NormalizedSeries = {
  seriesId: string;
  name: string;
  unit?: string;
  frequency?: string;
  source?: string;
  observations: NormalizedObservation[];
  description?: unknown;
  meta?: CaixinMeta;
};

function safeBaseUrl(value?: string) {
  const base = value?.trim() || CAIXIN_DEFAULT_BASE_URL;
  const parsed = new URL(base);
  if (parsed.protocol !== "https:") throw new Error("CAIXIN_API_BASE_URL must use HTTPS");
  return parsed.toString().replace(/\/$/, "");
}

function retryAfterMs(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, seconds * 1_000)) : 0;
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 503 || status === 504;
}

function isHtmlResponse(response: Response, body: string) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/html") || /^\s*<!doctype\s+html/i.test(body) || /^\s*<html/i.test(body);
}

function requestId(meta: unknown) {
  return meta && typeof meta === "object" && typeof (meta as CaixinMeta).request_id === "string"
    ? (meta as CaixinMeta).request_id
    : undefined;
}

function assertEnvelope<T>(value: unknown): CaixinEnvelope<T> {
  if (!value || typeof value !== "object" || typeof (value as { ok?: unknown }).ok !== "boolean") {
    throw new CaixinApiError("财新 API 返回字段不符合预期", { code: "invalid_response" });
  }
  return value as CaixinEnvelope<T>;
}

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search;
}

export async function caixinRequest<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  config: CaixinConfig,
): Promise<{ data: T; meta?: CaixinMeta }> {
  if (!config.apiKey?.trim()) throw new CaixinApiError("CAIXIN_API_KEY 未配置", { code: "not_configured" });
  const url = new URL(`${safeBaseUrl(config.baseUrl)}${path.startsWith("/") ? path : `/${path}`}`);
  url.search = queryString(params).toString();
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
  const headers = {
    accept: "application/json",
    "user-agent": config.userAgent?.trim() || "asset-allocation-protected-site/1.0",
    "x-api-key": config.apiKey,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let serverRetryDelay = 0;
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      const body = await response.text();
      serverRetryDelay = retryAfterMs(response);
      if (isHtmlResponse(response, body)) {
        throw new CaixinApiError("财新 API 返回 HTML，可能被 Cloudflare 机器人防护拦截", {
          code: "upstream_html",
          status: response.status,
          retryable: true,
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new CaixinApiError("财新 API 返回了无法解析的 JSON", {
          code: "invalid_json",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }
      // Cloudflare/gateway 5xx bodies are JSON but not the Caixin {ok,data,meta} envelope.
      if (!response.ok) {
        const maybe = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
        const nestedError = maybe && typeof maybe.error === "object" && maybe.error
          ? maybe.error as { code?: string; message?: string }
          : null;
        const code = nestedError?.code === "no_data" ? "no_data" : "upstream_http";
        throw new CaixinApiError(
          nestedError?.message || (typeof maybe?.title === "string" ? maybe.title : undefined) || `财新 API HTTP ${response.status}`,
          {
            code,
            status: response.status,
            requestId: requestId(maybe?.meta as CaixinMeta | undefined),
            retryable: isRetryableStatus(response.status) || code !== "no_data",
          },
        );
      }
      let envelope: CaixinEnvelope<T>;
      try {
        envelope = assertEnvelope<T>(parsed);
      } catch (error) {
        if (error instanceof CaixinApiError) throw error;
        throw new CaixinApiError("财新 API 返回了无法解析的 JSON", { code: "invalid_json", status: response.status });
      }
      if (!envelope.ok) {
        const code = envelope.error?.code === "no_data" ? "no_data" : "upstream_http";
        throw new CaixinApiError(envelope.error?.message || "财新 API 返回失败", {
          code,
          status: response.status,
          requestId: requestId(envelope.meta),
          retryable: false,
        });
      }
      if (envelope.meta?.ignored_params?.length) {
        console.warn("财新 API ignored unknown parameters", envelope.meta.ignored_params);
      }
      return { data: envelope.data, meta: envelope.meta };
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      const normalized = error instanceof CaixinApiError
        ? error
        : new CaixinApiError(timedOut ? "财新 API 请求超时" : "财新 API 网络请求失败", {
            code: timedOut ? "timeout" : "network",
            retryable: true,
          });
      if (!normalized.retryable || attempt >= maxRetries) throw normalized;
      const delay = Math.max(serverRetryDelay, Math.min(MAX_RETRY_DELAY_MS, Math.max(2_000, 250 * 2 ** attempt)));
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new CaixinApiError("财新 API 请求失败", { code: "network" });
}

export function caixinConfigFromValues(values: Record<string, unknown>): CaixinConfig {
  return {
    apiKey: typeof values.CAIXIN_API_KEY === "string" ? values.CAIXIN_API_KEY : "",
    baseUrl: typeof values.CAIXIN_API_BASE_URL === "string" ? values.CAIXIN_API_BASE_URL : undefined,
    userAgent: typeof values.CAIXIN_API_USER_AGENT === "string" ? values.CAIXIN_API_USER_AGENT : undefined,
  };
}

export type CaixinSearchPayload = {
  query?: string;
  mode?: string;
  series?: CaixinSeriesSummary[];
  [key: string]: unknown;
};

/** Search endpoints return `{ query, mode, series: [...] }` (or occasionally a bare array). */
export function unwrapCaixinSearchSeries(data: unknown): CaixinSeriesSummary[] {
  if (Array.isArray(data)) return data as CaixinSeriesSummary[];
  if (data && typeof data === "object") {
    const nested = (data as CaixinSearchPayload).series;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/** API country labels use Chinese names; map common ISO codes so callers do not get empty hits. */
export function normalizeCaixinCountry(country?: string): string | undefined {
  if (!country) return undefined;
  const trimmed = country.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (upper === "CN" || upper === "CHN" || upper === "CHINA") return "中国";
  return trimmed;
}

export async function searchCaixinSeries(query: string, config: CaixinConfig, options: { pageSize?: number; country?: string; tableId?: string } = {}) {
  const result = await caixinRequest<CaixinSearchPayload | CaixinSeriesSummary[]>("/v1/series/search", {
    q: query,
    page_size: options.pageSize ?? 20,
    country: normalizeCaixinCountry(options.country),
    tb_id: options.tableId,
  }, config);
  return { series: unwrapCaixinSearchSeries(result.data), meta: result.meta, raw: result.data };
}

export async function getCaixinSeries(seriesId: string, config: CaixinConfig) {
  const result = await caixinRequest<CaixinSeriesData>(`/v1/series/${encodeURIComponent(seriesId)}`, {}, config);
  return { series: result.data, meta: result.meta };
}

export async function getCaixinObservations(
  seriesId: string,
  config: CaixinConfig,
  options: { start?: string; end?: string; order?: "asc" | "desc"; page?: number; pageSize?: number } = {},
) {
  const result = await caixinRequest<CaixinSeriesData>(`/v1/series/${encodeURIComponent(seriesId)}/observations`, {
    start: options.start,
    end: options.end,
    order: options.order,
    page: options.page,
    page_size: options.pageSize ?? 100,
  }, config);
  return { series: normalizeSeries(result.data, result.meta), meta: result.meta };
}

export function normalizeSeries(data: CaixinSeriesData, meta?: CaixinMeta): NormalizedSeries {
  if (!data || typeof data !== "object" || typeof data.series_id !== "string" || typeof data.name !== "string") {
    throw new CaixinApiError("财新序列缺少 series_id 或 name", { code: "invalid_response" });
  }
  if (!Array.isArray(data.observations)) throw new CaixinApiError("财新序列 observations 不是数组", { code: "invalid_response" });
  const observations = data.observations.map((row, index) => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || (row[1] !== null && typeof row[1] !== "number")) {
      throw new CaixinApiError(`财新序列第 ${index + 1} 条观测字段变化`, { code: "invalid_response" });
    }
    return { date: row[0], value: row[1] };
  });
  return {
    seriesId: data.series_id,
    name: data.name,
    unit: data.unit,
    frequency: data.frequency,
    source: data.source,
    observations,
    description: data.description,
    meta,
  };
}
