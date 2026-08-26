import type { Piece } from "../engine/types";
import {
  cycle5AdvancedSetupDisplayName,
  observeCycle5AdvancedOqb,
  observeCycle5AdvancedPostCheckpoint,
  type Cycle5AdvancedObservedQueue,
  type Cycle5AdvancedSinglePieceAction,
  type Cycle5AdvancedOqbPlan,
  type Cycle5AdvancedPolicyBundle,
  type Cycle5AdvancedSetupRef,
} from "./cycle5AdvancedPolicy";
import { mirrorCell, mirrorPiece, mirrorSetup } from "./mirror";
import {
  candidateScore,
  cycle3StagedPreconditionRule,
  resolveCycle3StagedSetup,
  type SetupCandidate,
  type SetupQuery,
} from "./query";
import { isSolutionShadowSetup, type SetupVariant } from "./schema";
import { setupGeometryProgress, type SetupGeometryProgress } from "./setupGeometryProgress";
import {
  canonicalCycle8TxSetupId,
  cycle8TxExactClassForSetup,
  cycle8TxOqbContinuation,
  cycle8TxOqbPlanById,
  cycle8TxSourceQueueState,
} from "./cycle8TxCatalog";

export interface Cycle5AdvancedOqbPolicySource {
  bundle: Cycle5AdvancedPolicyBundle;
  catalog: readonly SetupVariant[];
  sourceId?: string;
}

export type OqbProgressProviderMatch =
  | {
      status: "ready";
      source: Cycle5AdvancedOqbPolicySource;
    }
  | {
      status: "inactive" | "unsupported";
      reason: string;
    };

export interface OqbProgressPolicyProvider {
  cycle5AdvancedForSetup(
    setup: SetupVariant,
    planId?: string,
  ): OqbProgressProviderMatch | null;
}

export interface OqbProgressInput {
  selectedCandidate: SetupCandidate;
  query: SetupQuery;
  /** Required when one precondition geometry is shared by multiple plans. */
  planId?: string;
  /** Direct selected-catalog mode. When supplied, provider fallback is forbidden. */
  policyOverride?: Cycle5AdvancedOqbPolicySource;
  /** Operational mode. Main should pass the manifest-aware promoted provider. */
  policyProvider?: OqbProgressPolicyProvider;
}

export type OqbProgressObservation = Cycle5AdvancedObservedQueue | {
  kind: "sequence";
  pieces: Piece[];
  source: "cycle3-visible-next-tail" | "cycle8-post-build-seven";
};

export interface OqbContinuationCandidate {
  sourceSetupId: string;
  transform: "identity" | "mirror-x";
  displayName: string;
  /** Authoritative full solution geometry; occupied cells are suppressed only by rendering. */
  setup: SetupVariant;
}

export interface OqbProgressValue {
  completedPlacements: number;
  checkpointPlacements: number;
}

interface OqbProgressBase {
  cycle: number;
  policyKind: "cycle3-staged" | "cycle5-advanced" | "cycle8-tx";
  planId: string;
  stage: "precondition" | "checkpoint" | "continuation" | "terminal";
  progress: OqbProgressValue;
  instruction: string;
  remainingPrecondition?: SetupVariant;
  observation?: OqbProgressObservation;
  branchId?: string;
}

export type OqbProgressResult =
  | (OqbProgressBase & {
      status: "precondition";
      stage: "precondition";
    })
  | (OqbProgressBase & {
      status: "continuation";
      stage: "continuation";
      continuations: OqbContinuationCandidate[];
    })
  | (OqbProgressBase & {
      status: "terminal";
      stage: "terminal";
    })
  | {
      status: "no-follow-up";
      cycle: number;
      instruction: string;
    }
  | {
      status: "unsupported";
      cycle: number;
      instruction: string;
      reason: string;
    }
  | {
      status: "unresolved";
      cycle: number;
      instruction: string;
      reason: string;
      planId?: string;
      stage?: "precondition" | "checkpoint" | "continuation";
      progress?: OqbProgressValue;
      observation?: OqbProgressObservation;
    };

function observationLabel(progress: OqbProgressResult): string {
  const observation = "observation" in progress ? progress.observation : undefined;
  if (!observation) return "OQB continuation";
  if (observation.kind === "piece") return `OQB ${observation.piece} branch`;
  if (observation.kind === "relative-order") return `OQB ${observation.before}→${observation.after} branch`;
  return `OQB ${observation.pieces.join("")} branch`;
}

