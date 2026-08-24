import { decoder } from "tetris-fumen";
import { boardFromFumenPage } from "./board.mjs";
import { encodePages } from "./fumen.mjs";
import { makeOrderCountQuality, recordOrderCount } from "./human-ranking.mjs";
import { minimumCover } from "./min-cover.mjs";
import { orderMinimalKeysByCoverage } from "./minimal-order.mjs";
import { expandPatternCases } from "./pattern.mjs";
import { enumerateCasePath } from "./path-engine.mjs";
import { compileSaveExpression, savedMask } from "./saves.mjs";

export function calculateSaveMinimals({
  sourceFumen,
  analysisPattern,
  wantedSave,
  solver,
  useHold = true,
  height = 4,
}) {
  const board = boardFromFumenPage(decoder.decode(sourceFumen)[0], height);
  const cases = expandPatternCases(analysisPattern);
  const queues = cases.map((entry) => entry.queue);
  const coverage = new Map();
  const qualityIndex = new Map();
  const table = compileSaveExpression(wantedSave);

  const byKey = new Map();
  const path = enumerateCasePath({ board, cases, solver, useHold });
  if (path.mode === "pattern") {
    for (const solution of path.rows) {
      byKey.set(solution.key, solution);
      for (const hit of solution.coverage) {
        const entry = cases[hit.caseIndex];
        if (!entry) throw new Error(`invalid pattern coverage case ${hit.caseIndex}`);
        if (!entry.lastBag) {
          throw new Error(`save analysis branch ${entry.branchIndex + 1} does not end in a bag token`);
        }
        if (!table[savedMask(entry.queue, solution, entry.lastBag)]) continue;
        let keys = coverage.get(entry.caseId);
        if (!keys) {
          keys = new Set();
          coverage.set(entry.caseId, keys);
        }
        keys.add(solution.key);
        recordOrderCount(qualityIndex, entry.caseId, {
          key: solution.key,
          orderCount: Number(hit.orderCount ?? 0),
        });
      }
    }
  } else {
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const entry = cases[caseIndex];
      const solutions = path.rows[caseIndex];
      if (!entry.lastBag) {
        throw new Error(`save analysis branch ${entry.branchIndex + 1} does not end in a bag token`);
      }
      for (const solution of solutions) {
        byKey.set(solution.key, solution);
        if (!table[savedMask(entry.queue, solution, entry.lastBag)]) continue;
        let keys = coverage.get(entry.caseId);
        if (!keys) {
          keys = new Set();
          coverage.set(entry.caseId, keys);
        }
        keys.add(solution.key);
        recordOrderCount(qualityIndex, entry.caseId, solution);
      }
    }
  }

  const saveSuccess = coverage.size;
  const minimal = minimumCover(coverage, {
    qualityFor: makeOrderCountQuality(qualityIndex),
    solver,
  });
  if (!Number.isFinite(minimal.count) || !minimal.keys.length) throw new Error("no minimal");
  const ordered = orderMinimalKeysByCoverage(minimal.keys, coverage);
  const keys = ordered.keys;
  const coverageCounts = ordered.coverageCounts;
  const solutions = keys.map((key) => byKey.get(key));
  return {
    board,
    height,
    cases,
    queues,
    coverage,
    saveSuccess,
    minimalCount: minimal.count,
    keys,
    solutions,
    coverageCounts,
    humanQualityVector: minimal.qualityVector ?? [],
  };
}

export function encodeSaveMinimalFumen(calculation) {
  const comments = calculation.coverageCounts.map((count) =>
    `${(count / calculation.queues.length * 100).toFixed(2)}% (${count}/${calculation.queues.length})`);
  return encodePages(
    calculation.board,
    calculation.solutions,
    comments,
    calculation.height ?? 4,
  );
}
