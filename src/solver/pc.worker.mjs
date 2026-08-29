import {
  retainedSolverMemoryBytes,
  runWorkerRequest,
  shouldRecycleSolverWorkerAfterError,
  shouldRecycleSolverWorkerAfterResult,
} from "./worker-runtime.mjs";

self.onmessage = async (event) => {
  const request = event.data;
  try {
    const value = await runWorkerRequest(request);
    self.postMessage({
      id: request.id,
      ok: true,
      value,
      recycle: shouldRecycleSolverWorkerAfterResult(value),
      memoryBytes: retainedSolverMemoryBytes(),
    });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      recycle: shouldRecycleSolverWorkerAfterError(request.kind),
      memoryBytes: retainedSolverMemoryBytes(),
      error: {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
      },
    });
  }
};