/** Projects policy-selected solution geometry without inventing a placement order. */
export function oqbContinuationCandidates(progress: OqbProgressResult): SetupCandidate[] {
  if (progress.status !== "continuation") return [];
  return progress.continuations.map((continuation) => {
    const setup = { ...continuation.setup, displayName: continuation.displayName };
    return {
      setup,
      plan: { steps: [], holds: 0 },
      score: candidateScore(setup),
      reasons: [progress.instruction],
      policy: {
        ruleId: progress.planId,
        branchId: progress.branchId ?? "continuation",
        preferred: true,
      },
      qbCondition: observationLabel(progress),
    };
  });
}

function canonicalSetupId(setup: SetupVariant): string {
  return (setup.policySourceId ?? setup.id).split("--box-")[0]!.replace(/--mirror$/, "");
}

function isMirroredSetup(setup: SetupVariant): boolean {
  return setup.id.split("--box-")[0]!.endsWith("--mirror")
    || setup.derivedVariant === "mirror";
}

function progressValue(progress: SetupGeometryProgress, checkpointPlacements: number): OqbProgressValue {
  return {
    completedPlacements: progress.completedCount,
    checkpointPlacements,
  };
}

function unresolvedGeometry(
  query: SetupQuery,
  planId: string,
  progress: SetupGeometryProgress,
  reason: string,
): OqbProgressResult {
  return {
    status: "unresolved",
    cycle: query.cycle,
    planId,
    stage: "precondition",
    progress: progressValue(progress, progress.totalCount),
    reason,
    instruction: "The current board does not match the selected OQB geometry.",
  };
}

function findCycle5Plan(
  source: Cycle5AdvancedOqbPolicySource,
  setup: SetupVariant,
  requestedPlanId?: string,
): { plan?: Cycle5AdvancedOqbPlan; reason?: string } {
  const sourceSetupId = canonicalSetupId(setup);
  if (requestedPlanId) {
    const plan = source.bundle.entries.find((entry): entry is Cycle5AdvancedOqbPlan =>
      entry.kind === "oqb" && entry.id === requestedPlanId);
    return plan ? { plan } : { reason: "selected-plan-cursor-not-found" };
  }
  const plans = source.bundle.entries.filter((entry): entry is Cycle5AdvancedOqbPlan =>
    entry.kind === "oqb" && entry.preconditionSetupId === sourceSetupId);
  if (plans.length === 0) return {};
  if (plans.length > 1) return { reason: "ambiguous-plan-id-required" };
  return { plan: plans[0] };
}

function sourceQueueState(query: SetupQuery, mirrored: boolean) {
  const hold = query.hold ?? query.active;
  return mirrored ? {
    hold: mirrorPiece(hold),
    active: mirrorPiece(query.active),
    next: query.next.map(mirrorPiece),
  } : { hold, active: query.active, next: query.next };
}

function runtimeObservation(
  observation: Cycle5AdvancedObservedQueue | undefined,
  mirrored: boolean,
): Cycle5AdvancedObservedQueue | undefined {
  if (!observation || !mirrored) return observation;
  if (observation.kind === "piece") return { ...observation, piece: mirrorPiece(observation.piece) };
  return { kind: "relative-order", before: mirrorPiece(observation.before), after: mirrorPiece(observation.after) };
}

function actionContinuation(
  setup: SetupVariant,
  action: Cycle5AdvancedSinglePieceAction,
  mirrored: boolean,
): OqbContinuationCandidate | null {
  const piece = mirrored ? mirrorPiece(action.piece) : action.piece;
  const cells = (mirrored ? action.cells.map(mirrorCell) : action.cells.map((cell) => ({ ...cell })))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  if (setup.placements.length + 1 !== action.resultingPieceCount) return null;
  const occupied = new Set(setup.placements.flatMap((placement) =>
    placement.cells.map(({ x, y }) => `${x},${y}`)));
  if (cells.some(({ x, y }) => occupied.has(`${x},${y}`))) return null;
  const suffix = `--post-action-${piece.toLowerCase()}`;
  const extended: SetupVariant = {
    ...setup,
    id: `${setup.id}${suffix}`,
    displayName: `${setup.displayName} + ${piece}`,
    pieceSignature: [...setup.pieceSignature, piece],
    placements: [...setup.placements, { id: `${setup.id}${suffix}`, piece, cells }],
    fumen: undefined,
    mirrorOf: undefined,
    mirroredVariantId: undefined,
    policySourceId: setup.policySourceId ?? canonicalSetupId(setup),
  };
  return {
    sourceSetupId: canonicalSetupId(setup),
    transform: mirrored ? "mirror-x" : "identity",
    displayName: extended.displayName,
    setup: extended,
  };
}

