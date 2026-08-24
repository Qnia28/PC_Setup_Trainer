import { combineWithIntro, solutionPage } from "./fumen.mjs";
import { preferredSolution } from "./human-ranking.mjs";
import { exactQueue, pcGeometry, validateTargetLines } from "./pc-input.mjs";
import { pieceFromRustCode } from "./piece-order.mjs";
import { PER_SAVE_DISPLAY_ORDER, unusedPieceForSolution } from "./per-save-minimals-core.mjs";

function resolvedTargetLines(input) {
  return validateTargetLines(input.targetLines ?? input.clear ?? 4);
}

function sortedSolutions(solutions) {
  return [...solutions].sort((left, right) => left.key.localeCompare(right.key));
}

function selectedSavedPiece(queue, solution) {
  const saved = Number(solution?.saved ?? 7);
  return pieceFromRustCode(saved) ?? unusedPieceForSolution(queue, solution);
}

export function solveOnePc({
  sourceFumen,
  pattern,
  targetLines,
  clear,
  title = "",
  solver,
  useHold = true,
}) {
  const height = resolvedTargetLines({ targetLines, clear });
  const current = pcGeometry(sourceFumen, height);
  const queue = exactQueue(pattern, current.piecesNeeded, "solve-one");
  const solution = typeof solver.bestPc === "function"
    ? solver.bestPc(current.board, queue, useHold)
    : preferredSolution(solver.enumeratePc(current.board, queue, useHold));
  if (!solution) {
    return {
      targetLines: height,
      occupiedCells: current.occupiedCells,
      remainingCells: current.remainingCells,
      piecesNeeded: current.piecesNeeded,
      solutionCount: 0,
      solutionKey: null,
      playableOrderCount: 0,
      fumen: null,
    };
  }
  const page = solutionPage(current.board, solution, "Solution", height);
  return {
    targetLines: height,
    occupiedCells: current.occupiedCells,
    remainingCells: current.remainingCells,
    piecesNeeded: current.piecesNeeded,
    solutionCount: 1,
    solutionKey: solution.key,
    playableOrderCount: Number(solution.orderCount ?? 0),
    fumen: combineWithIntro(sourceFumen, title, [page]),
  };
}

export function solveAllPc({
  sourceFumen,
  pattern,
  targetLines,
  clear,
  title = "",
  solver,
  useHold = true,
}) {
  const height = resolvedTargetLines({ targetLines, clear });
  const current = pcGeometry(sourceFumen, height);
  const queue = exactQueue(pattern, current.piecesNeeded, "solve-all");
  const solutions = sortedSolutions(solver.enumeratePc(current.board, queue, useHold));
  const pages = solutions.map((solution, index) =>
    solutionPage(current.board, solution, `Solution ${index + 1}`, height));
  return {
    targetLines: height,
    occupiedCells: current.occupiedCells,
    remainingCells: current.remainingCells,
    piecesNeeded: current.piecesNeeded,
    solutionCount: solutions.length,
    fumen: pages.length > 0 ? combineWithIntro(sourceFumen, title, pages) : null,
  };
}

export function solvePerSaveAllPc({
  sourceFumen,
  pattern,
  targetLines,
  clear,
  title = "",
  solver,
  useHold = true,
}) {
  const height = resolvedTargetLines({ targetLines, clear });
  const current = pcGeometry(sourceFumen, height);
  const expectedQueueLength = current.piecesNeeded + 1;
  const queue = exactQueue(pattern, expectedQueueLength, "per-save-all");
  const solutions = sortedSolutions(solver.enumeratePc(current.board, queue, useHold));
  const grouped = new Map([...PER_SAVE_DISPLAY_ORDER].map((piece) => [piece, []]));
  for (const solution of solutions) grouped.get(selectedSavedPiece(queue, solution)).push(solution);

  const pageCounts = {};
  const pages = [];
  for (const piece of PER_SAVE_DISPLAY_ORDER) {
    const savedSolutions = grouped.get(piece);
    pageCounts[piece] = savedSolutions.length;
    for (const solution of savedSolutions) {
      pages.push(solutionPage(current.board, solution, `Save ${piece}`, height));
    }
  }
  return {
    targetLines: height,
    occupiedCells: current.occupiedCells,
    remainingCells: current.remainingCells,
    piecesNeeded: current.piecesNeeded,
    expectedQueueLength,
    solutionCount: solutions.length,
    pageCounts,
    fumen: pages.length > 0 ? combineWithIntro(sourceFumen, title, pages) : null,
  };
}

export function solveSingleQueueFeature(kind, input) {
  if (kind === "solve-one") return solveOnePc(input);
  if (kind === "solve-all") return solveAllPc(input);
  if (kind === "per-save-all") return solvePerSaveAllPc(input);
  throw new Error(`unknown single-queue solve kind ${kind}`);
}
