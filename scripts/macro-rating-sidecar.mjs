#!/usr/bin/env node
// Loopback-only helper for the portal (workerd cannot touch app/data). Bearer token required.
// GET /draft · POST /publish · POST /discard. Publishing runs AAW_REBUILD_CMD (detached) afterwards.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";

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
  if (req.method === "GET" && req.url === "/draft") {
    const file = path.join(root, "app/data/macro-rating-draft.json");
    if (!fs.existsSync(file)) return send(404, { draft: null });
    return send(200, { draft: JSON.parse(fs.readFileSync(file, "utf8")) });
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