function transformedContinuation(
  catalog: readonly SetupVariant[],
  ref: Cycle5AdvancedSetupRef,
  mirrorFromPrecondition: boolean,
  board: SetupQuery["board"],
  bestsave?: boolean | null,
): OqbContinuationCandidate | "complete" | null {
  const source = catalog.find(({ id }) => id === ref.setupId);
  if (!source) return null;
  const mirror = mirrorFromPrecondition !== (ref.transform === "mirror-x");
  const transformedBase = mirror ? mirrorSetup(source) : source;
  const transformed = typeof bestsave === "boolean"
    ? { ...transformedBase, bestsave }
    : transformedBase;
  if (isSolutionShadowSetup(transformed)) {
    const displayRef = ref.displayHoldPiece === undefined ? ref : {
      ...ref,
      displayHoldPiece: mirror ? mirrorPiece(ref.displayHoldPiece) : ref.displayHoldPiece,
    };
    return {
      sourceSetupId: ref.setupId,
      transform: mirror ? "mirror-x" : "identity",
      displayName: cycle5AdvancedSetupDisplayName(transformed.displayName, displayRef),
      setup: transformed,
    };
  }
  const progress = setupGeometryProgress(transformed, board);
  if (progress.status === "invalid" || progress.status === "not-started") return null;
  if (progress.status === "complete") return "complete";
  const displayRef = ref.displayHoldPiece === undefined ? ref : {
    ...ref,
    displayHoldPiece: mirror ? mirrorPiece(ref.displayHoldPiece) : ref.displayHoldPiece,
  };
  return {
    sourceSetupId: ref.setupId,
    transform: mirror ? "mirror-x" : "identity",
    displayName: cycle5AdvancedSetupDisplayName(transformed.displayName, displayRef),
    setup: transformed,
  };
}

