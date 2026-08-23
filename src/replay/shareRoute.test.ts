import { describe, expect, it } from "vitest";
import type { ReplayFrame } from "./schema";
import type { ReplayTimeline } from "./timeline";
import { buildReplayShareUrl, parseReplayShareLaunch, resolveReplaySharePosition } from "./shareRoute";

const sharedFrame = {
  kind: "pc-start",
  pcIndex: 4,
  cycle: 5,
  pieceInPc: 0,
  snapshot: {
    board: Array.from({ length: 20 }, () => ".........."), active: "T", hold: null, next: [],
    run: { cycle: 5, pcCount: 4, piecesLockedSinceLastPc: 0, linesSinceLastPc: 0, status: "playing", message: "" },
  },
} satisfies ReplayFrame;

describe("Replay share links", () => {
  it("stores a portable replay in the fragment and the exact PC/P in query parameters", () => {
    const result = new URL(buildReplayShareUrl(new URL("https://example.test/replay"), "QPCR3.a-b_c", sharedFrame));
    expect(result.search).toBe("?pc=5&p=0");
    expect(new URLSearchParams(result.hash.slice(1)).get("r")).toBe("QPCR3.a-b_c");
    expect(parseReplayShareLaunch(result)).toEqual({
      target: { pcNumber: 5, pieceInPc: 0 }, replayCode: "QPCR3.a-b_c",
    });
  });

  it("keeps Jstris route links compact without embedding QPCR1", () => {
    expect(buildReplayShareUrl(new URL("https://example.test/replay/12345"), "QPCR1.large", sharedFrame))
      .toBe("https://example.test/replay/12345?pc=5&p=0");
  });

  it("resolves an exact stop and rejects an untrustworthy 0P", () => {
    const frames = [sharedFrame, { ...sharedFrame, kind: "placement", pieceInPc: 1 } as ReplayFrame];
    const replay = {
      createdAt: "2026-08-24T00:00:00.000Z", seed: "share", length: 2,
      segments: [{ pcIndex: 4, cycle: 5, startFrame: 0, endFrame: 1, queue: [], hasTrustworthyStart: true }],
      frameAt: (position: number) => frames[position]!, nextQueueAt: () => null,
    } satisfies ReplayTimeline;
    expect(resolveReplaySharePosition(replay, { pcNumber: 5, pieceInPc: 1 })).toBe(1);
    replay.segments[0]!.hasTrustworthyStart = false;
    expect(() => resolveReplaySharePosition(replay, { pcNumber: 5, pieceInPc: 0 })).toThrow("unavailable");
  });

  it("rejects incomplete and malformed target parameters", () => {
    expect(() => parseReplayShareLaunch(new URL("https://example.test/replay?pc=2"))).toThrow("invalid");
    expect(() => parseReplayShareLaunch(new URL("https://example.test/replay?pc=0&p=-1"))).toThrow("invalid");
  });
});

