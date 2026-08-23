import { segmentForFrame, type ReplayPcSegment } from "./navigation";
import type { ReplayTimeline } from "./timeline";

export const DEFAULT_REPLAY_GIF_FRAME_MS = 200;
export const MIN_REPLAY_GIF_FRAME_MS = 20;
export const MAX_REPLAY_GIF_FRAME_MS = 5_000;
export const MAX_REPLAY_GIF_FRAMES = 2_000;

export interface ReplayGifStop {
  position: number;
  pcNumber: number;
  pieceInPc: number;
  label: string;
}

export interface ReplayGifRange {
  startPosition: number;
  endPosition: number;
}

export interface ReplayGifRangeInput {
  startPcNumber: number;
  startPieceInPc: number;
  endPcNumber: number;
  endPieceInPc: number;
}

export function replayGifStops(replay: ReplayTimeline): ReplayGifStop[] {
  return Array.from({ length: replay.length }, (_, position) => {
    const frame = replay.frameAt(position);
    return {
      position,
      pcNumber: frame.pcIndex + 1,
      pieceInPc: frame.pieceInPc,
      label: `PC ${frame.pcIndex + 1} · ${frame.pieceInPc}P`,
    };
  });
}

function nextSegment(segments: readonly ReplayPcSegment[], current: ReplayPcSegment): ReplayPcSegment | undefined {
  const index = segments.indexOf(current);
  return index >= 0 ? segments[index + 1] : undefined;
}

/** Defaults to replaying one whole PC and includes the following PC's 0P stop when it exists. */
export function defaultReplayGifRange(replay: ReplayTimeline, currentPosition: number): ReplayGifRange {
  const segment = segmentForFrame(replay.segments, currentPosition);
  if (!segment) return { startPosition: currentPosition, endPosition: currentPosition };
  return {
    startPosition: segment.startFrame,
    endPosition: nextSegment(replay.segments, segment)?.startFrame ?? segment.endFrame,
  };
}

function exactStopPosition(replay: ReplayTimeline, pcNumber: number, pieceInPc: number): number | null {
  if (!Number.isInteger(pcNumber) || !Number.isInteger(pieceInPc)) return null;
  for (let position = 0; position < replay.length; position += 1) {
    const frame = replay.frameAt(position);
    if (frame.pcIndex + 1 === pcNumber && frame.pieceInPc === pieceInPc) return position;
  }
  return null;
}

/** Invalid start/end inputs fall back to the replay's first/last recorded stop respectively. */
export function resolveReplayGifInputRange(replay: ReplayTimeline, input: ReplayGifRangeInput): ReplayGifRange {
  if (replay.length <= 0) throw new RangeError("Replay GIF range is unavailable.");
  return {
    startPosition: exactStopPosition(replay, input.startPcNumber, input.startPieceInPc) ?? 0,
    endPosition: exactStopPosition(replay, input.endPcNumber, input.endPieceInPc) ?? replay.length - 1,
  };
}

export function replayGifPositions(range: ReplayGifRange, replayLength: number): number[] {
  const { startPosition, endPosition } = range;
  if (!Number.isInteger(startPosition) || !Number.isInteger(endPosition)
    || startPosition < 0 || endPosition < startPosition || endPosition >= replayLength) {
    throw new RangeError("Replay GIF range is invalid.");
  }
  const count = endPosition - startPosition + 1;
  if (count > MAX_REPLAY_GIF_FRAMES) {
    throw new RangeError(`Replay GIF range exceeds ${MAX_REPLAY_GIF_FRAMES} frames.`);
  }
  return Array.from({ length: count }, (_, index) => startPosition + index);
}

export function normalizeReplayGifFrameMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REPLAY_GIF_FRAME_MS;
  const clamped = Math.max(MIN_REPLAY_GIF_FRAME_MS, Math.min(MAX_REPLAY_GIF_FRAME_MS, Math.round(value)));
  return Math.round(clamped / 10) * 10;
}