function resolveCycle5Progress(
  input: OqbProgressInput,
  source: Cycle5AdvancedOqbPolicySource,
): OqbProgressResult {
  const { selectedCandidate, query } = input;
  const candidateRuleId = selectedCandidate.policy?.ruleId;
  const ruleId = input.planId
    ?? (source.bundle.entries.some((entry) => entry.kind === "oqb" && entry.id === candidateRuleId)
      ? candidateRuleId
      : undefined);
  const selected = findCycle5Plan(source, selectedCandidate.setup, ruleId);
  if (selected.reason) {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: ruleId,
      reason: selected.reason,
      instruction: "Select the exact structured OQB plan for this precondition.",
    };
  }
  if (!selected.plan) {
    return {
      status: "no-follow-up",
      cycle: query.cycle,
      instruction: "The selected setup has no structured OQB continuation.",
    };
  }

  const plan = selected.plan;
  const mirrored = isMirroredSetup(selectedCandidate.setup);
  const selectedSourceId = canonicalSetupId(selectedCandidate.setup);
  const isInitialPrecondition = selectedSourceId === plan.preconditionSetupId;
  const cursorBranch = isInitialPrecondition ? undefined : plan.branches.find(({ id, continuationSetupRefs }) =>
    id === selectedCandidate.policy?.branchId
      && continuationSetupRefs.some(({ setupId }) => setupId === selectedSourceId));
  const nestedCursor = isInitialPrecondition || cursorBranch ? undefined : plan.branches.flatMap((parent) =>
    (parent.postCheckpoint?.branches ?? []).map((branch) => ({ parent, branch }))).find(({ branch }) =>
    branch.id === selectedCandidate.policy?.branchId
      && ((branch.continuationSetupRefs ?? []).some(({ setupId }) => setupId === selectedSourceId)
        || (branch.action !== undefined
          && selectedCandidate.setup.placements.length === branch.action.resultingPieceCount)));
  if (!isInitialPrecondition && !cursorBranch && !nestedCursor) {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: plan.id,
      stage: "continuation",
      reason: "continuation-cursor-does-not-match-plan",
      instruction: "The selected continuation no longer matches its parent OQB branch.",
    };
  }
  // A source-authoritative solution shadow is visual geometry, not a static
  // placement sequence. Once selected, it has no further runtime checkpoint.
  if (!isInitialPrecondition && isSolutionShadowSetup(selectedCandidate.setup)) {
    return {
      status: "terminal",
      cycle: query.cycle,
      policyKind: "cycle5-advanced",
      planId: plan.id,
      branchId: selectedCandidate.policy?.branchId,
      stage: "terminal",
      progress: {
        completedPlacements: selectedCandidate.setup.placements.length,
        checkpointPlacements: selectedCandidate.setup.placements.length,
      },
      instruction: "The authoritative OQB solution shadow has no further checkpoint.",
    };
  }
  const progress = setupGeometryProgress(selectedCandidate.setup, query.board);
  if (progress.status === "invalid") {
    return unresolvedGeometry(query, plan.id, progress, progress.reason ?? "invalid-precondition-board");
  }
  const checkpointPlacements = isInitialPrecondition
    ? plan.checkpoint.placedCount
    : selectedCandidate.setup.placements.length;
  if (progress.totalCount !== checkpointPlacements) {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: plan.id,
      stage: "precondition",
      progress: progressValue(progress, checkpointPlacements),
      reason: "checkpoint-geometry-count-mismatch",
      instruction: "The selected precondition geometry does not match the policy checkpoint.",
    };
  }
  if (progress.status !== "complete") {
    return {
      status: "precondition",
      cycle: query.cycle,
      policyKind: "cycle5-advanced",
      planId: plan.id,
      stage: "precondition",
      progress: progressValue(progress, checkpointPlacements),
      instruction: `Complete the OQB checkpoint (${progress.completedCount}/${checkpointPlacements}).`,
      remainingPrecondition: progress.remainingSetup,
    };
  }

  if (nestedCursor) {
    return {
      status: "terminal",
      cycle: query.cycle,
      policyKind: "cycle5-advanced",
      planId: plan.id,
      branchId: nestedCursor.branch.id,
      stage: "terminal",
      progress: progressValue(progress, checkpointPlacements),
      instruction: "The selected nested OQB continuation has no further checkpoint.",
    };
  }

  const queueState = sourceQueueState(query, mirrored);
  if (cursorBranch) {
    if (!cursorBranch.postCheckpoint) {
      return {
        status: "terminal",
        cycle: query.cycle,
        policyKind: "cycle5-advanced",
        planId: plan.id,
        branchId: cursorBranch.id,
        stage: "terminal",
        progress: progressValue(progress, checkpointPlacements),
        instruction: "The selected continuation has no further checkpoint.",
      };
    }
    const nested = observeCycle5AdvancedPostCheckpoint(cursorBranch.postCheckpoint, queueState);
    const observation = runtimeObservation(nested.observation, mirrored);
    if (nested.status === "unresolved") {
      return {
        status: "unresolved",
        cycle: query.cycle,
        planId: plan.id,
        stage: "checkpoint",
        progress: progressValue(progress, checkpointPlacements),
        reason: nested.reason,
        instruction: "The live queue does not resolve the nested OQB checkpoint.",
        observation,
      };
    }
    const projected = nested.branch.action
      ? [actionContinuation(selectedCandidate.setup, nested.branch.action, mirrored)]
      : (nested.branch.continuationSetupRefs ?? []).map((ref) => transformedContinuation(
        source.catalog,
        ref,
        mirrored,
        query.board,
      ));
    if (projected.length === 0 || projected.some((candidate) => candidate === null)) {
      return {
        status: "unresolved",
        cycle: query.cycle,
        planId: plan.id,
        stage: "continuation",
        progress: progressValue(progress, checkpointPlacements),
        reason: "nested-continuation-missing-or-incompatible",
        instruction: "The nested OQB outcome cannot be projected.",
        observation,
      };
    }
    const continuations = projected.filter((candidate): candidate is OqbContinuationCandidate =>
      candidate !== "complete");
    if (continuations.length === 0) {
      return {
        status: "terminal",
        cycle: query.cycle,
        policyKind: "cycle5-advanced",
        planId: plan.id,
        branchId: nested.branch.id,
        stage: "terminal",
        progress: progressValue(progress, checkpointPlacements),
        observation,
        instruction: "The nested OQB continuation is already complete.",
      };
    }
    return {
      status: "continuation",
      cycle: query.cycle,
      policyKind: "cycle5-advanced",
      planId: plan.id,
      branchId: nested.branch.id,
      stage: "continuation",
      progress: progressValue(progress, checkpointPlacements),
      observation,
      instruction: "Continue with the policy-selected nested OQB solution.",
      continuations,
    };
  }

  const observed = observeCycle5AdvancedOqb(plan, {
    ...queueState,
  });
  const observation = runtimeObservation(observed.observation, mirrored);
  if (observed.status === "unresolved") {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: plan.id,
      stage: "checkpoint",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      reason: observed.reason,
      instruction: "The live queue does not resolve an executable OQB branch.",
      observation,
    };
  }

  const refs = observed.decision.continuationSetupRefs;
  if (observed.decision.terminal) {
    return {
      status: "terminal",
      cycle: query.cycle,
      policyKind: "cycle5-advanced",
      planId: plan.id,
      branchId: observed.decision.branchId,
      stage: "terminal",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      observation,
      instruction: "The selected policy branch has no follow-up geometry.",
    };
  }
  if (refs.length === 0) {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: plan.id,
      stage: "continuation",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      reason: "continuation-missing-or-incompatible",
      instruction: "The selected OQB branch has no declared continuation outcome.",
      observation,
    };
  }

  const projected = refs.map((ref) => transformedContinuation(
    source.catalog,
    ref,
    mirrored,
    query.board,
    observed.decision.bestsave,
  ));
  if (projected.some((candidate) => candidate === null)) {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: plan.id,
      stage: "continuation",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      observation,
      reason: "continuation-geometry-missing-or-incompatible",
      instruction: "A policy continuation cannot be projected from the selected catalog and board.",
    };
  }
  const continuations = projected.filter((candidate): candidate is OqbContinuationCandidate =>
    candidate !== "complete");
  if (continuations.length === 0) {
    return {
      status: "terminal",
      cycle: query.cycle,
      policyKind: "cycle5-advanced",
      planId: plan.id,
      branchId: observed.decision.branchId,
      stage: "terminal",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      observation,
      instruction: "The policy continuation is already complete.",
    };
  }
  return {
    status: "continuation",
    cycle: query.cycle,
    policyKind: "cycle5-advanced",
    planId: plan.id,
    branchId: observed.decision.branchId,
    stage: "continuation",
    progress: progressValue(progress, plan.checkpoint.placedCount),
    observation,
    instruction: "Continue with every policy-selected setup shown.",
    continuations,
  };
}

