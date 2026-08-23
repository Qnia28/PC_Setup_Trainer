import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_REPLAY_GIF_FRAME_MS,
  defaultReplayGifRange,
  normalizeReplayGifFrameMs,
  replayGifPositions,
  resolveReplayGifInputRange,
} from "./gifRange";
import { encodeReplayGif } from "./gifEncoder";
import type { ReplayTimeline } from "./timeline";

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ReplayGifDialog({
  replay,
  currentPosition,
  onClose,
}: {
  replay: ReplayTimeline;
  currentPosition: number;
  onClose: () => void;
}) {
  const initialRange = useMemo(() => defaultReplayGifRange(replay, currentPosition), [currentPosition, replay]);
  const initialStart = replay.frameAt(initialRange.startPosition);
  const initialEnd = replay.frameAt(initialRange.endPosition);
  const [startPcNumber, setStartPcNumber] = useState(initialStart.pcIndex + 1);
  const [startPieceInPc, setStartPieceInPc] = useState(initialStart.pieceInPc);
  const [endPcNumber, setEndPcNumber] = useState(initialEnd.pcIndex + 1);
  const [endPieceInPc, setEndPieceInPc] = useState(initialEnd.pieceInPc);
  const [frameMs, setFrameMs] = useState(DEFAULT_REPLAY_GIF_FRAME_MS);
  const [status, setStatus] = useState<"idle" | "encoding" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const abortController = useRef<AbortController | null>(null);
  const effectiveRange = useMemo(() => resolveReplayGifInputRange(replay, {
    startPcNumber,
    startPieceInPc,
    endPcNumber,
    endPieceInPc,
  }), [endPcNumber, endPieceInPc, replay, startPcNumber, startPieceInPc]);
  const { startPosition, endPosition } = effectiveRange;
  const frameCount = endPosition >= startPosition ? endPosition - startPosition + 1 : 0;
  const effectiveStart = replay.frameAt(startPosition);
  const effectiveEnd = replay.frameAt(endPosition);
  const rangeAdjusted = effectiveStart.pcIndex + 1 !== startPcNumber
    || effectiveStart.pieceInPc !== startPieceInPc
    || effectiveEnd.pcIndex + 1 !== endPcNumber
    || effectiveEnd.pieceInPc !== endPieceInPc;

  useEffect(() => () => abortController.current?.abort(), []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      abortController.current?.abort();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function makeGif() {
    const normalizedMs = normalizeReplayGifFrameMs(frameMs);
    setFrameMs(normalizedMs);
    let positions: number[];
    try {
      positions = replayGifPositions({ startPosition, endPosition }, replay.length);
    } catch (reason) {
      setStatus("error");
      setMessage(reason instanceof Error ? reason.message : "Replay GIF range is invalid.");
      return;
    }
    const controller = new AbortController();
    abortController.current = controller;
    setStatus("encoding");
    setProgress(0);
    setMessage(`Encoding 0 / ${positions.length} frames…`);
    try {
      const blob = await encodeReplayGif({
        replay,
        range: { startPosition, endPosition },
        frameMs: normalizedMs,
        signal: controller.signal,
        onProgress: (completed, total) => {
          setProgress(total === 0 ? 0 : completed / total);
          setMessage(`Encoding ${completed} / ${total} frames…`);
        },
      });
      const start = replay.frameAt(startPosition);
      const end = replay.frameAt(endPosition);
      downloadBlob(blob, `replay-pc${start.pcIndex + 1}-${start.pieceInPc}p-to-pc${end.pcIndex + 1}-${end.pieceInPc}p.gif`);
      setStatus("done");
      setMessage(`${positions.length} frames exported at ${normalizedMs} ms per frame.`);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setStatus("idle");
        setMessage("GIF export cancelled.");
      } else {
        setStatus("error");
        setMessage(reason instanceof Error ? reason.message : "GIF export failed.");
      }
    } finally {
      if (abortController.current === controller) abortController.current = null;
    }
  }

  function close() {
    abortController.current?.abort();
    onClose();
  }

  function commitResolvedRange() {
    setStartPcNumber(effectiveStart.pcIndex + 1);
    setStartPieceInPc(effectiveStart.pieceInPc);
    setEndPcNumber(effectiveEnd.pcIndex + 1);
    setEndPieceInPc(effectiveEnd.pieceInPc);
  }

  return <div className="replay-gif-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="replay-gif-dialog" role="dialog" aria-modal="true" aria-labelledby="replay-gif-title">
      <header>
        <div><span>REPLAY EXPORT</span><h2 id="replay-gif-title">Make GIF</h2></div>
        <button type="button" className="replay-gif-close" onClick={close} aria-label="Close GIF export">×</button>
      </header>
      <p>Exports the same stops shown by repeatedly pressing Next Piece. Every frame uses one equal delay.</p>
      <div className="replay-gif-fields">
        <fieldset><legend>Start</legend><div>
          <label>PC<input type="number" min="1" step="1" value={startPcNumber} disabled={status === "encoding"} onBlur={commitResolvedRange} onChange={(event) => setStartPcNumber(Number(event.target.value))} /></label>
          <label>P<input type="number" min="0" step="1" value={startPieceInPc} disabled={status === "encoding"} onBlur={commitResolvedRange} onChange={(event) => setStartPieceInPc(Number(event.target.value))} /></label>
        </div></fieldset>
        <fieldset><legend>End</legend><div>
          <label>PC<input type="number" min="1" step="1" value={endPcNumber} disabled={status === "encoding"} onBlur={commitResolvedRange} onChange={(event) => setEndPcNumber(Number(event.target.value))} /></label>
          <label>P<input type="number" min="0" step="1" value={endPieceInPc} disabled={status === "encoding"} onBlur={commitResolvedRange} onChange={(event) => setEndPieceInPc(Number(event.target.value))} /></label>
        </div></fieldset>
        <label className="replay-gif-time">Time per frame<input type="number" min="20" max="5000" step="10" value={frameMs} disabled={status === "encoding"} onChange={(event) => setFrameMs(Number(event.target.value))} /><small>milliseconds</small></label>
      </div>
      <div className="replay-gif-summary"><b>{frameCount} frames</b><span>{frameCount > 0 ? `${(frameCount * frameMs / 1000).toFixed(1)} seconds` : "Invalid range"}{rangeAdjusted ? " · adjusted to replay bounds" : ""}</span></div>
      {status === "encoding" && <progress max="1" value={progress} aria-label="GIF encoding progress" />}
      <footer>
        <p className={status === "error" ? "error" : ""} aria-live="polite">{message}</p>
        <div>
          {status === "encoding" && <button type="button" onClick={() => abortController.current?.abort()}>Cancel</button>}
          <button type="button" className="primary-button" disabled={status === "encoding" || frameCount <= 0} onClick={() => void makeGif()}>{status === "encoding" ? "Encoding…" : "Download GIF"}</button>
        </div>
      </footer>
    </section>
  </div>;
}
