import type { Cell, Piece } from "../engine/types";
import { formatPieceSetForDisplay } from "../engine/pieceDisplay";

/** The wildcard consumes exactly one visible tetromino. */
export type Cycle5AdvancedQueueSymbol = Piece | "X";

export type Cycle5AdvancedQueuePart =
  | {
      kind: "ordered";
      symbols: Cycle5AdvancedQueueSymbol[];
    }
  | {
      kind: "permutation";
      symbols: Cycle5AdvancedQueueSymbol[];
    };

export interface Cycle5AdvancedQueuePatternBody {
  parts: Cycle5AdvancedQueuePart[];
}

/**
 * Promoted policy must state which queue domain a normalized source expression
 * addresses. Source prose and punctuation are intentionally not parsed at runtime.
 */
export interface Cycle5AdvancedQueuePattern extends Cycle5AdvancedQueuePatternBody {
  scope: "visible-seven" | "next-bag-five";
  excludes?: Cycle5AdvancedQueuePatternBody[];
}

export interface Cycle5AdvancedQueueState {
  hold: Piece;
  active: Piece;
  next: Piece[];
}

export interface Cycle5AdvancedSetupRef {
  setupId: string;
  transform?: "identity" | "mirror-x";
  /** Presentation only. It never broadens policy matching or BFS eligibility. */
  displayHoldPiece?: Piece;
}

export interface Cycle5AdvancedRuleAlternative {
  pattern: Cycle5AdvancedQueuePattern;
  setupRefs: Cycle5AdvancedSetupRef[];
}

interface Cycle5AdvancedEntryBase {
  id: string;
  sourceOrder: number;
}

export interface Cycle5AdvancedDirectRule extends Cycle5AdvancedEntryBase {
  kind: "direct";
  alternatives: Cycle5AdvancedRuleAlternative[];
  bestsave?: boolean | null;
  directTwoLinePc?: boolean;
}

export interface Cycle5AdvancedOqbBranch {
  id: string;
  observedPieces?: Piece[];
  relativeOrder?: {
    before: Piece;
    after: Piece;
  };
  continuationSetupRefs: Cycle5AdvancedSetupRef[];
  /** Explicitly completes the selected setup at its current checkpoint. */
  terminal?: true;
  bestsave?: boolean | null;
  postCheckpoint?: Cycle5AdvancedPostCheckpoint;
}

export interface Cycle5AdvancedSinglePieceAction {
  piece: Piece;
  cells: Cell[];
  resultingPieceCount: number;
}

export interface Cycle5AdvancedPostCheckpointBranch {
  id: string;
  observedPieces?: Piece[];
  fallback?: boolean;
  continuationSetupRefs?: Cycle5AdvancedSetupRef[];
  action?: Cycle5AdvancedSinglePieceAction;
}

export interface Cycle5AdvancedPostCheckpoint {
  observation: Cycle5AdvancedOqbObservation;
  /** Source order is semantic: the first matching predicate wins, then fallback. */
  branches: Cycle5AdvancedPostCheckpointBranch[];
}

export type Cycle5AdvancedOqbObservation =
  | {
      kind: "reveal";
      uiSlot?: `NEXT[${number}]`;
    }
  | {
      kind: "hidden-bag-piece";
      knownRemainingBagPieces: Piece[];
      visibleCountFromThatSet: number;
    }
  | {
      kind: "relative-order";
      pieces: [Piece, Piece];
    };

export interface Cycle5AdvancedOqbPlan extends Cycle5AdvancedEntryBase {
  kind: "oqb";
  /** Save quality belongs to the initial queue condition, not its geometry. */
  bestsave?: boolean | null;
  initialPatterns: Cycle5AdvancedQueuePattern[];
  preconditionSetupId: string | null;
  checkpoint: {
    placedCount: 1 | 2 | 3;
  };
  observation: Cycle5AdvancedOqbObservation;
  branches: Cycle5AdvancedOqbBranch[];
}

export type Cycle5AdvancedPolicyEntry = Cycle5AdvancedDirectRule | Cycle5AdvancedOqbPlan;

export interface Cycle5AdvancedPolicyBundle {
  schemaVersion: 1 | 3;
  cycle: 5;
  classId: string;
  entries: Cycle5AdvancedPolicyEntry[];
}

export type Cycle5AdvancedEntryMatch =
  | {
      entry: Cycle5AdvancedDirectRule;
      setupRefs: Cycle5AdvancedSetupRef[];
    }
  | {
      entry: Cycle5AdvancedOqbPlan;
      setupRefs: [];
    };