function resolveCycle3Progress(input: OqbProgressInput): OqbProgressResult {
  const { selectedCandidate, query } = input;
  const rule = cycle3StagedPreconditionRule(query, selectedCandidate.setup);
  if (!rule) {
    return {
      status: "no-follow-up",
      cycle: query.cycle,
      instruction: "The selected setup has no structured staged continuation.",
    };
  }
  const progress = setupGeometryProgress(selectedCandidate.setup, query.board);
  if (progress.status === "invalid") {
    return unresolvedGeometry(query, rule.id, progress, progress.reason ?? "invalid-precondition-board");
  }
  if (progress.status !== "complete") {
    return {
      status: "precondition",
      cycle: query.cycle,
      policyKind: "cycle3-staged",
      planId: rule.id,
      stage: "precondition",
      progress: progressValue(progress, selectedCandidate.setup.placements.length),
      instruction: `Complete the staged precondition (${progress.completedCount}/${selectedCandidate.setup.placements.length}).`,
      remainingPrecondition: progress.remainingSetup,
    };
  }

  const resolution = resolveCycle3StagedSetup(query, selectedCandidate.setup);
  if (!resolution) {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: rule.id,
      stage: "checkpoint",
      progress: progressValue(progress, selectedCandidate.setup.placements.length),
      reason: "cycle3-branch-not-resolved",
      instruction: "The visible NEXT tail does not resolve the staged Cycle 3 policy.",
    };
  }
  const observation: OqbProgressObservation = {
    kind: "sequence",
    pieces: resolution.observation,
    source: "cycle3-visible-next-tail",
  };
  if (resolution.action === "solve-from-precondition") {
    return {
      status: "terminal",
      cycle: query.cycle,
      policyKind: "cycle3-staged",
      planId: resolution.ruleId,
      branchId: resolution.branchId,
      stage: "terminal",
      progress: progressValue(progress, selectedCandidate.setup.placements.length),
      observation,
      instruction: resolution.instruction,
    };
  }
  if (!resolution.continuation) {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: resolution.ruleId,
      stage: "continuation",
      progress: progressValue(progress, selectedCandidate.setup.placements.length),
      observation,
      reason: "cycle3-continuation-not-buildable",
      instruction: resolution.instruction,
    };
  }
  const continuationProgress = setupGeometryProgress(resolution.continuation, query.board);
  if (continuationProgress.status !== "in-progress") {
    return {
      status: "unresolved",
      cycle: query.cycle,
      planId: resolution.ruleId,
      stage: "continuation",
      progress: progressValue(progress, selectedCandidate.setup.placements.length),
      observation,
      reason: "cycle3-continuation-geometry-incompatible",
      instruction: resolution.instruction,
    };
  }
  return {
    status: "continuation",
    cycle: query.cycle,
    policyKind: "cycle3-staged",
    planId: resolution.ruleId,
    branchId: resolution.branchId,
    stage: "continuation",
    progress: progressValue(progress, selectedCandidate.setup.placements.length),
    observation,
    instruction: resolution.instruction,
    continuations: [{
      sourceSetupId: canonicalSetupId(resolution.continuation),
      transform: isMirroredSetup(resolution.continuation) ? "mirror-x" : "identity",
      displayName: resolution.continuation.displayName,
      setup: resolution.continuation,
    }],
  };
}

