import { describe, expect, it } from "vitest";
import { createBoard } from "../engine/board";
import { cycle1QueueContext, displayCycleForQuery } from "./cycle1Context";
import type { SetupQuery } from "./query";

function query(overrides: Partial<SetupQuery> = {}): SetupQuery {
  return {
    cycle: 1,
    board: createBoard(),
    hold: "I",
    active: "L",
    next: ["O", "T", "S", "Z", "J"],
    holdAvailable: true,
    ...overrides,
  };
}

describe("Cycle 1 normal-bag and replacement-cycle boundary", () => {
  it("accepts the complete normal seven-bag boundary", () => {
    expect(cycle1QueueContext(query())).toMatchObject({
      visiblePieces: ["I", "L", "O", "T", "S", "Z", "J"],
      classificationMode: "normal-seven-bag",
    });
  });

  it("classifies duplicate L with missing O as L>O and withholds Cycle 1 setups", () => {
    const replacement = query({ next: ["S", "Z", "T", "J", "L"] });
    expect(cycle1QueueContext(replacement)).toMatchObject({
      visiblePieces: ["I", "L", "S", "Z", "T", "J", "L"],
      classificationMode: "replacement-cycle",
      replacement: {
        extraPiece: "L",
        replacedPiece: "O",
        label: "L>O",
      },
    });
    expect(displayCycleForQuery(replacement)).toBe(8);
  });

  it("keeps the normal Cycle 1 window displayed as Cycle 1", () => {
    expect(displayCycleForQuery(query())).toBe(1);
  });

  it("keeps a distinct six-piece prefix valid at the initial HOLD-empty start", () => {
    const initial = query({
      hold: null,
      active: "I",
      next: ["J", "L", "O", "S", "T"],
    });
    expect(cycle1QueueContext(initial)).toMatchObject({
      visiblePieces: ["I", "J", "L", "O", "S", "T"],
      buildPieces: ["I", "J", "L", "O", "S", "T", "Z"],
      searchNext: ["J", "L", "O", "S", "T", "Z"],
      placeableNextCount: 6,
      classificationMode: "normal-seven-bag-prefix",
      inferredLastPiece: "Z",
    });
  });

  it("rejects a duplicate already visible in the HOLD-empty prefix", () => {
    const invalid = query({
      hold: null,
      active: "I",
      next: ["J", "L", "I", "S", "T"],
    });
    expect(cycle1QueueContext(invalid)?.classificationMode).toBe("unsupported-bag-window");
  });
});
