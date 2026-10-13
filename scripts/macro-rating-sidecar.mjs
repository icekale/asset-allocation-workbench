#!/usr/bin/env node
// Loopback-only helper for the portal (workerd cannot touch app/data). Bearer token required.
// GET /draft · POST /publish · POST /discard · POST /decide (confirm/edit/keep a judgement suggestion). Publishing runs AAW_REBUILD_CMD (detached) afterwards.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { JUDGEMENT_IDS } from "../lib/macro-rating-suggest.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const token = process.env.AAW_RATING_TOKEN || "";
const port = Number(process.env.AAW_RATING_PORT || 8791);
if (token.length < 16) { console.error("AAW_RATING_TOKEN missing/too short"); process.exit(1); }
const run = (cmd) => new Promise((resolve) => execFile(process.execPath, [path.join(root, "scripts/macro-rating-draft.mjs"), cmd], { cwd: root },
  (error, stdout, stderr) => resolve({ ok: !error, stdout: stdout.trim(), stderr: stderr.trim() })));
let busy = false;
http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
  
  if (req.method === "GET" && req.url === "/attribution") {
    const history = JSON.parse(fs.readFileSync(path.join(root, "app/data/macro-rating-history.json"), "utf8"));
    const { attributeHistory } = await import("../lib/macro-rating-attribution.mjs");
    return send(200, { attributions: attributeHistory(history) });
  }
  if (req.method === "POST" && req.url === "/simulate") {
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(413, { error: "请求过大" }); }
    let body; try { body = JSON.parse(raw || "{}"); } catch { return send(400, { error: "格式错误" }); }
    const framework = JSON.parse(fs.readFileSync(path.join(root, fs.existsSync(path.join(root, "app/data/macro-rating-v1.22.json")) ? "app/data/macro-rating-v1.22.json" : "app/data/macro-rating-v1.json"), "utf8"));
    const current = JSON.parse(fs.readFileSync(path.join(root, "app/data/macro-rating-current.json"), "utf8"));
    const { simulateRating } = await import("../lib/macro-rating-simulate.mjs");
    return send(200, simulateRating({ framework, current, overrides: body.overrides || {} }));
  }
  if (req.method === "GET" && req.url === "/health-sources") {
    const f = path.join(root, "output/source-health.json");
    if (!fs.existsSync(f)) return send(404, { error: "尚未生成 source-health.json，请运行 node scripts/source-health.mjs" });
    return send(200, JSON.parse(fs.readFileSync(f, "utf8")));
  }
  if (req.method === "GET" && req.url === "/alerts") {
    const f = path.join(root, "output/alerts.json");
    if (!fs.existsSync(f)) return send(404, { error: "尚未生成 alerts.json" });
    return send(200, JSON.parse(fs.readFileSync(f, "utf8")));
  }

  if (req.method === "GET" && req.url === "/draft") {
    const file = path.join(root, "app/data/macro-rating-draft.json");
    if (!fs.existsSync(file)) return send(404, { draft: null });
    return send(200, { draft: JSON.parse(fs.readFileSync(file, "utf8")) });
  }
  if (req.method === "POST" && req.url === "/decide") {
    if (busy) return send(409, { error: "正在处理，请稍候" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 8192) return send(413, { error: "请求过大" }); }
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { error: "格式错误" }); }
    const { id, action, key } = body || {};
    const value = body?.value === undefined || body?.value === null || body?.value === "" ? null : Number(body.value);
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
    if (!JUDGEMENT_IDS.includes(id) || !["confirm", "edit", "keep"].includes(action) || typeof key !== "string") return send(400, { error: "参数无效" });
    if (action === "edit" && (!Number.isFinite(value) || !note)) return send(400, { error: "改档须填写分值与理由" });
    const draftFile = path.join(root, "app/data/macro-rating-draft.json");
    const draft = fs.existsSync(draftFile) ? JSON.parse(fs.readFileSync(draftFile, "utf8")) : null;
    const row = draft?.rows?.find((r) => r.id === id);
    if (!row?.suggestion || row.suggestion.key !== key) return send(409, { error: "建议已更新，请刷新页面后再操作" });
    busy = true;
    try {
      const file = path.join(root, "app/data/macro-rating-confirmations.json");
      const log = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { kind: "macro-rating-confirmations", note: "追加记录；草稿只采用与当前建议key一致的最新一条。", entries: [] };
      log.entries.push({ id, action, key, value: action === "edit" ? value : null, note: note || null, period: row.suggestion.period,
        suggestedValue: row.suggestion.suggestedValue, at: new Date().toISOString(), by: "portal" });
      fs.writeFileSync(file + ".tmp", JSON.stringify(log, null, 1) + "\n");
      fs.renameSync(file + ".tmp", file);
      const out = await run("build");
      if (!out.ok) return send(500, { error: "已记录，但草稿重建失败：" + (out.stderr.slice(-300) || "") });
      const fresh = JSON.parse(fs.readFileSync(draftFile, "utf8")).rows.find((r) => r.id === id);
      return send(200, { ok: true, source: fresh.source, decision: fresh.decision });
    } finally { busy = false; }
  }
  if (req.method === "POST" && ["/publish", "/discard"].includes(req.url)) {
    if (busy) return send(409, { error: "正在处理，请稍候" });
    busy = true;
    try {
      const out = await run(req.url.slice(1));
      if (!out.ok) return send(400, { error: out.stderr.split("\n").find((l) => l.startsWith("Error")) || out.stderr.slice(-400) || "失败" });
      if (req.url === "/publish" && process.env.AAW_REBUILD_CMD) {
        spawn("/bin/bash", ["-c", process.env.AAW_REBUILD_CMD], { detached: true, stdio: "ignore" }).unref();
      }
      return send(200, { ok: true, result: out.stdout });
    } finally { busy = false; }
  }
  send(404, { error: "not found" });
}).listen(port, "127.0.0.1", () => console.log(`macro-rating sidecar on 127.0.0.1:${port}`));