function resolveCycle8Progress(input: OqbProgressInput): OqbProgressResult {
  const { selectedCandidate, query } = input;
  const planId = input.planId ?? selectedCandidate.policy?.ruleId;
  const plan = planId ? cycle8TxOqbPlanById(planId) : undefined;
  if (!plan) {
    return {
      status: "no-follow-up",
      cycle: 8,
      instruction: "",
    };
  }
  const exactClass = cycle8TxExactClassForSetup(selectedCandidate.setup);
  if (!exactClass || !plan.exactClasses.includes(exactClass)) {
    return {
      status: "unresolved",
      cycle: 8,
      planId: plan.id,
      reason: "cycle8-exact-class-mismatch",
      instruction: "The selected Cycle 8 OQB setup no longer matches its exact replacement class.",
    };
  }
  const branch = plan.branches.find(({ id }) => id === selectedCandidate.policy?.branchId);
  if (!branch) {
    return {
      status: "unresolved",
      cycle: 8,
      planId: plan.id,
      reason: "cycle8-branch-cursor-not-found",
      instruction: "The exact staged queue branch is no longer attached to this OQB candidate.",
    };
  }
  if (selectedCandidate.setup.geometryKind === "solution-shadow") {
    return {
      status: "terminal",
      cycle: 8,
      policyKind: "cycle8-tx",
      planId: plan.id,
      branchId: branch.id,
      stage: "terminal",
      progress: {
        completedPlacements: selectedCandidate.setup.placements.length,
        checkpointPlacements: selectedCandidate.setup.placements.length,
      },
      instruction: "The authoritative Cycle 8 OQB solution shadow has no further checkpoint.",
    };
  }

  const progress = setupGeometryProgress(selectedCandidate.setup, query.board);
  if (progress.status === "invalid") {
    return {
      status: "unresolved",
      cycle: 8,
      planId: plan.id,
      stage: "precondition",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      reason: progress.reason ?? "invalid-cycle8-precondition-board",
      instruction: "The current board does not match the selected Cycle 8 OQB precondition.",
    };
  }
  if (progress.totalCount !== plan.checkpoint.placedCount) {
    return {
      status: "unresolved",
      cycle: 8,
      planId: plan.id,
      stage: "precondition",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      reason: "cycle8-checkpoint-geometry-count-mismatch",
      instruction: "The selected Cycle 8 precondition does not match its policy checkpoint.",
    };
  }
  if (progress.status !== "complete") {
    return {
      status: "precondition",
      cycle: 8,
      policyKind: "cycle8-tx",
      planId: plan.id,
      branchId: branch.id,
      stage: "precondition",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      instruction: `Complete the Cycle 8 OQB precondition (${progress.completedCount}/${plan.checkpoint.placedCount}).`,
      remainingPrecondition: progress.remainingSetup,
    };
  }

  const sourceState = cycle8TxSourceQueueState({
    hold: query.hold,
    active: query.active,
    next: query.next,
  }, exactClass);
  const observation: OqbProgressObservation = {
    kind: "sequence",
    pieces: [sourceState.hold ?? sourceState.active, sourceState.active, ...sourceState.next.slice(0, 5)],
    source: "cycle8-post-build-seven",
  };
  if (branch.action === "solve-from-precondition") {
    return {
      status: "terminal",
      cycle: 8,
      policyKind: "cycle8-tx",
      planId: plan.id,
      branchId: branch.id,
      stage: "terminal",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      observation,
      instruction: "No listed OQB extension matches; solve from the reviewed 3P precondition.",
    };
  }
  const continuations = (branch.continuationSetupIds ?? []).flatMap((setupId) => {
    const setup = cycle8TxOqbContinuation(setupId, exactClass);
    return setup ? [{
      sourceSetupId: canonicalCycle8TxSetupId(setup),
      transform: (exactClass === "T>J" || exactClass === "T>Z") ? "mirror-x" as const : "identity" as const,
      displayName: `${setup.displayName} · ${branch.id}`,
      setup,
    }] : [];
  });
  if (continuations.length === 0) {
    return {
      status: "unresolved",
      cycle: 8,
      planId: plan.id,
      stage: "continuation",
      progress: progressValue(progress, plan.checkpoint.placedCount),
      observation,
      reason: "cycle8-continuation-not-found",
      instruction: "The selected Cycle 8 OQB continuation is unavailable.",
    };
  }
  return {
    status: "continuation",
    cycle: 8,
    policyKind: "cycle8-tx",
    planId: plan.id,
    branchId: branch.id,
    stage: "continuation",
    progress: progressValue(progress, plan.checkpoint.placedCount),
    observation,
    instruction: `Apply the reviewed Cycle 8 OQB ${branch.id} continuation.`,
    continuations,
  };
}

