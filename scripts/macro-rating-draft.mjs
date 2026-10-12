#!/usr/bin/env node
// Usage: node scripts/macro-rating-draft.mjs <verify|build|publish|discard|lock> [--as-of=YYYY-MM-DD]
// build writes app/data/macro-rating-draft.json only; publish appends history + updates current (manual action).
import fs from "node:fs";
import path from "node:path";
import { loadDraftData, buildDraft, publishDraft, reproduceSnapshot, rulesHash } from "../lib/macro-rating-draft.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(root, rel);
const read = (rel) => JSON.parse(fs.readFileSync(p(rel), "utf8"));
const writeAtomic = (rel, value) => { const tmp = p(rel) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n"); fs.renameSync(tmp, p(rel)); };
const F = { framework: "app/data/macro-rating-v1.json", current: "app/data/macro-rating-current.json", history: "app/data/macro-rating-history.json",
  draft: "app/data/macro-rating-draft.json", lock: "config/macro-rating-rules-lock.json", flag: "output/macro-rating-draft-notable.json" };
const cmd = process.argv[2] || "build";
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

if (cmd === "lock") {
  // One-time: freeze the current rule set. Refuses to overwrite an existing lock.
  if (fs.existsSync(p(F.lock))) { console.error("lock already exists; rules are frozen"); process.exit(1); }
  const fw = read(F.framework);
  writeAtomic(F.lock, { rulesVersion: fw.version, sha256: rulesHash(fw), frozenAt: today(),
    note: "评分规则冻结哈希（指标集、曲线、锚点、权重、四类权重、档位、时效、覆盖率）。草稿/发布流程只改观察值。" });
  console.log("locked", fw.version);
} else if (cmd === "verify") {
  const fw = read(F.framework), cur = read(F.current), hist = read(F.history);
  const snap = hist.snapshots.find((s) => s.version === cur.version && s.asOf === cur.asOf);
  const res = reproduceSnapshot(fw, cur, snap);
  console.log(JSON.stringify({ snapshot: snap.id, ...res }, null, 2));
  process.exit(res.ok ? 0 : 1);
} else if (cmd === "build") {
  const loaded = loadDraftData(read);
  const data = { ...loaded.data, ev: loaded.ev };
  const draft = buildDraft({ framework: read(F.framework), current: read(F.current), lock: read(F.lock), data, asOf: arg("as-of") || today() });
  writeAtomic(F.draft, draft);
  fs.mkdirSync(p("output"), { recursive: true });
  const summary = { generatedAt: draft.generatedAt, asOf: draft.asOf, before: draft.before.score, after: draft.after.score,
    beforeGrade: draft.before.grade, afterGrade: draft.after.grade, totalDelta: draft.totalDelta, tierChanged: draft.tierChanged, counts: draft.counts };
  if (draft.notable) writeAtomic(F.flag, { ...summary, reason: draft.tierChanged ? "档位变化或无法出正式总分" : `|Δ总分|>${0.05}` });
  else if (fs.existsSync(p(F.flag))) fs.unlinkSync(p(F.flag));
  console.log(`[macro-rating-draft] ${draft.notable ? "NOTABLE " : ""}${JSON.stringify(summary)}`);
} else if (cmd === "publish") {
  if (!fs.existsSync(p(F.draft))) { console.error("没有待发布草稿"); process.exit(1); }
  const out = publishDraft({ framework: read(F.framework), current: read(F.current), history: read(F.history), lock: read(F.lock), draft: read(F.draft) });
  writeAtomic(F.history, out.history); writeAtomic(F.current, out.current); writeAtomic(F.framework, out.framework);
  fs.unlinkSync(p(F.draft)); if (fs.existsSync(p(F.flag))) fs.unlinkSync(p(F.flag));
  console.log(JSON.stringify(out.record));
} else if (cmd === "discard") {
  if (fs.existsSync(p(F.draft))) fs.unlinkSync(p(F.draft));
  if (fs.existsSync(p(F.flag))) fs.unlinkSync(p(F.flag));
  console.log("discarded");
} else { console.error("unknown command"); process.exit(2); }
