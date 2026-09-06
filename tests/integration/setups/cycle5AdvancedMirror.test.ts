import { describe, expect, it } from "vitest";
import { createBoard, placeCells } from "../../../src/engine/board";
import type { Piece } from "../../../src/engine/types";
import { promotedCycle5AdvancedBundleForPair } from "../../../src/setups/cycle5AdvancedCatalog";
import { querySetups } from "../../../src/setups/query";
import { mirrorPiece, mirrorSetup } from "../../../src/setups/mirror";
import { resolveOqbProgress } from "../../../src/setups/oqbProgress";
import type { SetupCandidate } from "../../../src/setups/query";

describe("Cycle 5 promoted conditional mirrors", () => {
  it("carries LJ mirror orientation from initial BFS through every reveal branch and colored solution shadow", () => {
    const bundle = promotedCycle5AdvancedBundleForPair(["L", "J"])!;
    const plans = bundle.policy.entries.filter(e => e.kind === "oqb" && e.id.endsWith("--mirror"));
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      if (plan.kind !== "oqb") throw Error("expected OQB");
      const original = bundle.catalog.find(s => s.id === plan.preconditionSetupId)!;
      const precondition = mirrorSetup(original);
      const candidate: SetupCandidate = { setup: precondition, plan: { steps: [], holds: 0 }, score: [], reasons: [],
        policy: { ruleId: plan.id, branchId: "precondition", preferred: true } };
      const board = precondition.placements.reduce((b, p) => placeCells(b, p.cells, p.piece), createBoard());
      for (const branch of plan.branches) {
        const observed = mirrorPiece(branch.observedPieces![0]!);
        const result = resolveOqbProgress({ selectedCandidate: candidate,
          query: { cycle: 5, board, hold: "L", active: "J", next: ["T", "O", "I", "S", observed], holdAvailable: true },
          policyOverride: { bundle: bundle.policy, catalog: bundle.catalog, sourceId: bundle.bundleId },
        });
        expect(result, plan.id).toMatchObject({ status: "continuation", branchId: branch.id, observation: { piece: observed, uiSlot: "NEXT[4]" } });
        if (result.status !== "continuation") continue;
        const ref = branch.continuationSetupRefs[0]!;
        const target = bundle.catalog.find(s => s.id === ref.setupId)!;
        expect(result.continuations[0]?.setup.placements).toEqual(mirrorSetup(target).placements);
      }
    }
    const entry = plans.find(p => p.id === "lj5-advanced-oqb-lsz-ij--mirror")!;
    const selected = { ...bundle, policy: { ...bundle.policy, entries: [entry] } };
    const initial = querySetups({ cycle: 5, board: createBoard(), hold: "L", active: "J", next: ["J", "Z", "S", "I", "L"], holdAvailable: true },
      { mode: "selected-bundles", bundles: [selected] });
    expect(initial[0]?.policy?.ruleId).toBe(entry.id);
    expect(initial[0]?.setup.derivedVariant).toBe("mirror");
  });
  it.each([
    ["TI", "ti5-advanced-direct-004", "TIJOS", "ti-001"],
    ["TI", "ti5-advanced-direct-005", "TIZOJ", "ti-002"],
    ["TI", "ti5-advanced-direct-006", "TJSOI", "ti-003"],
    ["TI", "ti5-advanced-direct-006", "IJSOT", "ti-003"],
    ["TI", "ti5-advanced-direct-011", "TOIZL", "ti-008"],
    ["TO", "to5-advanced-direct-007", "TJZOI", "to-002"],
    ["LJ", "lj5-advanced-single-2", "IZTOL", "lj-002"],
    ["LJ", "lj5-advanced-single-4", "TOZIL", "lj-004"],
    ["LJ", "lj5-advanced-single-5", "OJSIT", "lj-005"],
    ["OI", "oi5-advanced-rule-085", "OJTSL", "oi-002"],
    ["OI", "oi5-advanced-rule-088", "OIZTL", "oi-004"],
    ["LJ", "lj5-advanced-oil-oij-1--mirror", "OIJTS", "lj-003"],
  ])("selects the exact mirrored geometry for %s / %s / %s", (pair, rule, next, suffix) => {
    const bundle = promotedCycle5AdvancedBundleForPair([...pair] as Piece[])!;
    bundle.policy = { ...bundle.policy, entries: bundle.policy.entries.filter(e => e.id === rule) };
    expect(bundle.policy.entries).toHaveLength(1);
    for (const [hold, active] of [[...pair], [...pair].reverse()]) {
      const result = querySetups({ cycle: 5, board: createBoard(), hold: hold as Piece, active: active as Piece,
        next: [...next] as Piece[], holdAvailable: true }, { mode: "selected-bundles", bundles: [bundle] });
      const id = `cycle5-advanced-${suffix}-f000`;
      expect(result.map(c => c.setup.id)).toEqual([`${id}--mirror`]);
      const original = bundle.catalog.find(s => s.id === id)!;
      expect(result[0]?.setup.placements).toEqual(mirrorSetup(original).placements);
    }
  });

  it("preserves class mirroring of TL conditions and post-build HOLD/ACCESS pieces", () => {
    const tl = promotedCycle5AdvancedBundleForPair(["T", "L"])!;
    const tj = promotedCycle5AdvancedBundleForPair(["T", "J"])!;
    // Synthetic chiral availability isolates the runtime-direction mapping;
    // actual source availability for this production rule is T, not S.
    const original = tl.policy.entries.find(e => e.id === "tltj5-advanced-qb-tls-tjz")!;
    if (original.kind !== "direct") throw Error("missing direct rule");
    const entry = { ...original, postBuildAvailability: { ...original.postBuildAvailability!, pieces: ["S" as Piece] } };
    for (const bundle of [tl, tj]) bundle.policy = { ...bundle.policy, entries: [entry] };
    const state = { cycle: 5 as const, board: createBoard(), hold: "T" as Piece, active: "L" as Piece,
      next: ["T", "L", "S", "O", "I"] as Piece[], holdAvailable: true };
    const left = querySetups(state, { mode: "selected-bundles", bundles: [tl] });
    const right = querySetups({ ...state, active: "J", next: state.next.map(mirrorPiece) }, { mode: "selected-bundles", bundles: [tj] });
    expect(left).not.toHaveLength(0);
    expect(right).not.toHaveLength(0);
    expect(left[0]?.postBuildAvailability?.pieces).toEqual(["S"]);
    expect(right[0]?.postBuildAvailability?.pieces).toEqual(["Z"]);
    expect(right[0]?.setup.placements).toEqual(mirrorSetup(left[0]!.setup).placements);
  });
});
