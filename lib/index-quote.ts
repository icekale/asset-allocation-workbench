/**
 * 上证指数收盘行情：腾讯财经 + 新浪财经 + 东方财富三源抓取、解析与交叉核验。
 *
 * 该模块同时被 Cloudflare Worker 定时任务和本地采集脚本使用，因此保持自包含：
 * 不依赖 Workers 绑定、不读取环境变量、不做文件读写。
 *
 * 三个源的风控与可达性互不相同（新浪要求 Referer，东方财富对高频请求限流，
 * 腾讯对境外访问最稳定），任一源成功即可更新；只要有两个源成功且点位一致，
 * 本次快照即标记为已交叉核验。
 */

export type IndexQuote = {
  code: string;
  name: string;
  value: number;
  changePct: number;
  observedAt: string;
  sourceId: string;
  sourceUrl: string;
  publisher: string;
  crossChecked: boolean;
  crossCheck?: { publisher: string; value: number; sourceUrl: string };
};

export const SHANGHAI_INDEX_CODE = "000001.SH";
export const SHANGHAI_INDEX_NAME = "上证指数";
export const TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q=sh000001";
export const SINA_QUOTE_URL = "https://hq.sinajs.cn/list=sh000001";
export const EASTMONEY_QUOTE_URL =
  "https://push2.eastmoney.com/api/qt/stock/get?secid=1.000001&fields=f43,f57,f58,f59,f86,f169,f170&ut=fa5fd1943c7b386f172d6893dbfba10b";

/** 任意两个行情源允许的最大相对偏差；超过即拒绝写入，宁可保留上一期数据。 */
export const MAX_SOURCE_DEVIATION = 0.002;

const DEFAULT_TIMEOUT_MS = 12_000;

