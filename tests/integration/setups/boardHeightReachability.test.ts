import { describe, expect, it } from "vitest";
import { createBoard, hardDropY } from "../../../src/engine/board";
import { occupiedCells, spawnPiece } from "../../../src/engine/pieces";
import { PIECES } from "../../../src/engine/types";
import { canReachPlacement, findBuildPlan, findBuildPlanCooperative } from "../../../src/setups/reachability";
import type { SetupVariant } from "../../../src/setups/schema";

describe("recommendation BFS uses the game board's spawn height", () => {
  it.each([8, 10, 24])("finds grounded placements for every piece on a %i-row board", async (height) => {
    const board = createBoard(height);
    for (const piece of PIECES) {
      const active = spawnPiece(piece, height);
      const target = { id: `floor-${piece}`, piece, cells: occupiedCells({ ...active, y: hardDropY(board, active) }) };
      const setup: SetupVariant = {
        id: target.id, cycle: 1, family: "spawn-height-regression", displayName: target.id,
        pieceSignature: [piece], placements: [target], difficulty: 1, reviewStatus: "reviewed",
      };
      const expected = { holds: 0, steps: [{ action: "place", piece, placementId: target.id }] };
      expect(canReachPlacement(board, piece, target)).toBe(true);
      expect(findBuildPlan(setup, board, piece, null, [])).toEqual(expected);
      expect(await findBuildPlanCooperative(setup, board, piece, null, [], true, 0, new Map(), {
        onNode: () => Promise.resolve(),
      })).toEqual(expected);
    }
  });

  it("rejects a blocked compact spawn without reusing a desktop cache result", async () => {
    const setup: SetupVariant = {
      id: "blocked-spawn", cycle: 1, family: "spawn-height-regression", displayName: "Blocked spawn",
      pieceSignature: ["O"], difficulty: 1, reviewStatus: "reviewed",
      placements: [{ id: "floor-o", piece: "O", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }],
    };
    const cache = new Map<string, boolean>();
    for (const height of [24, 10]) {
      const board = createBoard(height);
      board[8]![4] = "X";
      const plan = findBuildPlan(setup, board, "O", null, [], true, 0, cache);
      expect(plan !== null).toBe(height === 24);
      const cooperative = await findBuildPlanCooperative(setup, board, "O", null, [], true, 0, new Map(), { onNode() {} });
      expect(cooperative !== null).toBe(height === 24);
    }
  });
});
