import { GIFEncoder, applyPalette, quantize } from "gifenc";

type StartMessage = { id: number; type: "start"; width: number; height: number; delayMs: number };
type FrameMessage = { id: number; type: "frame"; rgba: ArrayBuffer };
type FinishMessage = { id: number; type: "finish" };
type GifWorkerRequest = StartMessage | FrameMessage | FinishMessage;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GifWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let encoder: ReturnType<typeof GIFEncoder> | null = null;
let width = 0;
let height = 0;
let delayMs = 200;
let frameCount = 0;

function respond(id: number, payload: Record<string, unknown>, transfer: Transferable[] = []): void {
  scope.postMessage({ id, ...payload }, transfer);
}

scope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.type === "start") {
      if (!Number.isInteger(request.width) || request.width <= 0
        || !Number.isInteger(request.height) || request.height <= 0) throw new Error("GIF dimensions are invalid.");
      width = request.width;
      height = request.height;
      delayMs = request.delayMs;
      frameCount = 0;
      encoder = GIFEncoder();
      respond(request.id, { type: "ready" });
      return;
    }
    if (!encoder) throw new Error("GIF encoder has not been started.");
    if (request.type === "frame") {
      const rgba = new Uint8ClampedArray(request.rgba);
      if (rgba.length !== width * height * 4) throw new Error("GIF frame dimensions do not match the encoder.");
      const palette = quantize(rgba, 256, { format: "rgb444" });
      const indexed = applyPalette(rgba, palette, "rgb444");
      encoder.writeFrame(indexed, width, height, {
        palette,
        delay: delayMs,
        repeat: frameCount === 0 ? 0 : undefined,
      });
      frameCount += 1;
      respond(request.id, { type: "frame-ready" });
      return;
    }
    if (frameCount === 0) throw new Error("GIF has no frames.");
    encoder.finish();
    const bytes = encoder.bytes();
    encoder = null;
    respond(request.id, { type: "result", bytes: bytes.buffer }, [bytes.buffer]);
  } catch (reason) {
    respond(request.id, {
      type: "error",
      message: reason instanceof Error ? reason.message : "GIF encoding failed.",
    });
  }
};