function compactToBeijingIso(compact: string) {
  if (!/^\d{14}$/.test(compact)) throw new Error("行情时间戳应为 YYYYMMDDHHmmss");
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}+08:00`;
}

function partsToBeijingIso(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new Error("行情时间格式异常");
  return `${date}T${time}+08:00`;
}

function epochSecondsToBeijingIso(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("行情时间戳缺失");
  // 先加 8 小时后按 UTC 打印，等价于北京时间的本地表示。
  return new Date(seconds * 1_000 + 8 * 3_600_000).toISOString().replace("Z", "+08:00");
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** 解析腾讯财经 `qt.gtimg.cn` 响应。响应为 GB18030，这里只用其中的 ASCII 字段。 */
export function parseTencentQuote(raw: string): IndexQuote {
  const match = raw.match(/="([^"]+)"/);
  if (!match) throw new Error("腾讯行情返回格式无法识别");
  const fields = match[1].split("~");
  if (fields.length < 33) throw new Error("腾讯行情字段不完整");
  const value = Number(fields[3]);
  const changePct = Number(fields[32]);
  const observedAt = compactToBeijingIso(fields[30]);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(changePct)) throw new Error("腾讯行情数值字段不完整");
  return {
    code: SHANGHAI_INDEX_CODE,
    name: SHANGHAI_INDEX_NAME,
    value,
    changePct,
    observedAt,
    sourceId: `tencent-sh000001-${observedAt.slice(0, 10).replaceAll("-", "")}`,
    sourceUrl: TENCENT_QUOTE_URL,
    publisher: "腾讯财经",
    crossChecked: false,
  };
}

/**
 * 解析新浪财经 `hq.sinajs.cn` 响应。响应为 GB18030 且需要 Referer，
 * 涨跌幅由昨收价现算，字段为：名称,今开,昨收,现价,最高,最低,…,日期,时间。
 */
export function parseSinaQuote(raw: string): IndexQuote {
  const match = raw.match(/="([^"]*)"/);
  if (!match) throw new Error("新浪行情返回格式无法识别");
  const fields = match[1].split(",");
  if (fields.length < 32) throw new Error("新浪行情字段不完整");
  const previous = Number(fields[2]);
  const value = Number(fields[3]);
  const observedAt = partsToBeijingIso(fields[30], fields[31]);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(previous) || previous <= 0) {
    throw new Error("新浪行情数值字段不完整");
  }
  return {
    code: SHANGHAI_INDEX_CODE,
    name: SHANGHAI_INDEX_NAME,
    value,
    changePct: round2(((value - previous) / previous) * 100),
    observedAt,
    sourceId: `sina-sh000001-${observedAt.slice(0, 10).replaceAll("-", "")}`,
    sourceUrl: SINA_QUOTE_URL,
    publisher: "新浪财经",
    crossChecked: false,
  };
}

/** 解析东方财富 `push2.eastmoney.com` 响应（UTF-8 JSON）。 */
export function parseEastmoneyQuote(raw: string | { data?: Record<string, unknown> }): IndexQuote {
  const body = typeof raw === "string" ? (JSON.parse(raw) as { data?: Record<string, unknown> }) : raw;
  const data = body?.data;
  if (!data || typeof data.f43 !== "number") throw new Error("东方财富行情返回缺少点位字段");
  const scale = 10 ** Number(data.f59 ?? 2);
  const value = data.f43 / scale;
  const changePct = Number(data.f170) / 100;
  const observedAt = epochSecondsToBeijingIso(Number(data.f86));
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(changePct)) throw new Error("东方财富行情数值字段不完整");
  return {
    code: SHANGHAI_INDEX_CODE,
    name: SHANGHAI_INDEX_NAME,
    value,
    changePct,
    observedAt,
    sourceId: `eastmoney-1.000001-${observedAt.slice(0, 10).replaceAll("-", "")}`,
    sourceUrl: EASTMONEY_QUOTE_URL,
    publisher: "东方财富",
    crossChecked: false,
  };
}

type QuoteSource = {
  url: string;
  headers: Record<string, string>;
  parse: (raw: string) => IndexQuote;
};

/** 顺序即优先级：腾讯最稳，新浪次之，东方财富在限流时最先失败。 */
const SOURCES: QuoteSource[] = [
  { url: TENCENT_QUOTE_URL, headers: {}, parse: parseTencentQuote },
  { url: SINA_QUOTE_URL, headers: { referer: "https://finance.sina.com.cn" }, parse: parseSinaQuote },
  { url: EASTMONEY_QUOTE_URL, headers: {}, parse: parseEastmoneyQuote },
];

async function fetchText(source: QuoteSource, fetchImpl: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(source.url, {
      headers: {
        // 响应为 GB18030：所用字段都是 ASCII，因此按 UTF-8 解码不影响点位解析。
        "user-agent": "asset-allocation-workbench/1.0",
        accept: "text/plain, application/json, */*",
        ...source.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export type IndexQuoteOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

/**
 * 抓取指数收盘行情：各源独立解析，单源失败不影响其它源；任意两个成功源的点位
 * 偏差超过 MAX_SOURCE_DEVIATION 即抛错，由调用方保留上一期数据。
 */
export async function fetchIndexQuote(options: IndexQuoteOptions = {}): Promise<IndexQuote> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const settled = await Promise.allSettled(
    SOURCES.map((source) => fetchText(source, fetchImpl, timeoutMs).then(source.parse)),
  );
  const quotes = settled
    .filter((result): result is PromiseFulfilledResult<IndexQuote> => result.status === "fulfilled")
    .map((result) => result.value);
  if (!quotes.length) {
    const reasons = settled.map((result) => {
      if (result.status === "fulfilled") return "";
      const reason = result.reason as { message?: string } | undefined;
      return reason?.message ?? String(result.reason);
    }).filter(Boolean);
    throw new Error(`行情源全部失败：${reasons.join("；")}`);
  }
  const [primary, ...others] = quotes;
  for (const other of others) {
    const deviation = Math.abs(primary.value - other.value) / Math.max(primary.value, other.value);
    if (!Number.isFinite(deviation) || deviation > MAX_SOURCE_DEVIATION) {
      throw new Error(`行情源不一致：${primary.publisher} ${primary.value} / ${other.publisher} ${other.value}`);
    }
  }
  if (!others.length) return primary;
  const witness = others.find((other) => other.value === primary.value) ?? others[0];
  return {
    ...primary,
    crossChecked: true,
    crossCheck: { publisher: witness.publisher, value: witness.value, sourceUrl: witness.sourceUrl },
  };
}
