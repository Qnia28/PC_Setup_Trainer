import {
  calculateChance,
  calculateMinimalsFeature,
  calculatePerSaveMinimalsFeature,
  calculateSaves,
} from "../../vendor/sfinder-wasm/upstream/src/features.mjs";
import { solveSingleQueueFeature } from "../../vendor/sfinder-wasm/upstream/src/pc-solve.mjs";
import { resolvePerSaveTargetLines } from "../../vendor/sfinder-wasm/upstream/src/per-save-minimals.mjs";
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

function requestHeight(request) {
  if (request.kind === "per-save-minimals") return resolvePerSaveTargetLines(request.input);
  return request.input?.targetLines ?? request.input?.clear ?? 4;
}

async function warmup(targetLines) {
  await getSolver(targetLines);
  return {
    targetLines,
    ready: true,
    memoryBytes: retainedSolverMemoryBytes(),
  };
}

export async function runWorkerRequest(request) {
  const targetLines = requestHeight(request);
  if (request.kind === "warmup") return warmup(targetLines);

  const solver = await getSolver(targetLines);
  const input = { ...request.input, solver };
  switch (request.kind) {
    case "chance":
      return calculateChance({ ...input, clear: targetLines });
    case "saves":
      return calculateSaves({ ...input, clear: targetLines });
    case "minimals":
      return calculateMinimalsFeature({ ...input, clear: targetLines });
    case "per-save-minimals":
      return calculatePerSaveMinimalsFeature({ ...input, targetLines });
    case "solve-one":
    case "solve-all":
    case "per-save-all":
      return solveSingleQueueFeature(request.kind, { ...input, targetLines });
    default:
      throw new Error(`unknown request ${request.kind}`);
  }
}
