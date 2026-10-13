#!/usr/bin/env node
// Low-rate headless page fetch for public pages that require JS (no captcha solving, no login).
// Usage: node scripts/browser-fetch.mjs <url> [waitMs]   → prints rendered HTML to stdout.
// Playwright lives outside the repo (AAW_PLAYWRIGHT_DIR, default /opt/aaw-browser); absent → exit 3.
import { createRequire } from "node:module";
import path from "node:path";

const dir = process.env.AAW_PLAYWRIGHT_DIR || "/opt/aaw-browser";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(dir, "browsers");
let chromium;
try { ({ chromium } = createRequire(path.join(dir, "package.json"))("playwright")); } catch { console.error("playwright unavailable"); process.exit(3); }
const args = process.argv.slice(2).filter((a) => !a.startsWith("--via="));
const via = process.argv.find((a) => a.startsWith("--via="))?.slice(6);
const [url, wait = "2500"] = args;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", locale: "zh-CN" });
  // Optional: open the list page first, as a reader would, so the site's own JS check sets its cookie.
  if (via) { const r0 = await page.goto(via, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null); await page.waitForTimeout(Number(wait));
    if ([412, 202].includes(r0?.status() ?? 0)) { await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null); await page.waitForTimeout(Number(wait)); } }
  let res = null;
  if (via) {
    const rel = new URL(url).pathname.split("/").slice(-2).join("/");
    const link = page.locator(`a[href$="${rel}"]`).first();
    if (await link.count().catch(() => 0)) {
      const [r] = await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null), link.evaluate((a) => { a.removeAttribute("target"); a.click(); })]);
      res = r;
    }
  }
  if (!res || res.status() >= 400) res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(Number(wait));
  // Some WAFs answer the first hit with a JS check (HTTP 412) and set a cookie; a normal browser reloads once.
  if ([412, 202].includes(res?.status() ?? 0)) { res = (await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null)) ?? res; await page.waitForTimeout(Number(wait)); }
  const html = await page.content();
  if (/验证码|captcha|滑动验证/i.test(html) && html.length < 20000) { console.error("challenge page (not bypassed)"); process.exit(4); }
  process.stdout.write(`<!-- status:${res?.status() ?? 0} final:${page.url()} -->\n` + html);
} finally { await browser.close(); }
