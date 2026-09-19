import { recognizeScreenshot, type Raster } from "./imageRecognition";

self.onmessage = (event: MessageEvent<Raster>) => {
  try { self.postMessage({ result: recognizeScreenshot(event.data) }); }
  catch (reason) { self.postMessage({ error: reason instanceof Error ? reason.message : "Image recognition failed." }); }
};
