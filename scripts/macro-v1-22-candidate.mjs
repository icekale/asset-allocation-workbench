#!/usr/bin/env node
// V1.22-candidate (STAGED): F09/F10 fixed piecewise-linear curves on CNBS leverage. Never touches the active V1.21
// framework, lock, current or history. Usage: node scripts/macro-v1-22-candidate.mjs <build|backtest> [--jev=path]
import fs from "node:fs";
import path from "node:path";
import { rulesHash, assertRulesLocked } from "../lib/macro-rating-draft.mjs";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { interp, cnbsObservations } from "../lib/macro-leverage-curve.mjs";
export { cnbsObservations };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(root, rel);
const read = (rel) => JSON.parse(fs.readFileSync(p(rel), "utf8"));
const write = (rel, v) => { fs.writeFileSync(p(rel) + ".tmp", JSON.stringify(v, null, 2) + "\n"); fs.renameSync(p(rel) + ".tmp", p(rel)); };
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const CAND = "app/data/macro-rating-v1.22-candidate.json", CLOCK = "config/macro-rating-rules-lock-candidates.json";

export const CURVES = {
  F09: { levelAnchors: [[45, 5], [52, 4], [57, 3], [61, 2], [64, 1]], yoyAnchors: [[-4, 1.5], [-2, 2.5], [-0.5, 3.5], [1, 3.5], [3, 2], [5, 1]] },
  F10: { levelAnchors: [[125, 5], [150, 4], [162, 3], [172, 2], [185, 1]], yoyAnchors: [[-8, 2], [-3, 3.5], [0, 3.5], [3, 2.5], [6, 1.5], [10, 1]] },
};

export function buildCandidate(fw) {
  const c = structuredClone(fw);
  c.version = "V1.22-candidate";
  c.status = "staged-candidate（未启用；草稿与发布继续使用V1.21，待用户批准后才可切换）";
  c.indicators = c.indicators.map((r) => {
    if (!CURVES[r.id]) return r;
    const household = r.id === "F09";
    const n = { ...r, unit: "%", mode: "曲线", measurementBasis: "部门债务/过去四季名义GDP",
      scoring: { method: "leverage-curve-composite", levelWeight: 0.5, ...CURVES[r.id],
        description: `${household ? "居民" : "非金融企业"}部门杠杆率：0.5×水平曲线 + 0.5×同比变动(百分点)曲线，固定分段线性，只插值得分不插值数据；缺上年同季原值则不计分（不补中性）。锚点依据见 docs/MACRO_RATING_V1_22.md。` },
      definition: `国家资产负债表研究中心(CNBS/NIFD)季度${household ? "居民" : "非金融企业"}部门杠杆率原值（本季与上年同季），按固定曲线计分；替代V1.21证据矩阵研判。` };
    delete n.evidenceType; delete n.grades;
    return n;
  });
  return c;
}

const cmd = process.argv[2] || "backtest";
if (import.meta.url === `file://${process.argv[1]}`) {
  const fw = read("app/data/macro-rating-v1.21.json"), lock = read("config/macro-rating-rules-lock-v1.21.json");
  assertRulesLocked(fw, lock); // V1.21 must remain frozen and active
  const cand = buildCandidate(fw), hash = rulesHash(cand);
  if (cmd === "build" && fs.existsSync(p(CLOCK)) && read(CLOCK).candidates["V1.22-candidate"]?.status === "promoted-to-V1.22") {
    console.log("V1.22-candidate already promoted to active V1.22 (app/data/macro-rating-v1.22.json); candidate files are archival.");
  } else if (cmd === "build") {
    write(CAND, cand);
    const locks = fs.existsSync(p(CLOCK)) ? read(CLOCK) : { note: "候选（未启用）规则版本的冻结哈希；生效锁仍是 config/macro-rating-rules-lock.json(V1.21)。", candidates: {} };
    const prior = locks.candidates["V1.22-candidate"];
    if (prior && prior.sha256 !== hash) { console.error(`candidate hash changed (${prior.sha256.slice(0, 12)} → ${hash.slice(0, 12)}); refuse to overwrite`); process.exit(1); }
    locks.candidates["V1.22-candidate"] = { sha256: hash, baseRulesVersion: lock.rulesVersion, baseSha256: lock.sha256, status: "staged-not-active", changedIndicators: ["F09", "F10"], frozenAt: prior?.frozenAt ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()) };
    write(CLOCK, locks);
    console.log(JSON.stringify({ candidate: CAND, sha256: hash, activeRules: lock.rulesVersion }));
  } else if (cmd === "backtest") {
    const jev = JSON.parse(fs.readFileSync(arg("jev", p("app/data/macro-rating-judgement-evidence.json")), "utf8"));
    const cur = read("app/data/macro-rating-current.json"), base = evaluateMacroRating(fw, cur);
    const oldPts = Object.fromEntries(["F09", "F10"].map((id) => [id, scoreIndicator(fw.indicators.find((r) => r.id === id), cur.observations[id], cur.asOf, fw.freshness)]));
    const rows = [];
    const series = Object.fromEntries(["F09", "F10"].map((id) => [id, cnbsObservations(jev.cnbs || {}, id)]));
    for (const { quarter } of series.F09) {
      const row = { quarter };
      for (const id of ["F09", "F10"]) {
        const rule = cand.indicators.find((r) => r.id === id), o = series[id].find((x) => x.quarter === quarter).obs;
        const s = scoreIndicator(rule, o, o.releaseDate, cand.freshness);
        row[id] = { level: o.leverageRatio, yoy: o.yearAgoLeverageRatio === null ? null : +(o.leverageRatio - o.yearAgoLeverageRatio).toFixed(2),
          levelScore: +interp(rule.scoring.levelAnchors, o.leverageRatio).toFixed(3), yoyScore: o.yearAgoLeverageRatio === null ? null : +interp(rule.scoring.yoyAnchors, o.leverageRatio - o.yearAgoLeverageRatio).toFixed(3),
          newScore: s === null ? null : +s.toFixed(3), oldScore: quarter === cur.observations[id].period ? oldPts[id] : null };
      }
      const d = ["F09", "F10"].map((id) => row[id].newScore === null || oldPts[id] === null ? null : (row[id].newScore - oldPts[id]) * fw.indicators.find((r) => r.id === id).weight);
      row.totalIfApplied = d.includes(null) ? null : +(base.formalScore + d[0] + d[1]).toFixed(4);
      row.gradeIfApplied = row.totalIfApplied === null ? null : fw.ratingBands.find((b) => row.totalIfApplied >= b.minimum)?.label;
      rows.push(row);
    }
    console.log(JSON.stringify({ activeRules: lock.rulesVersion, candidateSha256: hash, baseTotal: base.formalScore, baseGrade: base.grade, cutoffIII: 2.6, cutoffII: 3.4, rows }, null, 1));
  }
}