export type Cycle5AdvancedInitialDecision =
  | {
      kind: "direct";
      ruleId: string;
      setupRefs: Cycle5AdvancedSetupRef[];
      bestsave?: boolean | null;
    }
  | {
      kind: "two-line-pc";
      ruleId: string;
    }
  | {
      kind: "oqb";
      plan: Cycle5AdvancedOqbPlan;
      preconditionSetupId: string;
      bestsave?: boolean | null;
    };

export interface Cycle5AdvancedContinuationDecision {
  planId: string;
  branchId: string;
  continuationSetupRefs: Cycle5AdvancedSetupRef[];
  terminal?: true;
  bestsave?: boolean | null;
}

export type Cycle5AdvancedObservedQueue =
  | {
      kind: "piece";
      piece: Piece;
      source: "reveal" | "hidden-bag-piece";
      uiSlot?: `NEXT[${number}]`;
    }
  | {
      kind: "relative-order";
      before: Piece;
      after: Piece;
    };

export type Cycle5AdvancedOqbObservationResult =
  | {
      status: "matched";
      observation: Cycle5AdvancedObservedQueue;
      decision: Cycle5AdvancedContinuationDecision;
    }
  | {
      status: "unresolved";
      reason:
        | "missing-reveal-slot"
        | "reveal-not-visible"
        | "hidden-piece-not-unique"
        | "relative-order-not-visible"
        | "branch-not-matched";
      observation?: Cycle5AdvancedObservedQueue;
    };

export type Cycle5AdvancedPostCheckpointResult =
  | {
      status: "matched";
      observation: Cycle5AdvancedObservedQueue;
      branch: Cycle5AdvancedPostCheckpointBranch;
    }
  | {
      status: "unresolved";
      reason: Extract<Cycle5AdvancedOqbObservationResult, { status: "unresolved" }>["reason"];
      observation?: Cycle5AdvancedObservedQueue;
    };

function orderedPartMatches(
  symbols: readonly Cycle5AdvancedQueueSymbol[],
  sequence: readonly Piece[],
  offset: number,
): boolean {
  return symbols.every((symbol, index) => symbol === "X" || symbol === sequence[offset + index]);
}