/** Pure recommendation-domain projection for setup_test Play 0P. */
export function resolveOqbProgress(input: OqbProgressInput): OqbProgressResult {
  const cycle8Replacement = input.query.cycle === 1 && input.selectedCandidate.setup.cycle === 8;
  if (input.query.cycle !== input.selectedCandidate.setup.cycle && !cycle8Replacement) {
    return {
      status: "unresolved",
      cycle: input.query.cycle,
      reason: "cycle-mismatch",
      instruction: "The selected setup and live game state belong to different cycles.",
    };
  }
  if (cycle8Replacement) return resolveCycle8Progress(input);
  if (input.query.cycle === 3) return resolveCycle3Progress(input);
  if (input.query.cycle === 5) {
    if (input.policyOverride) return resolveCycle5Progress(input, input.policyOverride);
    const providerMatch = input.policyProvider?.cycle5AdvancedForSetup(
      input.selectedCandidate.setup,
      input.planId ?? input.selectedCandidate.policy?.ruleId,
    );
    if (!providerMatch) {
      return {
        status: "no-follow-up",
        cycle: input.query.cycle,
        instruction: "",
      };
    }
    if (providerMatch.status !== "ready") {
      return {
        status: "unsupported",
        cycle: input.query.cycle,
        reason: providerMatch.reason,
        instruction: "The matching promoted OQB policy is not executable in this runtime.",
      };
    }
    return resolveCycle5Progress(input, providerMatch.source);
  }
  if ((input.query.cycle === 2 || input.query.cycle === 7) && input.selectedCandidate.qbCondition) {
    return {
      status: "no-follow-up",
      cycle: input.query.cycle,
      instruction: "",
    };
  }
  return {
    status: "no-follow-up",
    cycle: input.query.cycle,
    instruction: "The selected setup has no structured OQB continuation.",
  };
}
