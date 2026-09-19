import { useEffect, useRef, useState } from "react";
import type { ScreenshotResult } from "./imageRecognition";
import { readSolverClipboard } from "./clipboardInput";

export function FumenClipboardInput({ onImport, value, onText }: {
  onImport: (result: ScreenshotResult) => void;
  value: string;
  onText: (value: string) => void;
}) {
  const callback = useRef(onImport);
  callback.current = onImport;
  const request = useRef(0);
  const task = useRef<{ worker: Worker; cancel: () => void } | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  function begin() {
    const id = ++request.current;
    task.current?.cancel();
    if (preview.current) preview.current.width = 0;
    setError(false);
    return id;
  }
  function inputText(text: string, pasted = false) {
    begin(); setBusy(false); onText(text);
    setStatus(pasted ? "Clipboard text entered as Fumen." : "");
  }

  async function pasteClipboard() {
    const id = begin();
    setBusy(true); setStatus("Reading clipboard…");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access requires HTTPS or localhost.");
      const input = await readSolverClipboard(navigator.clipboard);
      if (id !== request.current) return;
      if (input.kind === "image") await read(input.blob, id);
      else {
        if (!input.text.trim()) throw new Error("Clipboard text is empty.");
        inputText(input.text, true);
      }
    } catch (reason) {
      if (id !== request.current) return;
      setError(true); setBusy(false);
      setStatus(`${reason instanceof Error ? reason.message : "Clipboard access failed."} Paste directly into the Fumen input with Ctrl+V / ⌘V. Existing inputs were not changed.`);
    }
  }

  async function read(file: Blob, id = begin()) {
    setBusy(true);
    setStatus("Reading screenshot…"); setError(false);
    let bitmap: ImageBitmap | undefined;
    try {
      if (file.size > 15_000_000 || !file.type.startsWith("image/")) throw new Error("Choose an image under 15 MB.");
      bitmap = await createImageBitmap(file);
      if (id !== request.current) return;
      if (bitmap.width * bitmap.height > 12_000_000) throw new Error("Use an image under 12 megapixels.");
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await new Promise<ScreenshotResult>((resolve, reject) => {
        const worker = new Worker(new URL("./imageRecognition.worker.ts", import.meta.url), { type: "module" });
        const finish = () => { worker.terminate(); if (task.current?.worker === worker) task.current = null; };
        task.current = { worker, cancel: () => { finish(); reject(new Error("Import cancelled.")); } };
        worker.onmessage = (event: MessageEvent<{ result?: ScreenshotResult; error?: string }>) => {
          finish();
          if (event.data.result) resolve(event.data.result);
          else reject(new Error(event.data.error ?? "Image recognition failed."));
        };
        worker.onerror = () => { finish(); reject(new Error("Image recognition worker failed.")); };
        worker.postMessage({ width: pixels.width, height: pixels.height, data: pixels.data }, [pixels.data.buffer]);
      });
      if (id !== request.current) return;
      if (preview.current) {
        const target = preview.current;
        target.width = bitmap.width; target.height = bitmap.height;
        const context = target.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        context.strokeStyle = "#71edc0"; context.lineWidth = 3;
        context.strokeRect(result.board.x, result.board.y, result.board.cell * 10, result.board.cell * 20);
      }
      callback.current(result);
      const count = result.field.flat().filter(Boolean).length;
      setStatus(`Imported ${count} cells · HOLD ${result.hold ?? "empty"} · ACTIVE ${result.active} · NEXT ${result.next.join("")} — check the field and queue before Calculate.`);
    } catch (reason) {
      if (id !== request.current) return;
      if (preview.current) preview.current.width = 0;
      setError(true);
      setStatus(`${reason instanceof Error ? reason.message : "Image recognition failed."} Existing inputs were not changed.`);
    } finally { bitmap?.close(); if (id === request.current) setBusy(false); }
  }
  const readRef = useRef(read); readRef.current = read;
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.items ?? []).find(item => item.type.startsWith("image/"))?.getAsFile();
      if (!image) return;
      event.preventDefault(); void readRef.current(image);
    };
    window.addEventListener("paste", paste);
    return () => { window.removeEventListener("paste", paste); request.current++; task.current?.cancel(); };
  }, []);
  return <div className="standalone-fumen-input">
    <label htmlFor="solver-fumen">Fumen</label>
    <div className="fumen-clipboard-row">
      <input id="solver-fumen" value={value} placeholder="v115@… or Fumen URL" autoComplete="off" spellCheck={false}
        onChange={event => inputText(event.target.value)}
        onPaste={event => {
          if (Array.from(event.clipboardData.items).some(item => item.type.startsWith("image/"))) return;
          const text = event.clipboardData.getData("text/plain");
          if (text) { event.preventDefault(); inputText(text, true); }
        }} />
      <button type="button" className="fumen-clipboard-button" onClick={() => void pasteClipboard()} disabled={busy}
        aria-label="Paste from clipboard" title="Paste an image to recognize the field and queue, or text as Fumen">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="6" rx="1"/></svg>
        {busy ? "Reading…" : "Clipboard"}
      </button>
    </div>
    <small className="fumen-clipboard-hint">Image → field &amp; queue · Text → Fumen</small>
    <p role="status" className={`clipboard-status ${error ? "image-import-error" : ""}`}>{status}</p>
    <details className="clipboard-help"><summary>Image recognition help / preview</summary>
      <p>Full 10×20 grid, colored default-style blocks, current piece near spawn, HOLD and five NEXT pieces visible. Custom monochrome skins, line-clear effects, cropped queues and ambiguous ghosts may not be recognized. No automatic Solve.</p>
      <canvas ref={preview} width={0} height={0} aria-label="Detected screenshot board" />
    </details>
  </div>;
}