function permutationPartMatches(
  symbols: readonly Cycle5AdvancedQueueSymbol[],
  sequence: readonly Piece[],
  offset: number,
): boolean {
  const remaining = sequence.slice(offset, offset + symbols.length);
  for (const symbol of symbols) {
    if (symbol === "X") continue;
    const index = remaining.indexOf(symbol);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === symbols.filter((symbol) => symbol === "X").length;
}

function patternBodyMatches(
  pattern: Cycle5AdvancedQueuePatternBody,
  sequence: readonly Piece[],
): boolean {
  let offset = 0;
  for (const part of pattern.parts) {
    if (offset + part.symbols.length > sequence.length) return false;
    const matches = part.kind === "ordered"
      ? orderedPartMatches(part.symbols, sequence, offset)
      : permutationPartMatches(part.symbols, sequence, offset);
    if (!matches) return false;
    offset += part.symbols.length;
  }
  return true;
}

function sequenceForPattern(
  state: Cycle5AdvancedQueueState,
  pattern: Cycle5AdvancedQueuePattern,
): Piece[] {
  return pattern.scope === "visible-seven"
    ? [state.hold, state.active, ...state.next.slice(0, 5)]
    : state.next.slice(0, 5);
}

export function cycle5AdvancedQueuePatternMatches(
  pattern: Cycle5AdvancedQueuePattern,
  state: Cycle5AdvancedQueueState,
): boolean {
  const sequence = sequenceForPattern(state, pattern);
  return patternBodyMatches(pattern, sequence)
    && !(pattern.excludes ?? []).some((excluded) => patternBodyMatches(excluded, sequence));
}

function cycle5AdvancedPatternBodyLabel(
  parts: readonly Cycle5AdvancedQueuePart[],
  mirrored: boolean,
): string {
  return parts.map((part) => {
    const symbols = part.symbols.map((symbol) =>
      symbol === "X" || !mirrored ? symbol : mirrorPatternPiece(symbol));
    const joined = symbols.join("");
    return part.kind === "permutation" ? `[${joined}]!` : joined;
  }).join("");
}

function mirrorPatternPiece(piece: Piece): Piece {
  if (piece === "L") return "J";
  if (piece === "J") return "L";
  if (piece === "S") return "Z";
  if (piece === "Z") return "S";
  return piece;
}

/** Human label for the exact normalized pattern that produced a Cycle 5 QB/OQB candidate. */
export function cycle5AdvancedRecommendationLabel(
  classPieces: readonly Piece[],
  pattern: Cycle5AdvancedQueuePattern,
  kind: "QB" | "OQB",
  runtimeMirror = false,
): string | null {
  const parts = pattern.scope === "visible-seven"
    ? (() => {
      const [classPart, ...rest] = pattern.parts;
      return classPart?.kind === "ordered" && classPart.symbols.length === 2 ? rest : null;
    })()
    : pattern.parts;
  if (!parts || parts.length === 0) return null;
  const queueLabel = cycle5AdvancedPatternBodyLabel(parts, runtimeMirror);
  if (!queueLabel) return null;
  return `${formatPieceSetForDisplay(classPieces)} - ${queueLabel} ${kind}`;
}

/**
 * Returns all source-ordered entries whose explicit normalized queue condition
 * matches. Physical reachability is evaluated by the caller only for these IDs.
 */
export function matchingCycle5AdvancedEntries(
  bundle: Cycle5AdvancedPolicyBundle,
  state: Cycle5AdvancedQueueState,
): Cycle5AdvancedEntryMatch[] {
  return bundle.entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.sourceOrder - right.entry.sourceOrder || left.index - right.index)
    .flatMap<Cycle5AdvancedEntryMatch>(({ entry }) => {
      if (entry.kind === "oqb") {
        return entry.initialPatterns.some((pattern) => cycle5AdvancedQueuePatternMatches(pattern, state))
          ? [{ entry, setupRefs: [] }]
          : [];
      }
      const seen = new Set<string>();
      const setupRefs = entry.alternatives
        .filter(({ pattern }) => cycle5AdvancedQueuePatternMatches(pattern, state))
        .flatMap(({ setupRefs: refs }) => refs)
        .filter((ref) => {
          const key = `${ref.setupId}\u0000${ref.transform ?? "identity"}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return setupRefs.length > 0 || entry.directTwoLinePc
        ? [{ entry, setupRefs }]
        : [];
    });
}

/** IDs that the synchronous and cooperative callers should submit to real BFS. */
export function cycle5AdvancedInitialBfsSetupIds(
  matches: readonly Cycle5AdvancedEntryMatch[],
): string[] {
  const seen = new Set<string>();
  return matches.flatMap((match) => {
    const ids = match.entry.kind === "oqb"
      ? (match.entry.preconditionSetupId ? [match.entry.preconditionSetupId] : [])
      : match.setupRefs.map(({ setupId }) => setupId);
    return ids.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });
}

/**
 * Applies policy before reachability. `buildableSetupIds` is the result of the
 * real BFS for only the matched initial setup/precondition IDs. Hold-X labels
 * are deliberately ignored here.
 */
export function selectCycle5AdvancedInitialDecision(
  matches: readonly Cycle5AdvancedEntryMatch[],
  buildableSetupIds: ReadonlySet<string>,
): Cycle5AdvancedInitialDecision | null {
  for (const match of matches) {
    if (match.entry.kind === "oqb") {
      const preconditionSetupId = match.entry.preconditionSetupId;
      if (preconditionSetupId && buildableSetupIds.has(preconditionSetupId)) {
        return {
          kind: "oqb",
          plan: match.entry,
          preconditionSetupId,
          bestsave: match.entry.bestsave,
        };
      }
      continue;
    }
    if (match.entry.directTwoLinePc) {
      return { kind: "two-line-pc", ruleId: match.entry.id };
    }
    const setupRefs = match.setupRefs.filter(({ setupId }) => buildableSetupIds.has(setupId));
    if (setupRefs.length > 0) {
      return {
        kind: "direct",
        ruleId: match.entry.id,
        setupRefs,
        bestsave: match.entry.bestsave,
      };
    }
  }
  return null;
}

/** Reveal/hidden-piece resolution is a direct branch lookup, not another BFS. */
export function resolveCycle5AdvancedOqbContinuation(
  plan: Cycle5AdvancedOqbPlan,
  observedPiece: Piece,
): Cycle5AdvancedContinuationDecision | null {
  const branch = plan.branches.find(({ observedPieces }) => observedPieces?.includes(observedPiece));
  if (!branch) return null;
  return {
    planId: plan.id,
    branchId: branch.id,
    continuationSetupRefs: branch.continuationSetupRefs,
    bestsave: typeof branch.bestsave === "boolean" ? branch.bestsave : plan.bestsave,
  };
}

function decisionForBranch(
  plan: Cycle5AdvancedOqbPlan,
  branch: Cycle5AdvancedOqbBranch,
): Cycle5AdvancedContinuationDecision {
  return {
    planId: plan.id,
    branchId: branch.id,
    continuationSetupRefs: branch.continuationSetupRefs,
    ...(branch.terminal ? { terminal: true as const } : {}),
    bestsave: typeof branch.bestsave === "boolean" ? branch.bestsave : plan.bestsave,
  };
}

function revealIndex(uiSlot: string): number | null {
  const match = /^NEXT\[(\d+)]$/.exec(uiSlot);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

/**
 * Reads only the promoted executable observation fields from the live queue.
 * HOLD is intentionally excluded from hidden-piece and relative-order scans:
 * it can belong to an earlier bag and therefore cannot establish bag order.
 */
export function observeCycle5AdvancedOqb(
  plan: Cycle5AdvancedOqbPlan,
  state: Cycle5AdvancedQueueState,
): Cycle5AdvancedOqbObservationResult {
  if (plan.observation.kind === "reveal") {
    const uiSlot = plan.observation.uiSlot;
    if (!uiSlot) return { status: "unresolved", reason: "missing-reveal-slot" };
    const index = revealIndex(uiSlot);
    const piece = index === null ? undefined : state.next[index];
    if (!piece) return { status: "unresolved", reason: "reveal-not-visible" };
    const observation: Cycle5AdvancedObservedQueue = {
      kind: "piece",
      piece,
      source: "reveal",
      uiSlot,
    };
    const branch = plan.branches.find(({ observedPieces }) => observedPieces?.includes(piece));
    return branch
      ? { status: "matched", observation, decision: decisionForBranch(plan, branch) }
      : { status: "unresolved", reason: "branch-not-matched", observation };
  }

  const liveQueue = [state.active, ...state.next];
  if (plan.observation.kind === "hidden-bag-piece") {
    const known = [...new Set(plan.observation.knownRemainingBagPieces)];
    const visible: Piece[] = [];
    for (const piece of liveQueue) {
      if (!known.includes(piece) || visible.includes(piece)) continue;
      visible.push(piece);
      if (visible.length === plan.observation.visibleCountFromThatSet) break;
    }
    const hidden = known.filter((piece) => !visible.includes(piece));
    if (visible.length !== plan.observation.visibleCountFromThatSet || hidden.length !== 1) {
      return { status: "unresolved", reason: "hidden-piece-not-unique" };
    }
    const observation: Cycle5AdvancedObservedQueue = {
      kind: "piece",
      piece: hidden[0]!,
      source: "hidden-bag-piece",
    };
    const branch = plan.branches.find(({ observedPieces }) => observedPieces?.includes(hidden[0]!));
    return branch
      ? { status: "matched", observation, decision: decisionForBranch(plan, branch) }
      : { status: "unresolved", reason: "branch-not-matched", observation };
  }

  const [first, second] = plan.observation.pieces;
  const firstIndex = liveQueue.indexOf(first);
  const secondIndex = liveQueue.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) {
    return { status: "unresolved", reason: "relative-order-not-visible" };
  }
  const observation: Cycle5AdvancedObservedQueue = firstIndex < secondIndex
    ? { kind: "relative-order", before: first, after: second }
    : { kind: "relative-order", before: second, after: first };
  const branch = plan.branches.find(({ relativeOrder }) =>
    relativeOrder?.before === observation.before && relativeOrder.after === observation.after);
  return branch
    ? { status: "matched", observation, decision: decisionForBranch(plan, branch) }
    : { status: "unresolved", reason: "branch-not-matched", observation };
}

/** Resolves the ordered nested branch after its parent continuation checkpoint. */
export function observeCycle5AdvancedPostCheckpoint(
  checkpoint: Cycle5AdvancedPostCheckpoint,
  state: Cycle5AdvancedQueueState,
): Cycle5AdvancedPostCheckpointResult {
  const probe: Cycle5AdvancedOqbPlan = {
    id: "post-checkpoint-probe",
    kind: "oqb",
    sourceOrder: 0,
    initialPatterns: [],
    preconditionSetupId: null,
    checkpoint: { placedCount: 1 },
    observation: checkpoint.observation,
    branches: checkpoint.branches
      .filter(({ fallback }) => fallback !== true)
      .map((branch) => ({
        id: branch.id,
        observedPieces: branch.observedPieces,
        continuationSetupRefs: [],
      })),
  };
  const observed = observeCycle5AdvancedOqb(probe, state);
  if (observed.status === "matched") {
    const branch = checkpoint.branches.find(({ id }) => id === observed.decision.branchId);
    if (branch) return { status: "matched", observation: observed.observation, branch };
  }
  const fallback = checkpoint.branches.find(({ fallback }) => fallback === true);
  if (fallback && observed.observation) {
    return { status: "matched", observation: observed.observation, branch: fallback };
  }
  return observed.status === "unresolved"
    ? observed
    : { status: "unresolved", reason: "branch-not-matched" };
}

export function cycle5AdvancedSetupDisplayName(
  displayName: string,
  setupRef: Cycle5AdvancedSetupRef,
): string {
  return setupRef.displayHoldPiece === undefined
    ? displayName
    : `${displayName} (Hold ${setupRef.displayHoldPiece})`;
}
