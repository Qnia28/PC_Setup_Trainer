import { runBatchWorkerRequest } from "./batch-worker-runtime.mjs";

self.onmessage = async (event) => {
  const request = event.data;
  try {
    self.postMessage({ id: request.id, ok: true, value: await runBatchWorkerRequest(request) });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: { name: error?.name ?? "Error", message: error?.message ?? String(error) },
    });
  }
};
