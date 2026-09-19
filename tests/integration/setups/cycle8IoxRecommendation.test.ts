import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import {
  cycle8IoxExactClassForSetup,
  cycle8IoxRuntimeEntryForSetup,
  cycle8IoxTwoLinePcPlanForSetup,
} from "../../../src/setups/cycle8IoxCatalog";
import { querySetups } from "../../../src/setups/query";

describe("Cycle 8 I>X and O>X recommendation integration", () => {
  it.each([
    ["I>L", "I", "I", ["T", "O", "J", "S", "Z"]],
    ["I>J", "I", "I", ["T", "O", "L", "S", "Z"]],
    ["O>S", "O", "O", ["T", "I", "L", "J", "Z"]],
    ["O>Z", "O", "O", ["T", "I", "L", "J", "S"]],
  ] as const)("routes the exact %s replacement class without Cycle 1 fallback", (exactClass, hold, active, next) => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold,
      active,
      next: [...next],
      maxCandidates: 100,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(({ setup }) => setup.cycle === 8)).toBe(true);
    expect(candidates.every(({ setup }) => cycle8IoxExactClassForSetup(setup) === exactClass)).toBe(true);
    expect(candidates.map(({ setup }) => cycle8IoxRuntimeEntryForSetup(setup)!.sourceOrder))
      .toEqual([...candidates.map(({ setup }) => cycle8IoxRuntimeEntryForSetup(setup)!.sourceOrder)].sort((a, b) => a - b));
  });

  it("recommends 2L by source order without flattening its probability into solveRate", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold: "O",
      active: "O",
      next: ["T", "L", "I", "J", "Z"],
      maxCandidates: 100,
    });
    const twoLine = candidates.find(({ setup }) => setup.displayName === "2L");
    expect(twoLine).toBeDefined();
    expect(twoLine?.setup.solveRate).toBeUndefined();
    expect(twoLine?.setup.placements).toHaveLength(5);
    expect(cycle8IoxTwoLinePcPlanForSetup(twoLine!.setup, "O>S")?.direction)
      .toEqual({ exactClass: "O>S", nextCycle: 5, nextClass: "TZ" });
    expect(twoLine?.reasons.join(" ")).toContain("33.33%");
  });
});
