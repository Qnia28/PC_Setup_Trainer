export interface BatchWorkerRuntimeRequest {
  kind: "warmup" | "cover" | "coverpercent" | "congruent" | "congruentcover";
  input: Record<string, unknown>;
}

export function runBatchWorkerRequest(request: BatchWorkerRuntimeRequest): Promise<unknown>;
