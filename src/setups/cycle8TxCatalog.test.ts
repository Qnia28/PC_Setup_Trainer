import { describe, expect, it } from "vitest";
import type { BuildPlan } from "./reachability";
import {
  cycle8TxExactClass,
  cycle8TxOqbBranch,
  cycle8TxPostBuildPredicateMatches,
  cycle8TxQueueAfterBuildPlan,
  matchingCycle8TxDirectQbEntries,
  matchingCycle8TxOqbPlans,
  type Cycle8TxQueueState,
} from "./cycle8TxCatalog";

describe("Cycle 8 T>X runtime conditions", () => {
  it("keeps T>X split into exact replacement classes", () => {
    expect(cycle8TxExactClass("T", "S")).toBe("T>S");
    expect(cycle8TxExactClass("T", "Z")).toBe("T>Z");
    expect(cycle8TxExactClass("L", "S")).toBeNull();
    expect(cycle8TxExactClass("T", "T")).toBeNull();
  });

  it("maps T-[TIL]! to HOLD plus ACTIVE/NEXT[0:1] without an off-by-one", () => {
    const state: Cycle8TxQueueState = {
      hold: "T",
      active: "I",
      next: ["L", "T", "O", "J", "Z", "S"],
    };
    expect(matchingCycle8TxDirectQbEntries("T>S", state).map(({ id }) => id))
      .toContain("cycle8-tx-til-qb-t-s");
    expect(matchingCycle8TxDirectQbEntries("T>S", { ...state, hold: "O" })).toEqual([]);
  });

  it("reads NEXT[4] from the live queue after the 1P checkpoint", () => {
    const state: Cycle8TxQueueState = {
      hold: "T",
      active: "T",
      next: ["J", "Z", "L", "O", "I", "S", "T"],
    };
    const plan = matchingCycle8TxOqbPlans("T>S", state)[0];
    expect(plan?.id).toBe("cycle8-tx-tjz-l-oqb");
    const buildPlan: BuildPlan = {
      steps: [{ action: "place", piece: "T", placementId: "t" }],
      holds: 0,
    };
    expect(cycle8TxQueueAfterBuildPlan(state, buildPlan)).toEqual({
      hold: "T",
      active: "J",
      next: ["Z", "L", "O", "I", "S", "T"],
    });
    expect(cycle8TxOqbBranch(plan!, "T>S", state, buildPlan)?.id).toBe("next-bag-s");
  });

  it("mirrors both the exact class and the staged S/Z observation", () => {
    const state: Cycle8TxQueueState = {
      hold: "T",
      active: "T",
      next: ["L", "S", "J", "O", "I", "Z", "T"],
    };
    const plan = matchingCycle8TxOqbPlans("T>Z", state)[0];
    const buildPlan: BuildPlan = {
      steps: [{ action: "place", piece: "T", placementId: "t" }],
      holds: 0,
    };
    expect(plan?.id).toBe("cycle8-tx-tjz-l-oqb");
    expect(cycle8TxOqbBranch(plan!, "T>Z", state, buildPlan)?.id).toBe("next-bag-s");
  });

  it("matches only lossless after-3P seven-piece predicates", () => {
    expect(cycle8TxPostBuildPredicateMatches("to-iz-xyo", {
      hold: "O", active: "T", next: ["Z", "I", "L", "S", "O"],
    })).toBe(true);
    expect(cycle8TxPostBuildPredicateMatches("to-iz-xyo", {
      hold: "O", active: "T", next: ["Z", "I", "L", "L", "O"],
    })).toBe(false);
    expect(cycle8TxPostBuildPredicateMatches("ti-oz-sio", {
      hold: "T", active: "I", next: ["Z", "O", "S", "I", "O"],
    })).toBe(true);
    expect(cycle8TxPostBuildPredicateMatches("tz-oi-iox", {
      hold: "T", active: "Z", next: ["I", "O", "I", "O", "L"],
    })).toBe(true);
  });
});
