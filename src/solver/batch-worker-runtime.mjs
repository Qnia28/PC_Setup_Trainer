import {
  calculateCongruent,
  calculateCongruentCover,
  calculateCover,
  warmBatchSolver,
} from "./batch-features.mjs";

export async function runBatchWorkerRequest(request) {
  if (request.kind === "warmup") return warmBatchSolver();
  if (request.kind === "cover") return calculateCover(request.input);
  if (request.kind === "congruent") return calculateCongruent(request.input);
  if (request.kind === "congruentcover") return calculateCongruentCover(request.input);
  throw new Error(`unknown batch request ${request.kind}`);
}
