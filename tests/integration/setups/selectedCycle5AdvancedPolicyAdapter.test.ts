import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import rawPromotedIlijPolicy from "../../../setups/QB/cycle-5-advanced-ilij-policy.json";
import rawPromotedIsizPolicy from "../../../setups/QB/cycle-5-advanced-isiz-policy.json";
import rawPromotedIsizSetups from "../../../setups/QB/cycle-5-advanced-isiz-setups.json";
import rawPromotedOlojPolicy from "../../../setups/QB/cycle-5-advanced-oloj-policy.json";
import rawPromotedOiPolicy from "../../../setups/QB/cycle-5-advanced-oi-policy.json";
import rawPromotedTiPolicy from "../../../setups/QB/cycle-5-advanced-ti-policy.json";
import rawPromotedTltjPolicy from "../../../setups/QB/cycle-5-advanced-tltj-policy.json";
import rawPromotedToPolicy from "../../../setups/QB/cycle-5-advanced-to-policy.json";
import rawPromotedTstzPolicy from "../../../setups/QB/cycle-5-advanced-tstz-policy.json";
import rawPromotedOiSetups from "../../../setups/QB/cycle-5-advanced-oi-setups.json";
import {
  observeCycle5AdvancedOqb,
  type Cycle5AdvancedPolicyBundle,
} from "../../../src/setups/cycle5AdvancedPolicy";
import { promotedCycle5AdvancedBundleForPair } from "../../../src/setups/cycle5AdvancedCatalog";
import { querySetups, type SetupQuery } from "../../../src/setups/query";
import type { SelectedRecommendationScope } from "../../../src/setups/recommendationScope";
import { normalizeSelectedCycle5AdvancedPolicy } from "../../../src/setups/selectedCycle5AdvancedPolicyAdapter";
import type { SetupVariant } from "../../../src/setups/schema";

