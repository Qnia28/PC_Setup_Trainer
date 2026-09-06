import { describe, expect, it } from "vitest";
import { mirrorCycle5AdvancedDirect, mirrorCycle5AdvancedOqbInitial, mirrorCycle5AdvancedPattern } from "./cycle5AdvancedMirror";
import { normalizeSelectedCycle5AdvancedPolicy } from "./selectedCycle5AdvancedPolicyAdapter";
import type { Cycle5AdvancedDirectRule, Cycle5AdvancedQueuePattern } from "./cycle5AdvancedPolicy";

describe("Cycle 5 semantic mirroring", () => {
  it("mirrors ordered/permutation/wildcard/exclusion pieces without reversing queue order", () => {
    const pattern: Cycle5AdvancedQueuePattern = { scope: "visible-seven", parts: [
      { kind: "ordered", symbols: ["L", "J"] },
      { kind: "permutation", symbols: ["T", "L", "X"] },
      { kind: "ordered", symbols: ["S", "J"] },
    ], excludes: [{ parts: [{ kind: "ordered", symbols: ["L", "J"] }, { kind: "ordered", symbols: ["L", "S", "Z"] }] }] };
    const mirrored = mirrorCycle5AdvancedPattern(pattern);
    expect(mirrored.parts.map(p => p.symbols)).toEqual([["L", "J"], ["T", "J", "X"], ["Z", "L"]]);
    expect(mirrored.excludes?.[0]?.parts.map(p => p.symbols)).toEqual([["L", "J"], ["J", "Z", "S"]]);
    expect(mirrorCycle5AdvancedPattern(mirrored)).toEqual(pattern);
  });

  it("maps TL post-build S availability to TJ Z while retaining HOLD/ACCESS semantics", () => {
    const rule: Cycle5AdvancedDirectRule = { id: "hold-s", kind: "direct", sourceOrder: 2,
      alternatives: [{ pattern: { scope: "visible-seven", parts: [{ kind: "ordered", symbols: ["T", "L", "S"] }] },
        setupRefs: [{ setupId: "geometry", transform: "identity" }] }],
      postBuildAvailability: { checkpointPlacedCount: 4, pieces: ["S"], acceptedLocations: ["HOLD", "ACCESS"],
        locationsInterchangeable: true, canonicalEligibilityUnaffected: true },
    };
    expect(mirrorCycle5AdvancedDirect(rule)).toMatchObject({
      postBuildAvailability: { pieces: ["Z"], acceptedLocations: ["HOLD", "ACCESS"] },
      alternatives: [{ pattern: { parts: [{ symbols: ["T", "J", "Z"] }] }, setupRefs: [{ transform: "mirror-x" }] }],
    });
    expect(rule.postBuildAvailability?.pieces).toEqual(["S"]);
  });

  it("compiles explicit arrows and explicit mirrorX into geometry-bound refs, never ordinary slash alternatives", () => {
    const p = normalizeSelectedCycle5AdvancedPolicy({ cycle: 5, classId: "ti", oqbPlans: [], rules: [
      { ruleId: "arrows", canonicalCondition: { expressions: ["TI-[TIL]! (⇔ TI-[TIJ]!)", "TI-[TOI]![SX]!", "(⇔ TI-[TOI]![ZX]!)"] }, eligibleSetupIds: ["a"] },
      { ruleId: "explicit", condition: { expression: "[OJX]!" }, geometryTransform: "mirrorX", eligibleSetupIds: ["b"] },
      { ruleId: "slash", condition: { expressions: ["[IL]!J", "[IJ]!L"] }, eligibleSetupIds: ["c"] },
    ] }, "synthetic");
    expect(p.entries.map(e => e.kind === "direct" && e.alternatives.map(a => a.setupRefs[0]?.transform)))
      .toEqual([["identity", "mirror-x", "identity", "mirror-x"], ["mirror-x"], ["identity", "identity"]]);
  });

  it("expands explicit mirrored selection tables including ordered exclusions", () => {
    const p = normalizeSelectedCycle5AdvancedPolicy({ cycle: 5, classId: "lj", oqbPlans: [], selectionTables: [{
      id: "table", mirror: { primary: "[OIL]!", paired: "[OIJ]!", transform: "mirrorX",
        pieceMap: { T: "T", I: "I", O: "O", L: "J", J: "L", S: "Z", Z: "S" } },
      decisions: [
        { canonicalConditionText: "[OIL]!S", eligibleSetupIds: ["a"], bestsave: true },
        { canonicalConditionText: "all other", eligibleSetupIds: ["b"], bestsave: false },
      ],
    }] }, "synthetic");
    expect(p.entries.map(e => e.id)).toEqual(["table-1", "table-1--mirror", "table-2", "table-2--mirror"]);
    const mirroredFallback = p.entries[3];
    expect(mirroredFallback).toMatchObject({ alternatives: [{ pattern: {
      parts: [{ symbols: ["O", "I", "J"] }], excludes: [{ parts: [{ symbols: ["O", "I", "J"] }, { symbols: ["Z"] }] }],
    }, setupRefs: [{ setupId: "b", transform: "mirror-x" }] }] });
  });

  it("keeps staged predicates in the source-precondition basis for one runtime transform", () => {
    const source = { id: "plan", kind: "oqb" as const, sourceOrder: 1,
      initialPatterns: [{ scope: "next-bag-five" as const, parts: [{ kind: "ordered" as const, symbols: ["L" as const, "S" as const] }] }],
      preconditionSetupId: "one-p", checkpoint: { placedCount: 1 as const },
      observation: { kind: "hidden-bag-piece" as const, knownRemainingBagPieces: ["L" as const, "S" as const], visibleCountFromThatSet: 1 },
      branches: [{ id: "s", observedPieces: ["S" as const], continuationSetupRefs: [{ setupId: "solution", displayHoldPiece: "S" as const }] }],
    };
    const mirrored = mirrorCycle5AdvancedOqbInitial(source);
    expect(mirrored).toMatchObject({ preconditionTransform: "mirror-x", initialPatterns: [{ parts: [{ symbols: ["J", "Z"] }] }] });
    expect(mirrored.observation).toEqual(source.observation);
    expect(mirrored.branches).toEqual(source.branches);
  });
});
