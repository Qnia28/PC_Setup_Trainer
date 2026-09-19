import { describe, expect, it } from "vitest";
import { collides, createBoard, isLockable } from "../../../src/engine/board";
import { occupiedCells, sortedCellKey, spawnPiece } from "../../../src/engine/pieces";
import { ORIENTATIONS, PIECES, type ActivePiece, type Board, type Piece } from "../../../src/engine/types";
import { tryRotate } from "../../../src/rules/rotation";
import { setupCatalog } from "../../../src/setups/catalog";
import { canReachPlacement, findBuildPlan, findBuildPlanCooperative } from "../../../src/setups/reachability";
import { PlacementSearch, occupancyKey, sharedPlacementSearch } from "../../../src/setups/placementSearch";
import type { SetupVariant, TargetPlacement } from "../../../src/setups/schema";
import { findBuildPlan as baselinePlan } from "./fixtures/reachabilityBaseline";

// Independent, allocation-heavy engine walk. Does not call the optimized search.
function referenceLocks(board: Board, piece: Piece): Set<string> {
  const spawn = spawnPiece(piece, board.length);
  const locks = new Set<string>();
  if (collides(board, spawn)) return locks;
  const queue = [spawn];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const pose = queue[i];
    const key = `${pose.x},${pose.y},${pose.orientation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isLockable(board, pose)) locks.add(sortedCellKey(occupiedCells(pose)));
    const next: ActivePiece[] = [
      { ...pose, x: pose.x - 1 }, { ...pose, x: pose.x + 1 }, { ...pose, y: pose.y - 1 },
      tryRotate(board, pose, "CW"), tryRotate(board, pose, "CCW"), tryRotate(board, pose, "R180"),
    ];
    for (const candidate of next) if (!collides(board, candidate)) queue.push(candidate);
  }
  return locks;
}

function setup(placements: TargetPlacement[]): SetupVariant {
  return { id: "synthetic", cycle: 1, family: "test", displayName: "Test", placements,
    pieceSignature: placements.map((p) => p.piece), difficulty: 1, reviewStatus: "reviewed" };
}

describe("packed recommendation reachability", () => {
  it.each([8, 10, 24])("matches engine lock sets on %i-row fields, including roofs and blocked spawns", (height) => {
    const boards = [createBoard(height), createBoard(height), createBoard(height), createBoard(height)];
    // Uneven stack, an overhang with an enclosed pocket, and the exact spawn roof.
    for (let x = 0; x < 10; x++) for (let y = 0; y < (x * 7 + 3) % 5; y++) boards[1][y][x] = "X";
    for (let x = 0; x < 8; x++) boards[2][3][x] = "X";
    for (const cell of occupiedCells(spawnPiece("T", height))) boards[3][cell.y][cell.x] = "X";
    for (const board of boards) for (const piece of PIECES) {
      const expected = referenceLocks(board, piece);
      const search = new PlacementSearch(board, piece);
      while (!search.exhausted) search.step();
      const actual = new Set<string>();
      for (const orientation of ORIENTATIONS) for (let x = -1; x <= 10; x++) for (let y = -1; y <= height; y++) {
        const cells = occupiedCells({ piece, orientation, x, y });
        const targets = search.targets({ id: "target", piece, cells });
        if (search.reached(targets)) actual.add(sortedCellKey(cells));
      }
      expect(actual, `${height}/${piece}/${occupancyKey(board)}`).toEqual(expected);
    }
  });

  it("shares partial graphs across targets/colors, but separates heights and mutated occupancy", () => {
    const cache = new Map<string, boolean>();
    const board = createBoard(10);
    board[0][9] = "T";
    const first = sharedPlacementSearch(board, "O", cache);
    first.step();
    const colored = board.map((row) => row.map((cell) => cell === null ? null : "Z" as const));
    expect(sharedPlacementSearch(colored, "O", cache)).toBe(first);
    expect(sharedPlacementSearch(createBoard(24), "O", cache)).not.toBe(first);
    board[1][9] = "X";
    expect(sharedPlacementSearch(board, "O", cache)).not.toBe(first);
    expect(sharedPlacementSearch(board, "I", cache)).not.toBe(first);
  });

  it("preserves exact plans for a bounded physical-catalog sample", async () => {
    for (const cycle of [1, 3, 5, 6, 8]) {
      const sample = setupCatalog.filter((entry) => entry.cycle === cycle && entry.placements.length > 0).slice(0, 6);
      const beforeCache = new Map<string, boolean>();
      const afterCache = new Map<string, boolean>();
      for (const entry of sample) {
        const board = createBoard(10);
        const next: Piece[] = ["Z", "S", "O", "L", "J"];
        const expected = baselinePlan(entry, board, "I", "T", next, true, 5, beforeCache);
        expect(findBuildPlan(entry, board, "I", "T", next, true, 5, afterCache), entry.id).toEqual(expected);
        expect(await findBuildPlanCooperative(entry, board, "I", "T", next, true, 5, afterCache, { onNode() {} })).toEqual(expected);
      }
    }
  });

  it("preserves duplicate-piece, finite queue and release-only buffer behavior", async () => {
    const entry = setup([0, 1].map((i) => ({ id: `o${i}`, piece: "O", cells: occupiedCells({ piece: "O", orientation: "N", x: i * 2, y: 0 }) })));
    for (const hold of [null, "O"] as const) for (const next of [[], ["O"], ["T", "O"]] as Piece[][]) {
      for (let count = 0; count <= next.length; count++) {
        const board = createBoard(8);
        const expected = baselinePlan(entry, board, "O", hold, next, false, count);
        expect(findBuildPlan(entry, board, "O", hold, next, false, count)).toEqual(expected);
        expect(await findBuildPlanCooperative(entry, board, "O", hold, next, false, count, new Map(), { onNode: () => Promise.resolve() })).toEqual(expected);
      }
    }
  });

  it("rejects floating, overlapping and malformed targets without trusting origin metadata", () => {
    const board = createBoard(10);
    const cells = occupiedCells({ piece: "O", orientation: "N", x: 0, y: 0 });
    expect(canReachPlacement(board, "O", { id: "o", piece: "O", cells, orientation: "E", origin: { x: 7, y: 7 } })).toBe(true);
    expect(canReachPlacement(board, "O", { id: "o", piece: "O", cells: cells.map((c) => ({ ...c, y: c.y + 1 })) })).toBe(false);
    expect(canReachPlacement(board, "O", { id: "o", piece: "O", cells: [cells[0], cells[0], cells[1], cells[2]] })).toBe(false);
    board[0][0] = "X";
    expect(canReachPlacement(board, "O", { id: "o", piece: "O", cells })).toBe(false);
  });

  it("propagates cancellation and safely resumes a partially shared graph", async () => {
    const entry = setup([{ id: "o", piece: "O", cells: occupiedCells({ piece: "O", orientation: "N", x: 0, y: 0 }) }]);
    const board = createBoard(24);
    const cache = new Map<string, boolean>();
    let nodes = 0;
    await expect(findBuildPlanCooperative(entry, board, "O", null, [], true, 0, cache, {
      onNode() { if (++nodes === 5) throw new Error("cancelled"); },
    })).rejects.toThrow("cancelled");
    expect(findBuildPlan(entry, board, "O", null, [], true, 0, cache)).toEqual(baselinePlan(entry, board, "O", null, []));
  });
});