describe("promoted Cycle 5 advanced policy integration", () => {
  it("normalizes every promoted advanced policy bundle", () => {
    for (const [sourceId, rawPolicy] of [
      ["oi", rawPromotedOiPolicy],
      ["ilij", rawPromotedIlijPolicy],
      ["isiz", rawPromotedIsizPolicy],
      ["oloj", rawPromotedOlojPolicy],
      ["tltj", rawPromotedTltjPolicy],
      ["ti", rawPromotedTiPolicy],
      ["to", rawPromotedToPolicy],
      ["tstz", rawPromotedTstzPolicy],
    ] as const) {
      const policy = normalizeSelectedCycle5AdvancedPolicy(rawPolicy, `promoted:${sourceId}`);
      expect(policy.classId).toBe(sourceId);
      expect(policy.entries.length).toBeGreaterThan(0);
    }
  });

  it("preserves every IS/IZ condition-level bestsave value, including OQB plans", () => {
    const policy = normalizeSelectedCycle5AdvancedPolicy(rawPromotedIsizPolicy, "promoted:isiz");
    const counts = policy.entries.reduce((result, entry) => {
      if (entry.bestsave === true) result.true += 1;
      else if (entry.bestsave === false) result.false += 1;
      else result.missing += 1;
      return result;
    }, { true: 0, false: 0, missing: 0 });

    expect(counts).toEqual({ true: 87, false: 77, missing: 0 });
    expect(policy.entries.filter(({ kind }) => kind === "oqb")).toHaveLength(6);
    const plan = policy.entries.find(({ id }) => id === "isiz5-advanced-oqb-isz-to");
    expect(plan?.kind).toBe("oqb");
    if (plan?.kind !== "oqb") return;
    expect(observeCycle5AdvancedOqb(plan, {
      hold: "I",
      active: "S",
      next: ["I", "S", "Z", "T", "L"],
    })).toMatchObject({
      status: "matched",
      decision: { bestsave: true },
    });
  });

  it("activates the promoted IS/IZ bundle for both source and mirrored pairs", () => {
    expect(promotedCycle5AdvancedBundleForPair(["I", "S"])).toMatchObject({ runtimeMirror: false });
    expect(promotedCycle5AdvancedBundleForPair(["I", "Z"])).toMatchObject({ runtimeMirror: true });
  });

  it("preserves and activates the promoted OL/OJ direct and staged policy", () => {
    const policy = normalizeSelectedCycle5AdvancedPolicy(rawPromotedOlojPolicy, "promoted:oloj");
    const counts = policy.entries.reduce((result, entry) => {
      if (entry.bestsave === true) result.true += 1;
      else if (entry.bestsave === false) result.false += 1;
      else result.missing += 1;
      return result;
    }, { true: 0, false: 0, missing: 0 });
    const oqb = policy.entries.filter(({ kind }) => kind === "oqb");
    const jBeforeS = policy.entries.find(({ id }) => id === "oloj5-advanced-ljs-7");
    const sBeforeJ = policy.entries.find(({ id }) => id === "oloj5-advanced-ljs-8");

    expect(policy.entries).toHaveLength(188);
    expect(counts).toEqual({ true: 99, false: 89, missing: 0 });
    expect(oqb).toHaveLength(20);
    expect(oqb.reduce((sum, plan) => sum + (plan.kind === "oqb" ? plan.branches.length : 0), 0))
      .toBe(40);
    expect(policy.entries.filter((entry) => entry.kind === "direct" && entry.directTwoLinePc))
      .toHaveLength(12);
    expect(jBeforeS).toMatchObject({ kind: "direct", bestsave: false });
    expect(sBeforeJ).toMatchObject({ kind: "direct", bestsave: false });
    expect(jBeforeS?.kind === "direct" && jBeforeS.alternatives.some(({ setupRefs }) =>
      setupRefs.some(({ setupId }) => setupId === "cycle5-advanced-oloj-053-f000")))
      .toBe(true);
    expect(sBeforeJ?.kind === "direct" && sBeforeJ.alternatives.some(({ setupRefs }) =>
      setupRefs.some(({ setupId }) => setupId === "cycle5-advanced-oloj-059-f000")))
      .toBe(true);
    expect(promotedCycle5AdvancedBundleForPair(["O", "L"])).toMatchObject({ runtimeMirror: false });
    expect(promotedCycle5AdvancedBundleForPair(["O", "J"])).toMatchObject({ runtimeMirror: true });
  });

  it.each([
    {
      planId: "isiz5-advanced-oqb-isz-to",
      next: ["I", "S", "Z", "T", "O"] as SetupQuery["next"],
      setupId: "cycle5-advanced-isiz-010-f000",
      bestsave: true,
    },
    {
      planId: "isiz5-advanced-oqb-tis-lo",
      next: ["T", "I", "S", "L", "O"] as SetupQuery["next"],
      setupId: "cycle5-advanced-isiz-022-f000",
      bestsave: false,
    },
    {
      planId: "isiz5-advanced-oqb-tis-oj",
      next: ["T", "I", "S", "O", "J"] as SetupQuery["next"],
      setupId: "cycle5-advanced-isiz-025-f000",
      bestsave: false,
    },
    {
      planId: "isiz5-advanced-oqb-tis-lj",
      next: ["T", "I", "S", "L", "J"] as SetupQuery["next"],
      setupId: "cycle5-advanced-isiz-022-f000",
      bestsave: false,
    },
    {
      planId: "isiz5-advanced-oqb-oil-liosj",
      next: ["L", "I", "O", "S", "J"] as SetupQuery["next"],
      setupId: "cycle5-advanced-isiz-022-f000",
      bestsave: true,
    },
    {
      planId: "isiz5-advanced-oqb-ils-to",
      next: ["I", "L", "S", "T", "O"] as SetupQuery["next"],
      setupId: "cycle5-advanced-isiz-022-f000",
      bestsave: false,
    },
  ])("routes $planId before its direct fallback", ({ planId, next, setupId, bestsave }) => {
    const policy = normalizeSelectedCycle5AdvancedPolicy(rawPromotedIsizPolicy, "promoted:isiz");
    const query: SetupQuery = {
      cycle: 5,
      board: createBoard(),
      hold: "I",
      active: "S",
      next,
      holdAvailable: true,
    };
    const scope: SelectedRecommendationScope = {
      mode: "selected-bundles",
      bundles: [{
        bundleId: "promoted:isiz-explicit",
        kind: "cycle5-advanced",
        cycle: 5,
        catalog: rawPromotedIsizSetups as unknown as SetupVariant[],
        policy,
      }],
    };

    expect(querySetups(query, scope)).toMatchObject([{
      setup: {
        id: setupId,
        bestsave,
      },
      policy: {
        ruleId: planId,
        branchId: "precondition",
      },
      qbCondition: planId,
    }]);
  });

  it("preserves the promoted nested checkpoint contract", () => {
    const policy = normalizeSelectedCycle5AdvancedPolicy(rawPromotedTiPolicy, "promoted:ti");
    const plan = policy.entries.find(({ id }) => id === "ti5-toi-lj-slow-o");
    expect(plan?.kind).toBe("oqb");
    if (plan?.kind !== "oqb") return;
    expect(plan.branches[0]?.postCheckpoint?.branches).toMatchObject([
      {
        observedPieces: ["Z"],
        continuationSetupRefs: [{ setupId: "cycle5-advanced-ti-solution-016-f000" }],
      },
      {
        fallback: true,
        action: { piece: "O", resultingPieceCount: 4 },
      },
    ]);
  });

  it("binds TI [TLJ]!IS to NEXT[4] and keeps O/Z reveal branches executable", () => {
    const policy = normalizeSelectedCycle5AdvancedPolicy(rawPromotedTiPolicy, "promoted:ti");
    const plan = policy.entries.find(({ id }) => id === "ti5-tlj-is");
    expect(plan?.kind).toBe("oqb");
    if (plan?.kind !== "oqb") return;

    expect(plan.observation).toEqual({ kind: "reveal", uiSlot: "NEXT[4]" });
    for (const [piece, branchId] of [
      ["O", "ti5-tlj-is-branch-1"],
      ["Z", "ti5-tlj-is-branch-2"],
    ] as const) {
      expect(observeCycle5AdvancedOqb(plan, {
        hold: "T",
        active: "I",
        next: ["T", "L", "J", "I", piece],
      })).toMatchObject({
        status: "matched",
        observation: { piece, uiSlot: "NEXT[4]" },
        decision: { branchId },
      });
    }
  });

  it("compiles OI T[LJ]!IO as T-to-4P and every other reveal as terminal 3P", () => {
    const policy = normalizeSelectedCycle5AdvancedPolicy(rawPromotedOiPolicy, "promoted:oi");
    const plan = policy.entries.find(({ id }) => id === "oi5-advanced-oqb-tlj-io-last-t");
    expect(plan?.kind).toBe("oqb");
    if (plan?.kind !== "oqb") return;

    expect(plan.observation).toEqual({ kind: "reveal", uiSlot: "NEXT[4]" });
    expect(plan.branches).toMatchObject([
      {
        observedPieces: ["T"],
        continuationSetupRefs: [{ setupId: "cycle5-advanced-oi-052-f000" }],
      },
      {
        id: "oi5-advanced-oqb-tlj-io-last-t-branch-2-terminal-3p",
        observedPieces: ["O", "I", "L", "J", "S", "Z"],
        continuationSetupRefs: [],
        terminal: true,
      },
    ]);
  });

  it("keeps [TOS]! and mirrored [TOZ]! hidden-piece plans distinct", () => {
    const policy = normalizeSelectedCycle5AdvancedPolicy(rawPromotedOiPolicy, "promoted:oi");
    const tos = policy.entries.find(({ id }) => id === "oi5-advanced-oqb-tos-hidden-last");
    const toz = policy.entries.find(({ id }) => id === "oi5-advanced-oqb-toz-hidden-last");
    expect(tos?.kind).toBe("oqb");
    expect(toz?.kind).toBe("oqb");
    if (tos?.kind !== "oqb" || toz?.kind !== "oqb") return;

    expect(tos.observation).toEqual({
      kind: "hidden-bag-piece",
      knownRemainingBagPieces: ["I", "L", "J", "Z"],
      visibleCountFromThatSet: 3,
    });
    expect(toz.observation).toEqual({
      kind: "hidden-bag-piece",
      knownRemainingBagPieces: ["I", "L", "J", "S"],
      visibleCountFromThatSet: 3,
    });
    expect(toz.branches).toMatchObject([
      {
        observedPieces: ["I", "J"],
        continuationSetupRefs: [{
          setupId: "cycle5-advanced-oi-009-f000",
          transform: "mirror-x",
        }],
      },
      {
        observedPieces: ["L"],
        continuationSetupRefs: [{
          setupId: "cycle5-advanced-oi-010-f000",
          transform: "mirror-x",
        }],
      },
      {
        observedPieces: ["S"],
        continuationSetupRefs: [{
          setupId: "cycle5-advanced-oi-011-f000",
          transform: "mirror-x",
        }],
      },
    ]);
    expect(observeCycle5AdvancedOqb(toz, {
      hold: "O",
      active: "L",
      next: ["J", "S", "T", "O"],
    })).toMatchObject({
      status: "matched",
      observation: { piece: "I", source: "hidden-bag-piece" },
      decision: {
        continuationSetupRefs: [{
          setupId: "cycle5-advanced-oi-009-f000",
          transform: "mirror-x",
        }],
      },
    });
  });

  it("preserves condition-level bestsave decisions in the corrected promoted policies", () => {
    const tstz = normalizeSelectedCycle5AdvancedPolicy(rawPromotedTstzPolicy, "promoted:tstz");
    expect(tstz.entries.map(({ id }) => id)).not.toContain("tstz5-advanced-direct-045");
    expect(tstz.entries.map(({ id }) => id)).not.toContain("tstz5-advanced-direct-046");
    expect(tstz.entries.filter(({ id }) => id.startsWith("tstz5-advanced-til-")))
      .toMatchObject([
        { id: "tstz5-advanced-til-1", kind: "direct", bestsave: false },
        { id: "tstz5-advanced-til-2", kind: "direct", bestsave: true },
      ]);
    expect(tstz.entries.filter(({ id }) => id.startsWith("tstz5-advanced-tsz-")))
      .toMatchObject([
        { id: "tstz5-advanced-tsz-1", kind: "direct", bestsave: true },
        { id: "tstz5-advanced-tsz-2", kind: "direct", bestsave: false },
      ]);

    const to = normalizeSelectedCycle5AdvancedPolicy(rawPromotedToPolicy, "promoted:to");
    expect(to.entries.filter(({ id }) => id.startsWith("to5-advanced-tlj-forced-save-failure-")))
      .toMatchObject([
        { id: "to5-advanced-tlj-forced-save-failure-1", kind: "direct", bestsave: false },
        { id: "to5-advanced-tlj-forced-save-failure-2", kind: "direct", bestsave: false },
      ]);

    const ti = normalizeSelectedCycle5AdvancedPolicy(rawPromotedTiPolicy, "promoted:ti");
    const tljio = ti.entries.find(({ id }) => id === "ti5-tljio");
    expect(tljio?.kind).toBe("oqb");
    if (tljio?.kind !== "oqb") return;
    expect(tljio.branches).toMatchObject([
      { id: "ti5-tljio-branch-1", observedPieces: ["S"], bestsave: true },
      { id: "ti5-tljio-branch-2", observedPieces: ["Z"], bestsave: false },
    ]);
  });

  it("routes the promoted OI selected bundle through the production recommendation path", () => {
    const query: SetupQuery = {
      cycle: 5,
      board: createBoard(),
      hold: "I",
      active: "O",
      next: ["I", "Z", "L", "J", "O"],
      holdAvailable: true,
    };
    const scope: SelectedRecommendationScope = {
      mode: "selected-bundles",
      bundles: [{
        bundleId: "promoted:oi",
        kind: "cycle5-advanced",
        cycle: 5,
        catalog: rawPromotedOiSetups as unknown as SetupVariant[],
        policy: rawPromotedOiPolicy as unknown as Cycle5AdvancedPolicyBundle,
      }],
    };

    expect(querySetups(query, scope)).toMatchObject([{
      setup: { id: "cycle5-advanced-oi-029-f000" },
      recommendationSource: { bundleId: "promoted:oi" },
      policy: { ruleId: "oi5-advanced-oqb-ilz-jo" },
    }]);
  });
});
