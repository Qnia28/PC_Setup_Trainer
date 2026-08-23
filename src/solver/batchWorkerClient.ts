import { SolverWorkerClient } from "./workerClient";

export const viteBatchWorkerFactory = (): Worker => new Worker(
  new URL("./batch.worker.mjs", import.meta.url),
  { type: "module" },
);

export function createBatchWorkerClient(): SolverWorkerClient {
  return new SolverWorkerClient(viteBatchWorkerFactory);
}
