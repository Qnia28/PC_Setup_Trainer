import {
  calculateChance,
  calculateMinimalsFeature,
  calculatePerSaveMinimalsFeature,
  calculateSaves,
} from "../../vendor/sfinder-wasm/upstream/src/features.mjs";
import { solveSingleQueueFeature } from "../../vendor/sfinder-wasm/upstream/src/pc-solve.mjs";
import { resolvePerSaveTargetLines } from "../../vendor/sfinder-wasm/upstream/src/per-save-minimals.mjs";
import { keyedRetryableLoader } from "../../vendor/sfinder-wasm/upstream/src/promise-utils.mjs";
import { loadWasmAssets, WasmPcSolver } from "./wasm-backend.mjs";

let wasmMemory;
let retainedAssetBytes = 0;

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

function backendUsesHiGHS(value) {
  return typeof value === "string" && value.toLowerCase().includes("highs");
}

export function resultUsedHiGHS(value) {
  if (!value || typeof value !== "object") return false;
  if (value.useHiGHSResolved === true) return true;
  if (backendUsesHiGHS(value.minimumCoverBackend)
    || backendUsesHiGHS(value.cardinalityBackend)
    || backendUsesHiGHS(value.qualityBackend)) return true;
  if (!value.results || typeof value.results !== "object") return false;
  return Object.values(value.results).some((row) => resultUsedHiGHS(row));
}

export function shouldRecycleSolverWorkerAfterResult(value) {
  return shouldRecycleSolverWorker() || resultUsedHiGHS(value);
}

export function shouldRecycleSolverWorkerAfterError(requestKind) {
  void requestKind;
  return shouldRecycleSolverWorker();
}

export function createRetryableSolverLoader(factory) {
  const solverByHeight = keyedRetryableLoader(factory);
  return function loadSolver(height) {
    if (!Number.isInteger(height) || height < 2 || height > 6) {
      return Promise.reject(new Error(`unsupported height ${height}`));
    }
    return solverByHeight(height);
  };
}

const getSolver = createRetryableSolverLoader(async (height) => {
  const assets = await loadWasmAssets();
  wasmMemory = assets.exports.memory;
  retainedAssetBytes = assets.legal?.byteLength ?? 0;
  return new WasmPcSolver(assets.exports, height, height === 4 ? assets.legal : null);
});

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
