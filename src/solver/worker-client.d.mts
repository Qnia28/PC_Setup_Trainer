export type WorkerFactory = () => Worker;

export interface WorkerRequestOptions {
  signal?: AbortSignal;
}

export class SolverWorkerClient {
  constructor(factory: WorkerFactory);
  request<T>(kind: string, input: unknown, options?: WorkerRequestOptions): Promise<T>;
  cancel(): void;
  dispose(): void;
}

export const viteWorkerFactory: WorkerFactory;
