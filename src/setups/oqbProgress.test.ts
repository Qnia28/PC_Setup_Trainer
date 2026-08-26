import { describe, expect, it } from "vitest";
import { createBoard, placeCells } from "../engine/board";
import type { Board, Piece } from "../engine/types";
import rawOiPolicy from "../../setups/QB/cycle-5-advanced-oi-policy.json";
import rawOiSetups from "../../setups/QB/cycle-5-advanced-oi-setups.json";
import rawTiPolicy from "../../setups/QB/cycle-5-advanced-ti-policy.json";
import rawTiSetups from "../../setups/QB/cycle-5-advanced-ti-setups.json";
import type { Cycle5AdvancedOqbPlan, Cycle5AdvancedPolicyBundle } from "./cycle5AdvancedPolicy";
import { mirrorSetup } from "./mirror";
import {
  oqbContinuationCandidates,
  resolveOqbProgress,
  type Cycle5AdvancedOqbPolicySource,
  type OqbProgressPolicyProvider,
} from "./oqbProgress";
import type { SetupCandidate, SetupQuery } from "./query";
import type { SetupVariant, TargetPlacement } from "./schema";
import { normalizeSelectedCycle5AdvancedPolicy } from "./selectedCycle5AdvancedPolicyAdapter";

const oPlacement = (id = "o", x = 0): TargetPlacement => ({
  id,
  piece: "O",
  cells: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x, y: 1 }, { x: x + 1, y: 1 }],
});

const iPlacement = (id = "i", x = 2): TargetPlacement => ({
  id,
  piece: "I",
  cells: [0, 1, 2, 3].map((dx) => ({ x: x + dx, y: 0 })),
});

const tPlacement = (id = "t", x = 5): TargetPlacement => ({
  id,
  piece: "T",
  cells: [{ x, y: 1 }, { x: x + 1, y: 1 }, { x: x + 2, y: 1 }, { x: x + 1, y: 2 }],
});

function setup(id: string, placements: TargetPlacement[]): SetupVariant {
  return {
    id,
    cycle: 5,
    family: "test",
    displayName: id,
    pieceSignature: placements.map(({ piece }) => piece).sort(),
    placements,
    difficulty: 3,
    reviewStatus: "reviewed",
  };
}

function candidate(value: SetupVariant, ruleId?: string, branchId = "initial"): SetupCandidate {
  return {
    setup: value,
    plan: {
      steps: value.placements.map(({ id, piece }) => ({ action: "place" as const, piece, placementId: id })),
      holds: 0,
    },
    score: [],
    reasons: [],
    policy: ruleId ? { ruleId, branchId, preferred: true } : undefined,
  };
}

function query(board: Board, next: Piece[] = ["S", "Z", "T", "O", "L"]): SetupQuery {
  return { cycle: 5, board, active: "I", hold: "O", next, holdAvailable: true };
}

function source(plan: Cycle5AdvancedOqbPlan, catalog: SetupVariant[]): Cycle5AdvancedOqbPolicySource {
  const bundle: Cycle5AdvancedPolicyBundle = {
    schemaVersion: 3,
    cycle: 5,
    classId: "test",
    entries: [plan],
  };
  return { bundle, catalog, sourceId: "test:selected" };
}

const realTiSource: Cycle5AdvancedOqbPolicySource = {
  bundle: normalizeSelectedCycle5AdvancedPolicy(rawTiPolicy, "promoted:ti-test"),
  catalog: rawTiSetups as unknown as SetupVariant[],
  sourceId: "promoted:ti-test",
};

const realOiSource: Cycle5AdvancedOqbPolicySource = {
  bundle: normalizeSelectedCycle5AdvancedPolicy(rawOiPolicy, "promoted:oi-test"),
  catalog: rawOiSetups as unknown as SetupVariant[],
  sourceId: "promoted:oi-test",
};

