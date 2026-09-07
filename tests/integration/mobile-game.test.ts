import { describe, expect, it } from "vitest";
import { GameSession } from "../../src/engine/game";
import { occupiedCells } from "../../src/engine/pieces";
import { PIECES } from "../../src/engine/types";
import { ReplayRecorder } from "../../src/replay/recorder";
import { crc32c, decodeQpcr3Container, encodeQpcr3Container, replayInitialState, verifyReplaySemantics } from "../../src/replay/qpcr3";
import { createReplayTimeline } from "../../src/replay/timeline";

describe("mobile game and QPCR3", () => {
  it("keeps all spawns inside 10 rows across HOLD, restart, seed and queue jump", () => {
    const game = new GameSession("mobile", 10);
    for (const piece of PIECES) {
      game.debugSetQueue(piece, [piece], piece);
      expect(game.state.active.y).toBe(8);
      expect(occupiedCells(game.state.active).every(({ y }) => y < 10)).toBe(true);
      game.dispatch("hold");
      expect(game.state.active.y).toBe(8);
    }
    game.dispatch("restart");
    expect(game.state.board).toHaveLength(10);
    expect(game.state.seed).not.toBe("mobile");
    game.dispatch("randomSeed");
    expect(game.state.board).toHaveLength(10);
    game.setSeed("mobile-again");
    game.jumpToQueue("IJLOSTZ");
    expect(game.state.board).toHaveLength(10);
    expect(game.state.active.y).toBe(8);
  });

  it.each([10, 24])("round-trips %i-row play, HOLD, undo and terminal failure", (height) => {
    const game = new GameSession("mobile-roundtrip", height);
    game.dispatch("hold");
    game.dispatch("moveLeft");
    game.dispatch("hardDrop");
    const once = replayInitialState(game.state);
    game.dispatch("hold");
    game.dispatch("hardDrop");
    game.dispatch("undo");
    expect(replayInitialState(game.state)).toEqual(once);
    for (let n = 0; n < 10 && game.state.run.status === "playing"; n++) game.dispatch("hardDrop");
    expect(game.state.run.status).toBe("failed");
    const bytes = encodeQpcr3Container(new ReplayRecorder(game.placementHistory).export());
    expect(bytes[7]).toBe(height === 10 ? 1 : 0);
    const replay = decodeQpcr3Container(bytes);
    expect(replayInitialState(verifyReplaySemantics(replay))).toEqual(replayInitialState(game.state));
    expect(encodeQpcr3Container(replay)).toEqual(bytes);
    const timeline = createReplayTimeline(replay);
    expect(timeline.frameAt(timeline.length - 1).snapshot.run.status).toBe("failed");
    expect(timeline.nextQueueAt(0, 10)).toHaveLength(10);
  });

  it("rejects unknown flags and a forged desktop/mobile flag even with valid CRC", () => {
    const game = new GameSession("mobile-flags", 10);
    const bytes = encodeQpcr3Container(new ReplayRecorder(game.placementHistory).export());
    for (const flag of [0, 2]) {
      const corrupt = bytes.slice();
      corrupt[7] = flag;
      new DataView(corrupt.buffer).setUint32(corrupt.length - 4, crc32c(corrupt.subarray(0, -4)), true);
      expect(() => decodeQpcr3Container(corrupt)).toThrow();
    }
  });
});
