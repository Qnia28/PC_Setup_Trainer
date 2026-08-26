import { describe, expect, it } from "vitest";
import { createBoard } from "../engine/board";
import { cycle1QueueContext } from "./cycle1Context";
import {
  cycle1AdvancedQbCatalogForEntry,
  cycle1AdvancedQbMetaForSetup,
  cycle1AdvancedQbObservation,
  cycle1AdvancedQbRuntimeBundle,
  matchingCycle1AdvancedQbEntry,
} from "./cycle1AdvancedQbCatalog";
import type { SetupQuery } from "./query";

function query(overrides: Partial<SetupQuery> = {}): SetupQuery {
  return {
    cycle: 1,
    board: createBoard(),
    hold: "I",
    active: "L",
    next: ["S", "Z", "J", "T", "O"],
    ...overrides,
  };
}

describe("Cycle 1 advanced QB runtime catalog", () => {
  it("activates exactly 75 physical geometries across all 42 ordered pair branches", () => {
    const bundle = cycle1AdvancedQbRuntimeBundle();
    expect(bundle).not.toBeNull();
    expect(bundle?.setups).toHaveLength(75);
    expect(bundle?.policy.entries).toHaveLength(42);
    expect(new Set(bundle?.policy.entries.map(({ unorderedPair }) => unorderedPair.join(""))).size).toBe(21);
  });

  it("separates the occupied-HOLD build window from NEXT[3:4] observation", () => {
    const input = query();
    const context = cycle1QueueContext(input)!;
    expect(cycle1AdvancedQbObservation(input, context)).toEqual({
      orderedLastTwo: ["T", "O"],
      basis: "hold-occupied",
      buildNext: ["S", "Z", "J"],
      placeableNextCount: 3,
    });
    expect(matchingCycle1AdvancedQbEntry(input, context)?.id).toBe("cycle1-advanced-qb-to");
  });

  it("uses NEXT[4] plus the unique hidden complement when HOLD is empty", () => {
    const input = query({ hold: null, active: "I", next: ["L", "S", "Z", "J", "T"] });
    const context = cycle1QueueContext(input)!;
    expect(cycle1AdvancedQbObservation(input, context)).toEqual({
      orderedLastTwo: ["T", "O"],
      basis: "hold-empty-inferred-complement",
      buildNext: ["L", "S", "Z", "J"],
      placeableNextCount: 4,
    });
  });

  it("fails closed when the HOLD-empty prefix cannot prove one complement", () => {
    const input = query({ hold: null, active: "I", next: ["L", "S", "Z", "J", "I"] });
    const context = cycle1QueueContext(input)!;
    expect(context.classificationMode).toBe("unsupported-bag-window");
    expect(cycle1AdvancedQbObservation(input, context)).toBeNull();
    expect(matchingCycle1AdvancedQbEntry(input, context)).toBeNull();
  });

  it("compiles fixed-left SRS exceptions and box expansion without flattening branches", () => {
    const bundle = cycle1AdvancedQbRuntimeBundle()!;
    const oj = bundle.policy.entries.find(({ id }) => id === "cycle1-advanced-qb-oj")!;
    const ojCatalog = cycle1AdvancedQbCatalogForEntry(oj);
    const fixedLeft = ojCatalog.find(({ id }) => id === "cycle1-advanced-qb-014-f000")!;
    expect(cycle1AdvancedQbMetaForSetup(fixedLeft)?.ref).toMatchObject({
      transform: "identity",
      transformRule: "fixed-left-srs-exception",
    });

    const oz = bundle.policy.entries.find(({ id }) => id === "cycle1-advanced-qb-oz")!;
    const boxVariants = cycle1AdvancedQbCatalogForEntry(oz).filter(({ id }) =>
      id.startsWith("cycle1-advanced-qb-072-f000--mirror--box-"));
    expect(boxVariants.length).toBeGreaterThan(1);
    expect(boxVariants.every((setup) =>
      cycle1AdvancedQbMetaForSetup(setup)?.ref.boxMode === "all-wall-minimals")).toBe(true);
  });

  it("retains both independent item 051 GIF geometries in the same logical rank", () => {
    const entry = cycle1AdvancedQbRuntimeBundle()!.policy.entries
      .find(({ id }) => id === "cycle1-advanced-qb-is")!;
    const ids = entry.candidateGroups.flat().map(({ setupId }) => setupId);
    expect(ids).toContain("cycle1-advanced-qb-051-f000");
    expect(ids).toContain("cycle1-advanced-qb-051-f001");
  });

  it("keeps branch-specific ranks isolated when the same geometry serves both orders", () => {
    const entries = cycle1AdvancedQbRuntimeBundle()!.policy.entries;
    const toSetup = cycle1AdvancedQbCatalogForEntry(entries.find(({ id }) => id === "cycle1-advanced-qb-to")!)
      .find(({ id }) => id === "cycle1-advanced-qb-004-f000")!;
    const otSetup = cycle1AdvancedQbCatalogForEntry(entries.find(({ id }) => id === "cycle1-advanced-qb-ot")!)
      .find(({ id }) => id === "cycle1-advanced-qb-004-f000")!;
    expect(cycle1AdvancedQbMetaForSetup(toSetup)?.entry.id).toBe("cycle1-advanced-qb-to");
    expect(cycle1AdvancedQbMetaForSetup(otSetup)?.entry.id).toBe("cycle1-advanced-qb-ot");
    expect(cycle1AdvancedQbMetaForSetup(toSetup)?.ref.rankGroup).toBe(3);
    expect(cycle1AdvancedQbMetaForSetup(otSetup)?.ref.rankGroup).toBe(1);
  });
});