function setupById(id: string): SetupVariant {
  const value = realTiSource.catalog.find((entry) => entry.id === id);
  if (!value) throw new Error(`Missing TI fixture ${id}`);
  return value;
}

function oiSetupById(id: string): SetupVariant {
  const value = realOiSource.catalog.find((entry) => entry.id === id);
  if (!value) throw new Error(`Missing OI fixture ${id}`);
  return value;
}

function boardForSetup(value: SetupVariant): Board {
  let board = createBoard();
  for (const placement of value.placements) board = placeCells(board, placement.cells, placement.piece);
  return board;
}

function revealPlan(preconditionSetupId = "pre"): Cycle5AdvancedOqbPlan {
  return {
    id: "reveal-plan",
    kind: "oqb",
    sourceOrder: 1,
    initialPatterns: [],
    preconditionSetupId,
    checkpoint: { placedCount: 1 },
    observation: { kind: "reveal", uiSlot: "NEXT[4]" },
    branches: [{
      id: "reveal-l",
      observedPieces: ["L"],
      continuationSetupRefs: [{ setupId: "continuation", transform: "identity" }],
    }],
  };
}

function nestedPlan(): Cycle5AdvancedOqbPlan {
  return {
    ...revealPlan(),
    id: "nested-plan",
    branches: [{
      id: "first-s",
      observedPieces: ["S"],
      continuationSetupRefs: [{ setupId: "three-p" }],
      postCheckpoint: {
        observation: { kind: "reveal", uiSlot: "NEXT[4]" },
        branches: [
          {
            id: "second-z",
            observedPieces: ["Z"],
            continuationSetupRefs: [{ setupId: "solution" }],
          },
          {
            id: "second-fallback",
            fallback: true,
            action: {
              piece: "O",
              cells: [{ x: 8, y: 0 }, { x: 9, y: 0 }, { x: 8, y: 1 }, { x: 9, y: 1 }],
              resultingPieceCount: 4,
            },
          },
        ],
      },
    }],
  };
}

