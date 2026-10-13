import { readFile } from "node:fs/promises";
import path from "node:path";

export type CaixinSeriesMapping = {
  id: string;
  name: string;
  target: string;
  targetKey: string;
  frequency?: string;
  unit?: string;
  workbenchUnit?: string;
  expectedSource?: string;
  enabled: boolean;
  scale?: number;
  frequencyNote?: string;
  notes?: string;
};

export type CaixinSeriesConfig = {
  version?: number;
  policy?: string;
  series: CaixinSeriesMapping[];
};

export const CAIXIN_SERIES_EXAMPLE_PATH = "config/caixin-series.example.json";
export const CAIXIN_SERIES_LOCAL_PATH = "config/caixin-series.json";

/** Resolve live whitelist first, then fall back to the committed example template. */
export async function resolveCaixinSeriesConfigPath(root = process.cwd()): Promise<string> {
  const candidates = [
    process.env.CAIXIN_SERIES_CONFIG,
    path.join(root, CAIXIN_SERIES_LOCAL_PATH),
    path.join(root, CAIXIN_SERIES_EXAMPLE_PATH),
  ].filter(Boolean) as string[];
  const { access } = await import("node:fs/promises");
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error(`财新序列白名单不存在：尝试了 ${candidates.join(", ")}`);
}

export function parseCaixinSeriesConfig(raw: unknown): CaixinSeriesConfig {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as CaixinSeriesConfig).series)) {
    throw new Error("财新序列白名单必须是含 series 数组的对象");
  }
  const series = (raw as CaixinSeriesConfig).series.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`series[${index}] 无效`);
    if (typeof item.id !== "string" || !item.id.trim()) throw new Error(`series[${index}] 缺少 id`);
    if (typeof item.targetKey !== "string" || !item.targetKey.trim()) {
      throw new Error(`series[${index}] 缺少 targetKey`);
    }
    if (typeof item.enabled !== "boolean") throw new Error(`series[${index}] 缺少 enabled`);
    return {
      ...item,
      id: item.id.trim(),
      name: typeof item.name === "string" ? item.name : item.id,
      target: typeof item.target === "string" ? item.target : "macroIndicators",
      targetKey: item.targetKey.trim(),
      scale: typeof item.scale === "number" && Number.isFinite(item.scale) ? item.scale : 1,
      enabled: item.enabled,
    } satisfies CaixinSeriesMapping;
  });
  return {
    version: typeof (raw as CaixinSeriesConfig).version === "number" ? (raw as CaixinSeriesConfig).version : 1,
    policy: typeof (raw as CaixinSeriesConfig).policy === "string" ? (raw as CaixinSeriesConfig).policy : undefined,
    series,
  };
}

export async function loadCaixinSeriesConfig(root = process.cwd()): Promise<{
  path: string;
  config: CaixinSeriesConfig;
}> {
  const configPath = await resolveCaixinSeriesConfigPath(root);
  const config = parseCaixinSeriesConfig(JSON.parse(await readFile(configPath, "utf8")));
  return { path: configPath, config };
}

export function enabledCaixinMappings(config: CaixinSeriesConfig): CaixinSeriesMapping[] {
  return config.series.filter((item) => item.enabled);
}

/** Apply configured unit scale (e.g. 百万美元 → 亿美元 = ×0.01). */
export function applyMappingScale(value: number | null | undefined, scale = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number((value * scale).toFixed(6));
}
