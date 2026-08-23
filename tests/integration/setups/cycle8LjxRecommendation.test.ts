import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import { cycle8LjxExactClassForSetup } from "../../../src/setups/cycle8LjxCatalog";
import { querySetups } from "../../../src/setups/query";

describe("Cycle 8 L/J>X recommendation integration", () => {
  it("routes exact L>O without borrowing Cycle 1", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold: "I",
      active: "L",
      next: ["S", "Z", "T", "J", "L"],
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(({ setup }) => setup.cycle === 8)).toBe(true);
    expect(candidates.every(({ setup }) => cycle8LjxExactClassForSetup(setup) === "L>O")).toBe(true);
  });

  it("mirrors the declared L>S basis into exact J>Z", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold: "I",
      active: "J",
      next: ["T", "O", "L", "S", "J"],
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(({ setup }) => cycle8LjxExactClassForSetup(setup) === "J>Z")).toBe(true);
    expect(candidates.every(({ setup }) => setup.id.includes("--mirror"))).toBe(true);
  });
});
