import { expandPattern, expandPatternCases, queuesForFinder } from "./pattern.mjs";
import { compileSaveExpression, savedMask } from "./saves.mjs";
import { calculateSaveMinimals, encodeSaveMinimalFumen } from "./minimals-feature.mjs";
import { fifthMinimalsPerSaves, encodeFifthCombined } from "./fifth.mjs";
import {
  calculatePerSaveMinimals,
  encodePerSaveMinimals,
  resolvePerSaveTargetLines,
} from "./per-save-minimals.mjs";
import { decodeAndValidate } from "./pc-input.mjs";
import { solveQueuesExistence, visitCaseSolutions } from "./path-engine.mjs";

export {
  BoardExceedsClearHeightError,
  UnsupportedBoardHeightError,
  UnsupportedClearHeightError,
  decodeAndValidate,
} from "./pc-input.mjs";
export { solveAllPc, solveOnePc, solvePerSaveAllPc, solveSingleQueueFeature } from "./pc-solve.mjs";

export function calculateChance({ sourceFumen, pattern, clear = 4, solver, useHold = true }) {
  const { board } = decodeAndValidate(sourceFumen, clear);
  const queues = expandPattern(pattern);
  const solved = solveQueuesExistence({ board, queues, solver, useHold });
  let success = 0;
  const failedQueues = [];
  for (let index = 0; index < queues.length; index += 1) {
    if (solved[index]) success += 1;
    else failedQueues.push(queues[index]);
  }
  return {
    total: queues.length,
    success,
    failed: failedQueues.length,
    failedQueues,
    percent: 100 * success / queues.length,
  };
}

export function calculateSaves({
  sourceFumen,
  pattern,
  wantedSave,
  clear = 4,
  solver,
  useHold = true,
}) {
  const { board } = decodeAndValidate(sourceFumen, clear);
  const pathPattern = queuesForFinder(pattern);
  const cases = expandPatternCases(pattern);
  for (const entry of cases) {
    if (!entry.lastBag) {
      throw new Error(`save analysis branch ${entry.branchIndex + 1} does not end in a bag token`);
    }
  }

  const table = compileSaveExpression(wantedSave);
  const matched = new Uint8Array(cases.length);
  visitCaseSolutions({
    board,
    cases,
    solver,
    useHold,
    collectByKey: false,
    trackCaseSolutions: false,
    visit: (entry, caseIndex, solution) => {
      if (table[savedMask(entry.queue, solution, entry.lastBag)]) matched[caseIndex] = 1;
    },
  });

  let success = 0;
  const failedQueues = [];
  for (let index = 0; index < cases.length; index += 1) {
    if (matched[index]) success += 1;
    else failedQueues.push(cases[index].queue);
  }
  return {
    pathPattern,
    analysisPattern: pattern,
    total: cases.length,
    success,
    failed: failedQueues.length,
    failedQueues,
    percent: 100 * success / cases.length,
  };
}

export function calculateMinimalsFeature({
  sourceFumen,
  pattern,
  wantedSave,
  clear = 4,
  solver,
  useHold = true,
}) {
  decodeAndValidate(sourceFumen, clear);
  const calculation = calculateSaveMinimals({
    sourceFumen,
    analysisPattern: pattern,
    wantedSave,
    solver,
    useHold,
    height: clear,
  });
  return {
    pathPattern: queuesForFinder(pattern),
    analysisPattern: pattern,
    total: calculation.queues.length,
    saveSuccess: calculation.saveSuccess,
    minimalCount: calculation.minimalCount,
    coverageCounts: calculation.coverageCounts,
    fumen: encodeSaveMinimalFumen(calculation),
  };
}

export function calculateFifthFeature({
  sourceFumen,
  pattern,
  title = "",
  clear = 4,
  solver,
  useHold = true,
}) {
  decodeAndValidate(sourceFumen, clear);
  if (clear !== 4) throw new Error("5th is clear=4 only");
  const calculation = fifthMinimalsPerSaves({
    sourceFumen,
    analysisPattern: pattern,
    solver,
    useHold,
  });
  const encoded = encodeFifthCombined({ sourceFumen, title, calculation });
  return {
    total: calculation.queues.length,
    bestsave: calculation.bestsave,
    usages: calculation.usages,
    pageCounts: encoded.pageCounts,
    fumen: encoded.fumen,
  };
}

export function calculatePerSaveMinimalsFeature({
  sourceFumen,
  pattern,
  title = "",
  targetLines,
  clear,
  solver,
  useHold = true,
  candidateLimit = 16,
}) {
  const resolved = resolvePerSaveTargetLines({ targetLines, clear });
  decodeAndValidate(sourceFumen, resolved);
  const calculation = calculatePerSaveMinimals({
    sourceFumen,
    pattern,
    solver,
    useHold,
    targetLines: resolved,
    candidateLimit,
  });
  const encoded = encodePerSaveMinimals({ sourceFumen, title, calculation });
  const results = {};
  for (const [piece, result] of Object.entries(calculation.results)) {
    results[piece] = {
      piece: result.piece,
      success: result.success,
      pcSuccess: result.pcSuccess,
      total: result.total,
      saveRate: result.saveRate,
      guaranteed: result.guaranteed,
      minimalCount: result.minimalCount,
      coverageCounts: result.coverageCounts,
      playableOrderCount: result.playableOrderCount,
      label: result.label,
    };
  }
  return {
    targetLines: calculation.targetLines,
    occupiedCells: calculation.occupiedCells,
    remainingCells: calculation.remainingCells,
    piecesNeeded: calculation.piecesNeeded,
    expectedQueueLength: calculation.expectedQueueLength,
    total: calculation.total,
    pcSuccess: calculation.pcSuccess,
    pcRate: calculation.pcRate,
    results,
    pageCounts: encoded.pageCounts,
    fumen: encoded.fumen,
  };
}
