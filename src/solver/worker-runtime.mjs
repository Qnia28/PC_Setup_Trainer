import { decoder } from "tetris-fumen";
import { boardFromFumenPage, highestOccupiedRow, popcount } from "../../vendor/sfinder-wasm/upstream/src/board.mjs";
import { combineWithIntro, solutionPage } from "../../vendor/sfinder-wasm/upstream/src/fumen.mjs";
import { calculatePerSaveMinimalsFeature } from "../../vendor/sfinder-wasm/upstream/src/features.mjs";
import {
  calculateChance,
  calculateMinimalsFeature,
  calculateSaves,
} from "../../vendor/sfinder-wasm/upstream/src/features.mjs";
import { PER_SAVE_DISPLAY_ORDER, unusedPieceForSolution } from "../../vendor/sfinder-wasm/upstream/src/per-save-minimals-core.mjs";
import { resolvePerSaveTargetLines } from "../../vendor/sfinder-wasm/upstream/src/per-save-minimals.mjs";
import { expandPattern } from "../../vendor/sfinder-wasm/upstream/src/pattern.mjs";
import { loadWasmAssets, WasmPcSolver } from "./wasm-backend.mjs";

let assetsPromise;
let wasmMemory;
let retainedAssetBytes = 0;
const solvers = new Map();

export const MAX_RETAINED_SOLVER_MEMORY_BYTES = 128 * 1024 * 1024;

export function retainedSolverMemoryBytes() {
  return (wasmMemory?.buffer?.byteLength ?? 0) + retainedAssetBytes;
}

export function exceedsSolverWorkerMemoryLimit(memoryBytes) {
  return memoryBytes > MAX_RETAINED_SOLVER_MEMORY_BYTES;
}

export function shouldRecycleSolverWorker() {
  return exceedsSolverWorkerMemoryLimit(retainedSolverMemoryBytes());
}

async function getSolver(height) {
  let solver = solvers.get(height);
  if (solver) return solver;
  assetsPromise ??= loadWasmAssets();
  const assets = await assetsPromise;
  wasmMemory = assets.exports.memory;
  retainedAssetBytes = assets.legal?.byteLength ?? 0;
  solver = new WasmPcSolver(assets.exports, height, height === 4 ? assets.legal : null);
  solvers.set(height, solver);
  return solver;
}

async function warmup(targetLines) {
  await getSolver(targetLines);
  return {
    targetLines,
    ready: true,
    memoryBytes: retainedSolverMemoryBytes(),
  };
}

function geometry(sourceFumen, targetLines) {
  const page = decoder.decode(sourceFumen)[0];
  if (!page) throw new Error("empty fumen");
  const highest = highestOccupiedRow(page);
  if (highest >= 6) throw new Error(`board height ${highest + 1} exceeds the 6-row solver`);
  if (highest >= targetLines) throw new Error(`board height ${highest + 1} exceeds targetLines ${targetLines}`);
  const board = boardFromFumenPage(page, targetLines);
  const occupiedCells = popcount(board);
  const remainingCells = targetLines * 10 - occupiedCells;
  if (remainingCells <= 0 || remainingCells % 4 !== 0) {
    throw new Error(`current board cannot complete a ${targetLines}-line PC`);
  }
  return { board, occupiedCells, remainingCells, piecesNeeded: remainingCells / 4 };
}

function exactQueue(pattern, expectedLength, requestName) {
  const queues = expandPattern(pattern);
  if (queues.length !== 1) throw new Error(`${requestName} requires one exact queue`);
  const queue = queues[0];
  if (queue.length !== expectedLength) {
    throw new Error(`queue length is incompatible with this board: expected see${expectedLength}, got ${queue.length}`);
  }
  return queue;
}

async function perSave(input, targetLines) {
  const solver = await getSolver(targetLines);
  geometry(input.sourceFumen, targetLines);
  return calculatePerSaveMinimalsFeature({ ...input, solver, targetLines });
}

function preferredSolution(solutions) {
  return [...solutions].sort((left, right) => {
    const orderDifference = Number(right.orderCount ?? 0) - Number(left.orderCount ?? 0);
    if (orderDifference !== 0) return orderDifference;
    return left.key === right.key ? 0 : left.key < right.key ? -1 : 1;
  })[0];
}

