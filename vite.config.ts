import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  const runtimeEnv = loadEnv(mode, process.cwd(), "");
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: true,
      allowedHosts: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          ...localBindingConfig,
          // Dev: inject from loadEnv (.env.local / .env). Production build leaves vars empty;
          // DMIT serves dist via `wrangler dev` which loads `.dev.vars` (never commit).
          vars:
            mode === "development"
              ? {
                  PORTAL_PASSWORD: runtimeEnv.PORTAL_PASSWORD ?? "",
                  SESSION_SECRET: runtimeEnv.SESSION_SECRET ?? "",
                  UPDATE_TOKEN: runtimeEnv.UPDATE_TOKEN ?? "",
                  CAIXIN_API_BASE_URL: runtimeEnv.CAIXIN_API_BASE_URL ?? "",
                  CAIXIN_API_KEY: runtimeEnv.CAIXIN_API_KEY ?? "",
                  CAIXIN_API_USER_AGENT: runtimeEnv.CAIXIN_API_USER_AGENT ?? "",
                  WIND_API_KEY: runtimeEnv.WIND_API_KEY ?? "",
                  WIND_INDEX_API_BASE_URL: runtimeEnv.WIND_INDEX_API_BASE_URL ?? "",
                }
              : {},
        },
      }),
    ],
  };
});
