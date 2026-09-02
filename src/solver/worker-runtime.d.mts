export interface WorkerRuntimeRequest {
  kind: "warmup" | "chance" | "saves" | "minimals" | "per-save-minimals" | "per-save-all" | "solve-one" | "solve-all";
  input: {
    sourceFumen?: string;
    pattern?: string;
    targetLines: 2 | 3 | 4 | 5 | 6;
    useHold?: boolean;
    candidateLimit?: number;
    title?: string;
    clear?: 2 | 3 | 4 | 5 | 6;
    wantedSave?: string;
    useHiGHS?: boolean | "auto";
    exactHumanQuality?: "Fast" | "True";
  };
}

export const MAX_RETAINED_SOLVER_MEMORY_BYTES: number;
export function retainedSolverMemoryBytes(): number;
export function exceedsSolverWorkerMemoryLimit(memoryBytes: number): boolean;
export function shouldRecycleSolverWorker(): boolean;
export function resultUsedHiGHS(value: unknown): boolean;
export function shouldRecycleSolverWorkerAfterResult(value: unknown): boolean;
export function shouldRecycleSolverWorkerAfterError(requestKind: WorkerRuntimeRequest["kind"]): boolean;
export function createRetryableSolverLoader<T>(factory: (height: number) => Promise<T> | T): (height: number) => Promise<T>;
export function runWorkerRequest(request: WorkerRuntimeRequest): Promise<unknown>;