async function solveOne(input, targetLines) {
  const current = geometry(input.sourceFumen, targetLines);
  const queue = exactQueue(input.pattern, current.piecesNeeded, "solve-one");
  const solver = await getSolver(targetLines);
  const solution = preferredSolution(solver.enumeratePc(current.board, queue, input.useHold !== false));
  if (!solution) {
    return {
      targetLines,
      occupiedCells: current.occupiedCells,
      piecesNeeded: current.piecesNeeded,
      solutionCount: 0,
      fumen: null,
    };
  }
  const page = solutionPage(current.board, solution, "Solution", targetLines);
  return {
    targetLines,
    occupiedCells: current.occupiedCells,
    piecesNeeded: current.piecesNeeded,
    solutionCount: 1,
    fumen: combineWithIntro(input.sourceFumen, input.title ?? "", [page]),
  };
}

async function solveAll(input, targetLines) {
  const current = geometry(input.sourceFumen, targetLines);
  const queue = exactQueue(input.pattern, current.piecesNeeded, "solve-all");
  const solver = await getSolver(targetLines);
  const solutions = solver.enumeratePc(current.board, queue, input.useHold !== false)
    .sort((left, right) => left.key.localeCompare(right.key));
  const pages = solutions.map((solution, index) =>
    solutionPage(current.board, solution, `Solution ${index + 1}`, targetLines));
  return {
    targetLines,
    occupiedCells: current.occupiedCells,
    piecesNeeded: current.piecesNeeded,
    solutionCount: solutions.length,
    fumen: solutions.length > 0
      ? combineWithIntro(input.sourceFumen, input.title ?? "", pages)
      : null,
  };
}

async function perSaveAll(input, targetLines) {
  const current = geometry(input.sourceFumen, targetLines);
  const queue = exactQueue(input.pattern, current.piecesNeeded + 1, "per-save-all");
  const solver = await getSolver(targetLines);
  const grouped = new Map([...PER_SAVE_DISPLAY_ORDER].map((piece) => [piece, []]));
  const solutions = solver.enumeratePc(current.board, queue, input.useHold !== false)
    .sort((left, right) => left.key.localeCompare(right.key));
  for (const solution of solutions) grouped.get(unusedPieceForSolution(queue, solution)).push(solution);
  const pages = [];
  const pageCounts = {};
  for (const piece of PER_SAVE_DISPLAY_ORDER) {
    const savedSolutions = grouped.get(piece);
    pageCounts[piece] = savedSolutions.length;
    for (const solution of savedSolutions) {
      pages.push(solutionPage(current.board, solution, `Save ${piece}`, targetLines));
    }
  }
  return {
    targetLines,
    occupiedCells: current.occupiedCells,
    piecesNeeded: current.piecesNeeded,
    expectedQueueLength: current.piecesNeeded + 1,
    solutionCount: solutions.length,
    pageCounts,
    fumen: pages.length > 0
      ? combineWithIntro(input.sourceFumen, input.title ?? "", pages)
      : null,
  };
}

export async function runWorkerRequest(request) {
  const targetLines = request.kind === "per-save-minimals" || request.kind === "per-save-all"
    ? resolvePerSaveTargetLines(request.input)
    : request.input?.clear ?? request.input?.targetLines ?? 4;
  if (request.kind === "warmup") return warmup(targetLines);
  if (request.kind === "chance") {
    const solver = await getSolver(targetLines);
    return calculateChance({ ...request.input, clear: targetLines, solver });
  }
  if (request.kind === "saves") {
    const solver = await getSolver(targetLines);
    return calculateSaves({ ...request.input, clear: targetLines, solver });
  }
  if (request.kind === "minimals") {
    const solver = await getSolver(targetLines);
    return calculateMinimalsFeature({ ...request.input, clear: targetLines, solver });
  }
  if (request.kind === "per-save-minimals") return perSave(request.input, targetLines);
  if (request.kind === "per-save-all") return perSaveAll(request.input, targetLines);
  if (request.kind === "solve-one") return solveOne(request.input, targetLines);
  if (request.kind === "solve-all") return solveAll(request.input, targetLines);
  throw new Error(`unknown request ${request.kind}`);
}
