import { drawReplayFrame, REPLAY_CELL_SIZE, REPLAY_VISIBLE_HEIGHT } from "./canvas";
import { replayGifPositions, type ReplayGifRange } from "./gifRange";
import type { ReplayTimeline } from "./timeline";

interface GifWorkerResponse {
  id: number;
  type: "ready" | "frame-ready" | "result" | "error";
  bytes?: ArrayBuffer;
  message?: string;
}

export interface EncodeReplayGifOptions {
  replay: ReplayTimeline;
  range: ReplayGifRange;
  frameMs: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

function abortError(): DOMException {
  return new DOMException("GIF export was cancelled.", "AbortError");
}

export async function encodeReplayGif(options: EncodeReplayGifOptions): Promise<Blob> {
  if (options.signal?.aborted) throw abortError();
  const positions = replayGifPositions(options.range, options.replay.length);
  const canvas = document.createElement("canvas");
  const worker = new Worker(new URL("./gif.worker.ts", import.meta.url), { type: "module" });
  let nextId = 0;
  const pending = new Map<number, { resolve: (response: GifWorkerResponse) => void; reject: (reason: unknown) => void }>();

  function request(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<GifWorkerResponse> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...message }, transfer);
    });
  }

  const onAbort = () => {
    const reason = abortError();
    for (const waiter of pending.values()) waiter.reject(reason);
    pending.clear();
    worker.terminate();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  worker.onmessage = (event: MessageEvent<GifWorkerResponse>) => {
    const response = event.data;
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.type === "error") waiter.reject(new Error(response.message ?? "GIF encoding failed."));
    else waiter.resolve(response);
  };
  worker.onerror = (event) => {
    const reason = new Error(event.message || "GIF worker failed.");
    for (const waiter of pending.values()) waiter.reject(reason);
    pending.clear();
  };

  try {
    await request({
      type: "start",
      width: 10 * REPLAY_CELL_SIZE,
      height: REPLAY_VISIBLE_HEIGHT * REPLAY_CELL_SIZE,
      delayMs: options.frameMs,
    });
    options.onProgress?.(0, positions.length);
    for (const [index, position] of positions.entries()) {
      if (options.signal?.aborted) throw abortError();
      drawReplayFrame(canvas, options.replay.frameAt(position), { pixelRatio: 1 });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable.");
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      await request({ type: "frame", rgba: rgba.buffer }, [rgba.buffer]);
      options.onProgress?.(index + 1, positions.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const response = await request({ type: "finish" });
    if (!response.bytes) throw new Error("GIF encoder returned no data.");
    return new Blob([response.bytes], { type: "image/gif" });
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    worker.terminate();
  }
}

