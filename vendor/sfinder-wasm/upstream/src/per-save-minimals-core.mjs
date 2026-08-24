import { makeOrderCountQuality, recordOrderCount } from "./human-ranking.mjs";
import { minimumCover } from "./min-cover.mjs";
import { orderMinimalKeysByCoverage } from "./minimal-order.mjs";
import { visitCaseSolutions } from "./path-engine.mjs";
import { pieceFromRustCode, TETRIS_DISPLAY_ORDER } from "./piece-order.mjs";
import { placedCounts } from "./tiling.mjs";

export const PER_SAVE_DISPLAY_ORDER = TETRIS_DISPLAY_ORDER;

function counter(sequence) {
  const counts = new Map();
  for (const piece of sequence) counts.set(piece, (counts.get(piece) ?? 0) + 1);
  return counts;
}

function normalizeCases(queues) {
  return queues.map((entry, index) =>
    typeof entry === "string" ? { caseId: `legacy:${index}`, queue: entry } : entry);
}

export function unusedPieceForSolution(queue, solution) {
  const available = counter(queue);
  const used = placedCounts(solution);
  const left = [];
  for (const piece of PER_SAVE_DISPLAY_ORDER) {
    const remaining = (available.get(piece) ?? 0) - (used.get(piece) ?? 0);
    if (remaining < 0) throw new Error(`solution uses more ${piece} pieces than queue provides`);
    for (let index = 0; index < remaining; index += 1) left.push(piece);
  }
  if (left.length !== 1) throw new Error(`expected exactly one saved piece, got ${left.length}`);
  return left[0];
}

export function perSaveLabel(piece, { pcSuccess, success, saveRate, guaranteed }) {
  if (guaranteed) return `☆ Save ${piece}`;
  if (pcSuccess === 0 || saveRate === null) return `Save ${piece} (N/A)`;
  return `Save ${piece} (${(saveRate * 100).toFixed(2)}%)`;
}

function directSingleQueueResult({ board, cases, direct, displayOrder }) {
  const entry = cases[0];
  const bestByPiece = new Map();
  for (const solution of direct) {
    const piece = pieceFromRustCode(solution.saved);
    if (piece) bestByPiece.set(piece, solution);
  }
  const pcSuccess = direct.length ? 1 : 0;
  const results = {};
  for (const piece of displayOrder) {
    const solution = bestByPiece.get(piece);
    const success = solution ? 1 : 0;
    const saveRate = pcSuccess === 0 ? null : success / pcSuccess;
    const guaranteed = pcSuccess > 0 && success === pcSuccess;
    const coverage = new Map();
    if (solution) coverage.set(entry.caseId, new Set([solution.key]));
    const data = {
      piece,
      success,
      pcSuccess,
      total: 1,
      saveRate,
      guaranteed,
      minimalCount: success,
      keys: solution ? [solution.key] : [],
      solutions: solution ? [solution] : [],
      coverageCounts: solution ? [1] : [],
      coverage,
      humanQualityVector: solution ? [solution.orderCount ?? 0] : [],
      playableOrderCount: solution ? Number(solution.orderCount ?? 0) : null,
    };
    data.label = perSaveLabel(piece, data);
    results[piece] = data;
  }
  return { board, queues: [entry.queue], total: 1, pcSuccess, pcRate: pcSuccess, results };
}

export function calculatePerSaveMinimalsFromBoard({
  board,
  queues,
  solver,
  useHold = true,
  displayOrder = PER_SAVE_DISPLAY_ORDER,
  candidateLimit = 16,
}) {
  const cases = normalizeCases(queues);

  // Single exact queue uses the bounded Rust path and avoids all-solution
  // transfer/set-cover work. The general path below is shared with minimals.
  if (cases.length === 1 && typeof solver.perSaveBest === "function") {
    const direct = solver.perSaveBest(board, cases[0].queue, useHold, { candidateLimit });
    if (Array.isArray(direct)) {
      return directSingleQueueResult({ board, cases, direct, displayOrder });
    }
  }

  const coverageByPiece = new Map([...displayOrder].map((piece) => [piece, new Map()]));
  const qualityIndex = new Map();
  const { caseHasSolution, byKey } = visitCaseSolutions({
    board,
    cases,
    solver,
    useHold,
    visit: (entry, _caseIndex, solution, orderCount) => {
      recordOrderCount(qualityIndex, entry.caseId, { key: solution.key, orderCount });
      const saved = unusedPieceForSolution(entry.queue, solution);
      let keys = coverageByPiece.get(saved).get(entry.caseId);
      if (!keys) {
        keys = new Set();
        coverageByPiece.get(saved).set(entry.caseId, keys);
      }
      keys.add(solution.key);
    },
  });
  const pcSuccess = caseHasSolution.reduce((count, value) => count + value, 0);

  const qualityFor = makeOrderCountQuality(qualityIndex);
  const results = {};
  for (const piece of displayOrder) {
    const coverage = coverageByPiece.get(piece);
    const success = coverage.size;
    const saveRate = pcSuccess === 0 ? null : success / pcSuccess;
    const guaranteed = pcSuccess > 0 && success === pcSuccess;
    let minimalCount = 0;
    let keys = [];
    let solutions = [];
    let coverageCounts = [];
    let humanQualityVector = [];

    if (success > 0) {
      const minimal = minimumCover(coverage, { qualityFor, solver });
      if (Number.isFinite(minimal.count) && minimal.keys.length) {
        minimalCount = minimal.count;
        const ordered = orderMinimalKeysByCoverage(minimal.keys, coverage);
        keys = ordered.keys;
        coverageCounts = ordered.coverageCounts;
        solutions = keys.map((key) => byKey.get(key));
        humanQualityVector = minimal.qualityVector ?? [];
      }
    }

    const data = {
      piece,
      success,
      pcSuccess,
      total: cases.length,
      saveRate,
      guaranteed,
      minimalCount,
      keys,
      solutions,
      coverageCounts,
      coverage,
      humanQualityVector,
      playableOrderCount: cases.length === 1 && solutions.length
        ? humanQualityVector[0] ?? 0
        : null,
    };
    data.label = perSaveLabel(piece, data);
    results[piece] = data;
  }

  return {
    board,
    queues: cases.map((entry) => entry.queue),
    total: cases.length,
    pcSuccess,
    pcRate: cases.length === 0 ? null : pcSuccess / cases.length,
    results,
  };
}
