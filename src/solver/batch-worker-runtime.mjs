import { loadBatchWasm } from "../../vendor/sfinder-wasm/upstream/src/batch-backend.mjs";
import { runBatchWorkerRequest as runUpstreamBatchWorkerRequest } from "../../vendor/sfinder-wasm/upstream/src/batch-worker-runtime.mjs";

export async function runBatchWorkerRequest(request) {
  if (request.kind === "warmup") {
    const exports = await loadBatchWasm();
    return { ready: true, memoryBytes: exports.memory?.buffer?.byteLength ?? 0 };
  }
  return runUpstreamBatchWorkerRequest(request);
}