describe("shared OQB progress projection", () => {
  it("accepts an authoritative line-clear solution shadow even when checkpoint cells are outside it", () => {
    const precondition = setup("pre", [oPlacement()]);
    const shadow: SetupVariant = {
      ...setup("line-clear-shadow", [{
        id: "projected-z",
        piece: "Z",
        cells: [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 1 }, { x: 9, y: 3 }],
      }]),
      geometryKind: "solution-shadow",
      fumen: "v115@authoritative-shadow",
    };
    const board = placeCells(createBoard(), precondition.placements[0]!.cells, "O");
    const plan = revealPlan();
    plan.branches[0]!.continuationSetupRefs = [{ setupId: shadow.id }];

    const result = resolveOqbProgress({
      selectedCandidate: candidate(precondition, plan.id),
      query: query(board),
      policyOverride: source(plan, [precondition, shadow]),
    });

    expect(result.status).toBe("continuation");
    if (result.status !== "continuation") return;
    expect(result.continuations[0]?.setup).toMatchObject({
      id: shadow.id,
      geometryKind: "solution-shadow",
      placements: shadow.placements,
    });
    expect(oqbContinuationCandidates(result)[0]?.plan.steps).toEqual([]);
  });

  it("returns remaining precondition geometry until the exact checkpoint", () => {
    const precondition = setup("pre", [oPlacement()]);
    const continuation = setup("continuation", [oPlacement(), iPlacement()]);
    const result = resolveOqbProgress({
      selectedCandidate: candidate(precondition, "reveal-plan"),
      query: query(createBoard()),
      policyOverride: source(revealPlan(), [precondition, continuation]),
    });
    expect(result).toMatchObject({
      status: "precondition",
      stage: "precondition",
      progress: { completedPlacements: 0, checkpointPlacements: 1 },
    });
    expect(result.status === "precondition" && result.remainingPrecondition?.placements).toHaveLength(1);
  });

  it("selects NEXT[4] at the checkpoint and preserves the full solution geometry", () => {
    const precondition = setup("pre", [oPlacement()]);
    const continuation = setup("continuation", [oPlacement(), iPlacement()]);
    const board = placeCells(createBoard(), precondition.placements[0]!.cells, "O");
    const result = resolveOqbProgress({
      selectedCandidate: candidate(precondition, "reveal-plan"),
      query: query(board),
      policyOverride: source(revealPlan(), [precondition, continuation]),
    });
    expect(result).toMatchObject({
      status: "continuation",
      branchId: "reveal-l",
      observation: { kind: "piece", piece: "L", source: "reveal", uiSlot: "NEXT[4]" },
    });
    expect(result.status === "continuation" && result.continuations[0]?.setup.placements.map(({ id }) => id))
      .toEqual(["o", "i"]);
  });

  it("infers the unique hidden bag piece from the live active+NEXT stream", () => {
    const precondition = setup("pre", [oPlacement()]);
    const continuation = setup("continuation", [oPlacement(), iPlacement()]);
    const plan: Cycle5AdvancedOqbPlan = {
      ...revealPlan(),
      id: "hidden-plan",
      observation: {
        kind: "hidden-bag-piece",
        knownRemainingBagPieces: ["I", "L", "J", "Z"],
        visibleCountFromThatSet: 3,
      },
      branches: [{
        id: "hidden-z",
        observedPieces: ["Z"],
        continuationSetupRefs: [{ setupId: "continuation" }],
      }],
    };
    const board = placeCells(createBoard(), precondition.placements[0]!.cells, "O");
    const result = resolveOqbProgress({
      selectedCandidate: candidate(precondition, "hidden-plan"),
      query: query(board, ["L", "J", "S", "T", "O"]),
      policyOverride: source(plan, [precondition, continuation]),
    });
    expect(result).toMatchObject({
      status: "continuation",
      branchId: "hidden-z",
      observation: { kind: "piece", piece: "Z", source: "hidden-bag-piece" },
    });
  });

  it("composes the selected precondition mirror with continuation transforms", () => {
    const sourcePrecondition = setup("pre", [oPlacement()]);
    const selectedPrecondition = mirrorSetup(sourcePrecondition);
    const continuation = setup("continuation", [oPlacement(), iPlacement()]);
    const board = placeCells(createBoard(), selectedPrecondition.placements[0]!.cells, "O");
    const result = resolveOqbProgress({
      selectedCandidate: candidate(selectedPrecondition, "reveal-plan"),
      query: query(board, ["Z", "S", "T", "O", "J"]),
      policyOverride: source(revealPlan(), [sourcePrecondition, continuation]),
    });
    expect(result.status).toBe("continuation");
    if (result.status !== "continuation") return;
    expect(result.continuations[0]?.transform).toBe("mirror-x");
    expect(result.continuations[0]?.setup.placements).toHaveLength(2);
    expect(result.continuations[0]?.setup.placements[1]?.cells.map(({ x }) => x).sort())
      .toEqual([4, 5, 6, 7]);
  });

  it("retains the parent cursor and projects a nested authoritative solution without BFS", () => {
    const precondition = setup("pre", [oPlacement()]);
    const threePiece = setup("three-p", [oPlacement(), iPlacement(), tPlacement()]);
    const solution: SetupVariant = {
      ...setup("solution", [{
        id: "projected-z",
        piece: "Z",
        cells: [{ x: 0, y: 3 }, { x: 2, y: 2 }, { x: 4, y: 1 }, { x: 6, y: 0 }],
      }]),
      geometryKind: "solution-shadow",
      fumen: "v115@nested-solution",
    };
    const plan = nestedPlan();
    const catalog = [precondition, threePiece, solution];
    const firstBoard = placeCells(createBoard(), precondition.placements[0]!.cells, "O");
    const first = resolveOqbProgress({
      selectedCandidate: candidate(precondition, plan.id),
      query: query(firstBoard, ["T", "O", "L", "J", "S"]),
      policyOverride: source(plan, catalog),
    });
    expect(first).toMatchObject({ status: "continuation", branchId: "first-s" });
    if (first.status !== "continuation") return;
    const threePieceCandidate = oqbContinuationCandidates(first)[0]!;
    expect(threePieceCandidate.policy).toMatchObject({ ruleId: plan.id, branchId: "first-s" });

    let checkpointBoard = createBoard();
    for (const placement of threePiece.placements) {
      checkpointBoard = placeCells(checkpointBoard, placement.cells, placement.piece);
    }
    const nested = resolveOqbProgress({
      selectedCandidate: threePieceCandidate,
      query: query(checkpointBoard, ["T", "O", "L", "J", "Z"]),
      policyOverride: source(plan, catalog),
    });
    expect(nested).toMatchObject({
      status: "continuation",
      branchId: "second-z",
      observation: { kind: "piece", piece: "Z", uiSlot: "NEXT[4]" },
    });
    if (nested.status !== "continuation") return;
    expect(nested.continuations[0]?.setup).toMatchObject({
      id: "solution",
      geometryKind: "solution-shadow",
      placements: solution.placements,
    });
    expect(oqbContinuationCandidates(nested)[0]?.plan.steps).toEqual([]);
  });

  it("constructs a nested source-authored one-piece fallback without BFS", () => {
    const precondition = setup("pre", [oPlacement()]);
    const threePiece = setup("three-p", [oPlacement(), iPlacement(), tPlacement()]);
    const plan = nestedPlan();
    let checkpointBoard = createBoard();
    for (const placement of threePiece.placements) {
      checkpointBoard = placeCells(checkpointBoard, placement.cells, placement.piece);
    }
    const result = resolveOqbProgress({
      selectedCandidate: candidate(threePiece, plan.id, "first-s"),
      query: query(checkpointBoard, ["T", "O", "L", "J", "L"]),
      policyOverride: source(plan, [precondition, threePiece]),
    });
    expect(result).toMatchObject({ status: "continuation", branchId: "second-fallback" });
    if (result.status !== "continuation") return;
    expect(result.continuations[0]?.setup.placements).toHaveLength(4);
    expect(result.continuations[0]?.setup.placements[3]).toMatchObject({ piece: "O" });
    expect(oqbContinuationCandidates(result)[0]?.plan.steps).toEqual([]);
  });

  it.each([
    ["S", "cycle5-advanced-ti-012-f000", "Z", "cycle5-advanced-ti-solution-016-f000"],
    ["Z", "cycle5-advanced-ti-013-f000", "S", "cycle5-advanced-ti-solution-019-f000"],
  ] as const)(
    "executes both real ti5-toi-lj-slow-o stages for first %s",
    (firstPiece, checkpointId, secondPiece, solutionId) => {
      const planId = "ti5-toi-lj-slow-o";
      const precondition = setupById("cycle5-advanced-ti-011-f000");
      const first = resolveOqbProgress({
        selectedCandidate: candidate(precondition, planId),
        query: query(boardForSetup(precondition), ["T", "O", "L", "J", firstPiece]),
        policyOverride: realTiSource,
      });
      expect(first.status).toBe("continuation");
      if (first.status !== "continuation") return;
      const checkpoint = oqbContinuationCandidates(first)[0]!;
      expect(checkpoint.setup.id).toBe(checkpointId);

      const second = resolveOqbProgress({
        selectedCandidate: checkpoint,
        query: query(boardForSetup(checkpoint.setup), ["T", "O", "L", "J", secondPiece]),
        policyOverride: realTiSource,
      });
      expect(second).toMatchObject({ status: "continuation" });
      if (second.status !== "continuation") return;
      expect(second.continuations[0]?.setup).toMatchObject({
        id: solutionId,
        geometryKind: "solution-shadow",
      });
      expect(oqbContinuationCandidates(second)[0]?.plan.steps).toEqual([]);
    },
  );

  it("executes the real slow-O fallback action and the TLJIO solution/fallback branches", () => {
    const slowPlanId = "ti5-toi-lj-slow-o";
    const slowCheckpoint = setupById("cycle5-advanced-ti-012-f000");
    const slowFallback = resolveOqbProgress({
      selectedCandidate: candidate(slowCheckpoint, slowPlanId, "ti5-toi-lj-slow-o-branch-1"),
      query: query(boardForSetup(slowCheckpoint), ["T", "O", "L", "J", "L"]),
      policyOverride: realTiSource,
    });
    expect(slowFallback).toMatchObject({ status: "continuation" });
    if (slowFallback.status === "continuation") {
      expect(slowFallback.continuations[0]?.setup.placements).toHaveLength(4);
      expect(oqbContinuationCandidates(slowFallback)[0]?.plan.steps).toEqual([]);
    }

    const tljioPlanId = "ti5-tljio";
    const tljioCheckpoint = setupById("cycle5-advanced-ti-022-f000");
    const nestedBranchId = "ti5-tljio-branch-2";
    const solution = resolveOqbProgress({
      selectedCandidate: candidate(tljioCheckpoint, tljioPlanId, nestedBranchId),
      query: query(boardForSetup(tljioCheckpoint), ["T", "L", "J", "I", "S"]),
      policyOverride: realTiSource,
    });
    expect(solution).toMatchObject({ status: "continuation" });
    if (solution.status === "continuation") {
      expect(solution.continuations[0]?.setup).toMatchObject({
        id: "cycle5-advanced-ti-solution-032-f000",
        geometryKind: "solution-shadow",
      });
    }
    const fallback = resolveOqbProgress({
      selectedCandidate: candidate(tljioCheckpoint, tljioPlanId, nestedBranchId),
      query: query(boardForSetup(tljioCheckpoint), ["T", "L", "J", "I", "Z"]),
      policyOverride: realTiSource,
    });
    expect(fallback).toMatchObject({ status: "continuation" });
    if (fallback.status === "continuation") {
      expect(fallback.continuations[0]?.sourceSetupId).toBe("cycle5-advanced-ti-014-f000");
    }
  });

  it.each(["O", "I", "L", "J", "S", "Z"] as const)(
    "keeps the real OI T[LJ]!IO plan at 3P when NEXT[4] reveals %s",
    (revealedPiece) => {
      const planId = "oi5-advanced-oqb-tlj-io-last-t";
      const precondition = oiSetupById("cycle5-advanced-oi-051-f000");
      const result = resolveOqbProgress({
        selectedCandidate: candidate(precondition, planId),
        query: query(boardForSetup(precondition), ["T", "O", "I", "L", revealedPiece]),
        policyOverride: realOiSource,
      });

      expect(result).toMatchObject({
        status: "terminal",
        stage: "terminal",
        branchId: "oi5-advanced-oqb-tlj-io-last-t-branch-2-terminal-3p",
        observation: { kind: "piece", piece: revealedPiece, uiSlot: "NEXT[4]" },
      });
    },
  );

  it("advances the real OI T[LJ]!IO plan to 4P only when NEXT[4] reveals T", () => {
    const planId = "oi5-advanced-oqb-tlj-io-last-t";
    const precondition = oiSetupById("cycle5-advanced-oi-051-f000");
    const result = resolveOqbProgress({
      selectedCandidate: candidate(precondition, planId),
      query: query(boardForSetup(precondition), ["O", "I", "L", "J", "T"]),
      policyOverride: realOiSource,
    });

    expect(result).toMatchObject({
      status: "continuation",
      branchId: "oi5-advanced-oqb-tlj-io-last-t-branch-1",
      observation: { kind: "piece", piece: "T", uiSlot: "NEXT[4]" },
      continuations: [{ sourceSetupId: "cycle5-advanced-oi-052-f000" }],
    });
  });

  it("mirrors both nested observations and the authoritative TI solution geometry", () => {
    const planId = "ti5-toi-lj-slow-o";
    const sourcePrecondition = setupById("cycle5-advanced-ti-011-f000");
    const mirroredPrecondition = mirrorSetup(sourcePrecondition);
    const first = resolveOqbProgress({
      selectedCandidate: candidate(mirroredPrecondition, planId),
      query: query(boardForSetup(mirroredPrecondition), ["T", "O", "J", "L", "Z"]),
      policyOverride: realTiSource,
    });
    expect(first.status).toBe("continuation");
    if (first.status !== "continuation") return;
    const checkpoint = oqbContinuationCandidates(first)[0]!;
    const second = resolveOqbProgress({
      selectedCandidate: checkpoint,
      query: query(boardForSetup(checkpoint.setup), ["T", "O", "J", "L", "S"]),
      policyOverride: realTiSource,
    });
    expect(second).toMatchObject({
      status: "continuation",
      observation: { kind: "piece", piece: "S" },
    });
    if (second.status !== "continuation") return;
    const sourceSolution = setupById("cycle5-advanced-ti-solution-016-f000");
    expect(second.continuations[0]?.transform).toBe("mirror-x");
    expect(second.continuations[0]?.setup.placements[0]?.cells)
      .toEqual(mirrorSetup(sourceSolution).placements[0]?.cells);
  });

  it("returns an explicit unresolved result for an unmatched observed branch", () => {
    const precondition = setup("pre", [oPlacement()]);
    const board = placeCells(createBoard(), precondition.placements[0]!.cells, "O");
    const result = resolveOqbProgress({
      selectedCandidate: candidate(precondition, "reveal-plan"),
      query: query(board, ["S", "Z", "L", "J", "T"]),
      policyOverride: source(revealPlan(), [precondition]),
    });
    expect(result).toMatchObject({ status: "unresolved", reason: "branch-not-matched" });
  });

  it("uses an explicit selected policy without silently falling back to a provider", () => {
    const precondition = setup("pre", [oPlacement()]);
    let providerCalls = 0;
    const provider: OqbProgressPolicyProvider = {
      cycle5AdvancedForSetup() {
        providerCalls += 1;
        return { status: "ready", source: source(revealPlan(), [precondition]) };
      },
    };
    const differentPlan = { ...revealPlan("different-precondition"), id: "different-plan" };
    const result = resolveOqbProgress({
      selectedCandidate: candidate(precondition),
      query: query(createBoard()),
      policyOverride: source(differentPlan, [precondition]),
      policyProvider: provider,
    });
    expect(result.status).toBe("no-follow-up");
    expect(providerCalls).toBe(0);
  });

  it("uses a supplied operational provider and hides absent Cycle 2/7 continuations", () => {
    const precondition = setup("pre", [oPlacement()]);
    const provider: OqbProgressPolicyProvider = {
      cycle5AdvancedForSetup: () => ({ status: "ready", source: source(revealPlan(), [precondition]) }),
    };
    expect(resolveOqbProgress({
      selectedCandidate: candidate(precondition, "reveal-plan"),
      query: query(createBoard()),
      policyProvider: provider,
    }).status).toBe("precondition");

    const cycle7Candidate = { ...candidate({ ...precondition, cycle: 7 }), qbCondition: "QB" };
    expect(resolveOqbProgress({
      selectedCandidate: cycle7Candidate,
      query: { ...query(createBoard()), cycle: 7 },
    })).toMatchObject({ status: "no-follow-up", instruction: "" });
  });

  it("hides OQB progress for a Cycle 5 setup with no matching OQB policy", () => {
    const directSetup = setup("direct-4p", [oPlacement()]);
    const result = resolveOqbProgress({
      selectedCandidate: { ...candidate(directSetup), qbCondition: "direct QB" },
      query: query(createBoard()),
      policyProvider: { cycle5AdvancedForSetup: () => null },
    });

    expect(result).toMatchObject({ status: "no-follow-up", instruction: "" });
  });
});
