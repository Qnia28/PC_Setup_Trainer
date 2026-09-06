import { describe, expect, it, vi } from "vitest";
import { createGameState } from "../engine/game";
import type { Piece } from "../engine/types";
import { snapshotFromGameState } from "./format";
import { segmentForFrame, type ReplayPcSegment } from "./navigation";
import {
  loadReplayRecommendations,
  nextReplayRecommendationSelection,
  recommendationInputForSegment,
} from "./recommendationController";
import type { ReplayTimeline } from "./timeline";
import type { ReplayFrame } from "./schema";

function fixture() {
  const state = createGameState("replay-recommendation-anchor");
  const frame: ReplayFrame = { kind: "pc-start", pcIndex: 0, cycle: 1, pieceInPc: 0, snapshot: snapshotFromGameState(state) };
  const segment: ReplayPcSegment = {
    pcIndex: 0, cycle: 1, startFrame: 4, endFrame: 9,
    queue: [frame.snapshot.active, ...frame.snapshot.next].slice(0, 7),
    hasTrustworthyStart: true,
  };
  const frameAt = vi.fn((_position: number) => frame);
  const nextQueueAt = vi.fn((_position: number, count: number) => frame.snapshot.next.slice(0, count));
  const replay = { createdAt: "2026-08-08T00:00:00.000Z", seed: state.seed, length: 10, segments: [segment], frameAt, nextQueueAt } satisfies ReplayTimeline;
  return { replay, segment, frameAt };
}

describe("replay recommendation controller", () => {
  it("anchors every placement in a PC to that segment's 0P frame", () => {
    const { replay, segment, frameAt } = fixture();
    const current = segmentForFrame([segment], 8)!;
    const input = recommendationInputForSegment(replay, current);
    expect(frameAt).toHaveBeenCalledWith(4);
    expect(input).toMatchObject({ cycle: 1, active: replay.frameAt(4).snapshot.active, holdAvailable: true });
    expect(input?.next).toHaveLength(5);
  });

  it("rejects partial, untrusted, or short 0P input", () => {
    const { replay, segment } = fixture();
    expect(recommendationInputForSegment(replay, { ...segment, hasTrustworthyStart: false })).toBeNull();
    const shortReplay = { ...replay, frameAt: () => ({ ...replay.frameAt(4), snapshot: { ...replay.frameAt(4).snapshot, next: ["I"] as Piece[] } }) } satisfies ReplayTimeline;
    expect(recommendationInputForSegment(shortReplay, segment)).toBeNull();
  });

  it("does not load or query the recommendation module while disabled", async () => {
    const { replay, segment } = fixture();
    const input = recommendationInputForSegment(replay, segment);
    const loadModule = vi.fn(async () => ({ queryReplaySetupRecommendations: vi.fn(() => ["unused"]) }));
    expect(await loadReplayRecommendations(false, input, loadModule)).toBeNull();
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("preserves selection within a PC and resets it when the PC changes", () => {
    expect(nextReplayRecommendationSelection("b", "pc-1", "pc-1", ["a", "b"])).toBe("b");
    expect(nextReplayRecommendationSelection("b", "pc-1", "pc-2", ["a", "b"])).toBe("a");
    expect(nextReplayRecommendationSelection("missing", "pc-1", "pc-1", ["a"])).toBe("a");
    expect(nextReplayRecommendationSelection("b", "pc-1", "pc-2", ["a", "priority"], "priority"))
      .toBe("priority");
  });

  it("never auto-selects manual-only candidates but preserves an explicit selection", () => {
    expect(nextReplayRecommendationSelection(null, null, "pc", ["manual"], null, [])).toBeNull();
    expect(nextReplayRecommendationSelection(null, null, "pc", ["manual", "normal"], "manual", ["normal"]))
      .toBe("normal");
    expect(nextReplayRecommendationSelection("manual", "pc", "pc", ["manual"], null, [])).toBe("manual");
    expect(nextReplayRecommendationSelection("manual", "pc", "next-pc", ["manual"], null, [])).toBeNull();
  });
});
