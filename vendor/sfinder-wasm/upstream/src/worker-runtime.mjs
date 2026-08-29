import {
  calculateChance,
  calculateFifthFeature,
  calculateLegacyMinimalsFeature,
  calculateMinimalsFeature,
  calculatePerSaveMinimalsFeature,
  calculateSaves,
} from "./features.mjs";
import { calculateFourthDistribution } from "./fourth.mjs";
import { solveSingleQueueFeature } from "./pc-solve.mjs";
import { resolvePerSaveTargetLines } from "./per-save-minimals.mjs";
import { loadWasmAssets, WasmPcSolver } from "./wasm-backend.mjs";

let assetsPromise;
const solvers = new Map();

async function getSolver(height) {
  let solver = solvers.get(height);
  if (solver) return solver;
  assetsPromise ??= loadWasmAssets();
  const assets = await assetsPromise;
  solver = new WasmPcSolver(assets.exports, height, height === 4 ? assets.legal : null);
  solvers.set(height, solver);
  return solver;
}

function requestHeight(request) {
  if (request.kind === "per-save-minimals") return resolvePerSaveTargetLines(request.input);
  if (["solve-one", "solve-all", "per-save-all"].includes(request.kind)) {
    return request.input?.targetLines ?? request.input?.clear ?? 4;
  }
  return request.input?.clear ?? 4;
}

export async function runWorkerRequest(request) {
  const clear = requestHeight(request);
  const solver = await getSolver(clear);
  const input = { ...request.input, solver };
  switch (request.kind) {
    case "chance": return calculateChance(input);
    case "saves": return calculateSaves(input);
    case "minimals": return calculateMinimalsFeature(input);
    case "legacy-minimals": return calculateLegacyMinimalsFeature(input);
    case "fourth": return calculateFourthDistribution(input);
    case "fifth": return calculateFifthFeature(input);
    case "per-save-minimals": return calculatePerSaveMinimalsFeature(input);
    case "solve-one":
    case "solve-all":
    case "per-save-all": return solveSingleQueueFeature(request.kind, input);
    default: throw new Error(`unknown request ${request.kind}`);
  }
}
