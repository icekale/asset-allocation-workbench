/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { refreshIndexFromSources } from "../lib/auto-refresh";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  /**
   * 收盘后自动抓取指数行情并写入 D1（见 wrangler.deploy.jsonc 的 triggers.crons）。
   * 抓取或校验失败时抛错，Cloudflare 会记录失败并按 cron 规则重试；线上保留上一期数据。
   */
  async scheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const result = await refreshIndexFromSources();
      console.log(JSON.stringify({ event: "index-refresh", cron: controller.cron, ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "index-refresh-failed",
        cron: controller.cron,
        message: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
};

export default worker;
