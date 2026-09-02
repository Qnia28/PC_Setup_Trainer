import { expandPattern, expandPatternCases, queuesForFinder } from "./pattern.mjs";
import { compareExactSaveStrings, compileSaveOutcomeExpression, parseSaveExpressionSpec, prepareSaveCase, prepareSolutionPieceCounts, saveCodeToString, savedCodePrepared } from "./saves.mjs";
import { calculateLegacySaveMinimals, calculateSaveMinimals, encodeSaveMinimalFumen } from "./minimals-feature.mjs";
import { fifthMinimalsPerSaves, fifthMinimalsPerSavesAsync, encodeFifthCombined } from "./fifth.mjs";
import {
  calculatePerSaveMinimals,
  calculatePerSaveMinimalsAsync,
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

function splitWantedSaveExpressions(value) {
  const source = String(value ?? "");
  const parts = [];
  let start = 0;
  let inRegex = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "/") {
      inRegex = !inRegex;
      continue;
    }

    if (char === "," && !inRegex) {
      const part = source.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

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

  const requested = Array.isArray(wantedSave)
    ? wantedSave.map((value) => String(value).trim()).filter(Boolean)
    : splitWantedSaveExpressions(wantedSave);
  const allMode = requested.length === 0 || (requested.length === 1 && requested[0].toUpperCase() === "ALL");
  if (requested.length > 1 && requested.some((value) => value.toUpperCase() === "ALL")) {
    throw new SyntaxError("Wanted Saves: ALL cannot be combined with save expressions");
  }
  const saveSpecs = allMode ? [] : requested.map(parseSaveExpressionSpec);
  const evaluators = saveSpecs.map((spec) => compileSaveOutcomeExpression(spec.expression));
  const outcomeCodes = Array.from({ length: cases.length }, () => new Set());
  const saveCases = cases.map((entry) => prepareSaveCase(entry.queue, entry.lastBag));
  const usageByKey = new Map();
  visitCaseSolutions({
    board,
    cases,
    solver,
    useHold,
    collectByKey: false,
    trackCaseSolutions: false,
    visit: (_entry, caseIndex, solution) => {
      let usage = usageByKey.get(solution.key);
      if (!usage) {
        usage = prepareSolutionPieceCounts(solution);
        usageByKey.set(solution.key, usage);
      }
      outcomeCodes[caseIndex].add(savedCodePrepared(saveCases[caseIndex], usage));
    },
  });

  const total = cases.length;
  const baseResult = { pathPattern, analysisPattern: pattern, total };

  if (allMode) {
    let success = 0;
    const failedQueues = [];
    const counts = new Map();
    for (let index = 0; index < cases.length; index += 1) {
      const codes = outcomeCodes[index];
      if (codes.size) success += 1;
      else failedQueues.push(cases[index].queue);
      for (const code of codes) {
        const save = saveCodeToString(code);
        counts.set(save, (counts.get(save) ?? 0) + 1);
      }
    }
    return {
      ...baseResult,
      success,
      failed: failedQueues.length,
      failedQueues,
      percent: total ? 100 * success / total : 0,
      saveResults: [...counts]
        .sort(([a], [b]) => compareExactSaveStrings(a, b))
        .map(([save, count]) => ({
          save,
          success: count,
          total,
          percent: total ? 100 * count / total : 0,
        })),
    };
  }

  const stats = saveSpecs.map((spec) => ({
    saveExpression: spec.expression,
    saveAlias: spec.alias,
    saveLabel: spec.label,
    success: 0,
    failedQueues: [],
  }));
  for (let index = 0; index < cases.length; index += 1) {
    const allSaves = new Set([...outcomeCodes[index]].map(saveCodeToString));
    for (let expressionIndex = 0; expressionIndex < evaluators.length; expressionIndex += 1) {
      if (evaluators[expressionIndex](allSaves).size > 0) stats[expressionIndex].success += 1;
      else stats[expressionIndex].failedQueues.push(cases[index].queue);
    }
  }

  const wantedSaveResults = stats.map((entry) => ({
    ...entry,
    total,
    failed: entry.failedQueues.length,
    percent: total ? 100 * entry.success / total : 0,
  }));

  // Preserve the pre-2.3 result shape for the overwhelmingly common single
  // expression call.  Multiple expressions share one enumeration and return
  // their independent percentages under wantedSaveResults.
  if (wantedSaveResults.length === 1) return { ...baseResult, ...wantedSaveResults[0] };
  return {
    ...baseResult,
    wantedSaveResults,
  };
}

export function calculateLegacyMinimalsFeature({
  sourceFumen,
  pattern,
  wantedSave,
  clear = 4,
  solver,
  useHold = true,
}) {
  decodeAndValidate(sourceFumen, clear);
  const calculation = calculateLegacySaveMinimals({
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


export async function calculateMinimalsFeature({
  sourceFumen,
  pattern,
  wantedSave,
  clear = 4,
  solver,
  useHold = true,
  exactHumanQuality = "Fast",
  useHiGHS = undefined,
  UseHiGHS = undefined,
  fastStateBudget = undefined,
}) {
  decodeAndValidate(sourceFumen, clear);
  const calculation = await calculateSaveMinimals({
    sourceFumen,
    analysisPattern: pattern,
    wantedSave,
    solver,
    useHold,
    height: clear,
    exactHumanQuality,
    useHiGHS: useHiGHS ?? UseHiGHS ?? "auto",
    fastStateBudget,
  });
  return {
    pathPattern: queuesForFinder(pattern),
    analysisPattern: pattern,
    total: calculation.queues.length,
    saveSuccess: calculation.saveSuccess,
    minimalCount: calculation.minimalCount,
    coverageCounts: calculation.coverageCounts,
    fumen: encodeSaveMinimalFumen(calculation),
    minimumCoverBackend: calculation.minimumCoverBackend,
    cardinalityBackend: calculation.cardinalityBackend,
    qualityBackend: calculation.qualityBackend,
    useHiGHSRequested: calculation.useHiGHSRequested,
    useHiGHSResolved: calculation.useHiGHSResolved,
    minimumCoverKernelCases: calculation.minimumCoverKernelCases,
    minimumCoverKernelSolutions: calculation.minimumCoverKernelSolutions,
    minimumCoverKernelEntries: calculation.minimumCoverKernelEntries,
    fastDominancePreviewBudget: calculation.fastDominancePreviewBudget,
    fastDominancePreviewStates: calculation.fastDominancePreviewStates,
    fastProbeBudget: calculation.fastProbeBudget,
    fastProbeStates: calculation.fastProbeStates,
    fastThresholdBudget: calculation.fastThresholdBudget,
    fastThresholdStates: calculation.fastThresholdStates,
    fastFallback: calculation.fastFallback,
    fastDecision: calculation.fastDecision,
    humanQualityExact: calculation.humanQualityExact,
  };
}

// Compatibility aliases. Production callers should use calculateMinimalsFeature();
// the explicit Legacy name is the synchronous pre-2.1 behavior.
export const calculateMinimalsFeatureAsync = calculateMinimalsFeature;
export const calculateMinimalsFeatureSync = calculateLegacyMinimalsFeature;

export function calculateLegacyFifthFeature({
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

export async function calculateFifthFeature({
  sourceFumen,
  pattern,
  title = "",
  clear = 4,
  solver,
  useHold = true,
  exactHumanQuality = "true",
  useHiGHS = undefined,
  UseHiGHS = undefined,
  fastStateBudget = undefined,
}) {
  decodeAndValidate(sourceFumen, clear);
  if (clear !== 4) throw new Error("5th is clear=4 only");
  const calculation = await fifthMinimalsPerSavesAsync({
    sourceFumen,
    analysisPattern: pattern,
    solver,
    useHold,
    exactHumanQuality,
    useHiGHS: useHiGHS ?? UseHiGHS ?? "auto",
    fastStateBudget,
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

export const calculateFifthFeatureAsync = calculateFifthFeature;
export const calculateFifthFeatureSync = calculateLegacyFifthFeature;

export function calculateLegacyPerSaveMinimalsFeature({
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

export async function calculatePerSaveMinimalsFeature({
  sourceFumen,
  pattern,
  title = "",
  targetLines,
  clear,
  solver,
  useHold = true,
  candidateLimit = 16,
  exactHumanQuality = "true",
  useHiGHS = undefined,
  UseHiGHS = undefined,
  fastStateBudget = undefined,
}) {
  const resolved = resolvePerSaveTargetLines({ targetLines, clear });
  decodeAndValidate(sourceFumen, resolved);
  const calculation = await calculatePerSaveMinimalsAsync({
    sourceFumen,
    pattern,
    solver,
    useHold,
    targetLines: resolved,
    candidateLimit,
    exactHumanQuality,
    useHiGHS: useHiGHS ?? UseHiGHS ?? "auto",
    fastStateBudget,
    includeCoverage: false,
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
      humanQualityExact: result.humanQualityExact,
      minimumCoverBackend: result.minimumCoverBackend,
      cardinalityBackend: result.cardinalityBackend,
      qualityBackend: result.qualityBackend,
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

export const calculatePerSaveMinimalsFeatureAsync = calculatePerSaveMinimalsFeature;
export const calculatePerSaveMinimalsFeatureSync = calculateLegacyPerSaveMinimalsFeature;
