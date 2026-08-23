import { describe, expect, it } from "vitest";
import type { ReplayFrame } from "./schema";
import type { ReplayTimeline } from "./timeline";
import {
  defaultReplayGifRange,
  normalizeReplayGifFrameMs,
  replayGifPositions,
  replayGifStops,
  resolveReplayGifInputRange,
} from "./gifRange";

function frame(pcIndex: number, pieceInPc: number): ReplayFrame {
  return {
    kind: pieceInPc === 0 ? "pc-start" : "placement",
    pcIndex,
    cycle: pcIndex === 0 ? 1 : 2,
    pieceInPc,
    snapshot: {
      board: Array.from({ length: 20 }, () => ".........."),
      active: "T",
      hold: null,
      next: ["I", "L", "J", "O", "S", "Z"],
      run: {
        cycle: pcIndex === 0 ? 1 : 2,
        pcCount: pcIndex,
        piecesLockedSinceLastPc: pieceInPc,
        linesSinceLastPc: 0,
        status: "playing",
        message: "",
      },
    },
    ...(pieceInPc === 0 ? {} : {
      placement: {
        piece: "T", orientation: "N", x: 3, y: 0,
        cells: [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }, { x: 4, y: 1 }],
        clearedLines: 0, perfectClear: false,
      },
    }),
  };
}

function timeline(): ReplayTimeline {
  const frames = [frame(0, 0), frame(0, 9), frame(0, 10), frame(1, 0), frame(1, 1)];
  return {
    createdAt: "2026-08-24T00:00:00.000Z",
    seed: "gif-range",
    length: frames.length,
    segments: [
      { pcIndex: 0, cycle: 1, startFrame: 0, endFrame: 2, queue: [], hasTrustworthyStart: true },
      { pcIndex: 1, cycle: 2, startFrame: 3, endFrame: 4, queue: [], hasTrustworthyStart: true },
    ],
    frameAt: (position) => frames[position]!,
    nextQueueAt: () => null,
  };
}

describe("Replay GIF ranges", () => {
  it("uses the exact viewer stops and includes 10P followed by the next PC's 0P", () => {
    const replay = timeline();
    const range = defaultReplayGifRange(replay, 1);
    expect(range).toEqual({ startPosition: 0, endPosition: 3 });
    expect(replayGifPositions(range, replay.length)).toEqual([0, 1, 2, 3]);
    expect(replayGifStops(replay).map(({ label }) => label)).toEqual([
      "PC 1 · 0P", "PC 1 · 9P", "PC 1 · 10P", "PC 2 · 0P", "PC 2 · 1P",
    ]);
  });

  it("ends at the final recorded stop when there is no following PC", () => {
    expect(defaultReplayGifRange(timeline(), 4)).toEqual({ startPosition: 3, endPosition: 4 });
  });

  it("resolves directly entered PC and placement endpoints", () => {
    expect(resolveReplayGifInputRange(timeline(), {
      startPcNumber: 1,
      startPieceInPc: 9,
      endPcNumber: 2,
      endPieceInPc: 0,
    })).toEqual({ startPosition: 1, endPosition: 3 });
  });

  it("falls an invalid start back to the beginning and an invalid end back to the end", () => {
    expect(resolveReplayGifInputRange(timeline(), {
      startPcNumber: 50,
      startPieceInPc: 0,
      endPcNumber: 79,
      endPieceInPc: 0,
    })).toEqual({ startPosition: 0, endPosition: 4 });
    expect(resolveReplayGifInputRange(timeline(), {
      startPcNumber: 1,
      startPieceInPc: 8,
      endPcNumber: 2,
      endPieceInPc: 99,
    })).toEqual({ startPosition: 0, endPosition: 4 });
  });

  it("rejects reversed and out-of-bounds ranges", () => {
    expect(() => replayGifPositions({ startPosition: 2, endPosition: 1 }, 5)).toThrow("invalid");
    expect(() => replayGifPositions({ startPosition: 0, endPosition: 5 }, 5)).toThrow("invalid");
  });

  it("uses one user-selected delay rounded to GIF centiseconds", () => {
    expect(normalizeReplayGifFrameMs(203)).toBe(200);
    expect(normalizeReplayGifFrameMs(1)).toBe(20);
    expect(normalizeReplayGifFrameMs(8_000)).toBe(5_000);
  });
});
