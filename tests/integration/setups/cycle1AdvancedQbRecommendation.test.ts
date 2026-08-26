import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import { querySetups } from "../../../src/setups/query";

describe("Cycle 1 advanced QB recommendation integration", () => {
  it("shows an exact occupied-HOLD TO branch in the separate QB section", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold: "I",
      active: "L",
      next: ["S", "Z", "J", "T", "O"],
    });
    const qb = candidates.filter(({ qbCondition }) => qbCondition !== undefined);
    expect(qb.length).toBeGreaterThan(0);
    expect(qb.every(({ qbCondition, policy }) =>
      qbCondition === "Cycle 1 TO QB" && policy?.ruleId === "cycle1-advanced-qb-to")).toBe(true);
    expect(qb.every(({ plan }) => plan.steps
      .filter(({ action }) => action === "place")
      .every(({ piece }) => piece !== "T" && piece !== "O"))).toBe(true);
  });

  it("routes the same TO condition from a distinct HOLD-empty prefix", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold: null,
      active: "I",
      next: ["L", "S", "Z", "J", "T"],
    });
    expect(candidates.some(({ qbCondition }) => qbCondition === "Cycle 1 TO QB")).toBe(true);
    expect(candidates.filter(({ qbCondition }) => qbCondition !== undefined)
      .every(({ plan }) => plan.steps
        .filter(({ action }) => action === "place")
        .every(({ piece }) => piece !== "T" && piece !== "O"))).toBe(true);
  });

  it("does not infer an advanced QB branch from a duplicate HOLD-empty prefix", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold: null,
      active: "I",
      next: ["L", "S", "Z", "J", "I"],
    });
    expect(candidates.some(({ qbCondition }) => qbCondition?.startsWith("Cycle 1 "))).toBe(false);
  });
});
