import type { Board, Cycle, Piece } from "../engine/types";
import { formatPieceSetForDisplay } from "../engine/pieceDisplay";
import { setupPolicyForCycle, setupsForCycle, setupsForCycle2Advanced3P, setupsForCycle2General, setupsForCycle3Class, setupsForCycle4Class, setupsForCycle5Class, setupsForCycle6Class } from "./catalog";
import { cycle1QueueContext, isNormalCycle1Context } from "./cycle1Context";
import { cycle2AdvancedQbConditionLabel, cycle2AdvancedQbSaveTargets, selectCycle2AdvancedQbSetups } from "./cycle2AdvancedQb";
import { cycle2AdvancedQbRuntimeBundle } from "./cycle2AdvancedQbCatalog";
import { cycle2QueueContext, fitsCycle2BuildPool } from "./cycle2Context";
import { cycle3QueueContext, fitsCycle3BuildPool } from "./cycle3Context";
import { cycle4ClassLabel } from "./cycle4Catalog";
import { cycle4QueueContext, fitsCycle4BuildPool } from "./cycle4Context";
import { cycle5PiecePairKey, cycle5QueueContext, fitsCycle5BuildPool } from "./cycle5Context";
import {
  cycle5AdvancedInitialBfsSetupIds,
  cycle5AdvancedQueuePatternMatches,
  cycle5AdvancedRecommendationLabel,
  matchingCycle5AdvancedEntries,
  selectCycle5AdvancedInitialDecision,
  type Cycle5AdvancedSetupRef,
  type Cycle5AdvancedQueuePattern,
} from "./cycle5AdvancedPolicy";
import { promotedCycle5AdvancedBundleForPair } from "./cycle5AdvancedCatalog";
import { cycle6QueueContext, fitsCycle6BuildPool } from "./cycle6Context";
import { cycle7Advanced4pGoodCycle8Rate, cycle7Advanced4pMatches, cycle7Advanced4pRuntimeBundle } from "./cycle7Advanced4pCatalog";
import { cycle7QueueContext, fitsCycle7BuildPool } from "./cycle7Context";
import { cycle7QbCatalogForClass, cycle7QbClass, cycle7QbConditionRank, cycle7QbDisplayName, cycle7QbNextBag, cycle7QbPolicyEntryForSetup, cycle7QbRecommendationRank, cycle7QbRuntimeBundle, cycle7QbSourceOrder, type Cycle7QbPolicyEntry } from "./cycle7QbCatalog";
import { conditionMatches, evaluateSelectionPolicy, type PolicyEvaluation, type SetupSelectionRule, type StructuredSetupPolicy } from "./policy";
import { findBuildPlan, findBuildPlanCooperative, type BuildPlan, type CooperativeSearchControl, type ReachabilityCache } from "./reachability";
import { canonicalLabeledMirrorGeometryKey } from "./logicalGrouping";
import { mirrorPiece, mirrorSetup } from "./mirror";
import { isSolutionShadowSetup, type SetupVariant } from "./schema";
import { setupGeometryProgress } from "./setupGeometryProgress";
import {
  recommendationSourceForBundle,
  selectedBundlesForCycle,
  type RecommendationSourceIdentity,
  type SelectedRecommendationBundle,
  type SelectedRecommendationScope,
} from "./recommendationScope";
import { normalizeSelectedCycle5AdvancedPolicy } from "./selectedCycle5AdvancedPolicyAdapter";
import {
  canonicalCycle8TxSetupId,
  cycle8TxCatalogForClass,
  cycle8TxConditionLabel,
  cycle8TxExactClass,
  cycle8TxOqbBranch,
  cycle8TxRuntimeBundle,
  cycle8TxRuntimeEntryForSetup,
  matchingCycle8TxDirectQbEntries,
  matchingCycle8TxOqbPlans,
  type Cycle8TxFamilyKind,
  type Cycle8TxQueueState,
} from "./cycle8TxCatalog";
import {
  cycle8LjxCatalogForClass,
  cycle8LjxExactClass,
  cycle8LjxRuntimeBundle,
  cycle8LjxRuntimeEntryForSetup,
  cycle8LjxScoreForSetup,
  type Cycle8LjxFamilyKind,
} from "./cycle8LjxCatalog";

export interface SetupQuery {
  cycle: Cycle;
  board: Board;
  active: Piece;
  hold: Piece | null;
  next: Piece[];
  /** @deprecated Practice mode always permits HOLD; retained for replay/query compatibility. */
  holdAvailable?: boolean;
  /** 전수조사 등에서 전체 반환 수를 명시적으로 제한한다. UI 기본 그룹 한도보다 우선한다. */
  maxCandidates?: number;
}

export interface SetupCandidate {
  setup: SetupVariant;
  plan: BuildPlan;
  score: readonly number[];
  reasons: string[];
  policy?: {
    ruleId: string;
    branchId: string;
    preferred: boolean;
  };
  qbCondition?: string;
  /** Exact human-facing queue label. It bypasses unordered piece-name normalization. */
  recommendationLabel?: string;
  /** Final PC save targets attached to a Cycle-2 advanced QB recommendation. */
  qbSaveTargets?: Piece[];
  /** Source-defined chance of entering a good Cycle 8; this is not a PC solve rate. */
  goodCycle8EntryRate?: number;
  /** Non-persisted identity of the selected diagnostic bundle that produced it. */
  recommendationSource?: RecommendationSourceIdentity;
}

export interface StagedSetupResolution {
  ruleId: string;
  branchId: string;
  observation: Piece[];
  action: "extend-setup" | "solve-from-precondition";
  instruction: string;
  /** Policy-selected authoritative full geometry. No placement-order plan is derived here. */
  continuation?: SetupVariant;
}

export function candidateScore(setup: SetupVariant): readonly number[] {
  return [
    setup.solveRate === undefined ? Number.MAX_SAFE_INTEGER : -setup.solveRate,
    -(setup.priority ?? 0),
    setup.difficulty,
    setup.saves === undefined ? Number.MAX_SAFE_INTEGER : -setup.saves,
  ];
}

export function compareScores(a: SetupCandidate, b: SetupCandidate): number {
  const difference = compareScoreValues(a.score, b.score);
  return difference || a.setup.id.localeCompare(b.setup.id);
}

/**
 * Groups with this prefix describe one source hierarchy whose members are
 * alternative completion stages. Unlike ordinary recommendation groups, all
 * members must reach BFS before the highest buildable stage can be selected.
 */
export const HIGHEST_BUILDABLE_STAGE_GROUP_PREFIX = "stage:";

export function isHighestBuildableStageRecommendationGroup(group: string | undefined): boolean {
  return group?.startsWith(HIGHEST_BUILDABLE_STAGE_GROUP_PREFIX) ?? false;
}

export function retainHighestBuildableRecommendationStages(
  candidates: SetupCandidate[],
): SetupCandidate[] {
  const maximumStageByGroup = new Map<string, number>();
  for (const { setup } of candidates) {
    const group = setup.recommendationGroup;
    if (!isHighestBuildableStageRecommendationGroup(group)) continue;
    maximumStageByGroup.set(group!, Math.max(
      maximumStageByGroup.get(group!) ?? 0,
      setup.placements.length,
    ));
  }
  const seenPhysicalFormsByChild = new Set<string>();
  return candidates.filter(({ setup }) => {
    const group = setup.recommendationGroup;
    if (!isHighestBuildableStageRecommendationGroup(group)) return true;
    if (setup.placements.length !== maximumStageByGroup.get(group!)) return false;
    const childKey = `${group}|${canonicalSourceSetupId(setup)}`;
    if (seenPhysicalFormsByChild.has(childKey)) return false;
    seenPhysicalFormsByChild.add(childKey);
    return true;
  });
}

function compareScoreValues(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function canonicalSourceSetupId(setup: SetupVariant): string {
  return setup.policySourceId ?? setup.id.split("--box-")[0].replace(/--mirror$/, "");
}

/**
 * 같은 원본에서 파생된 좌우 미러가 동일한 확률로 추천될 때는 위치만 다른
 * 선택지이므로 UI에 하나만 노출한다. 확률이 없거나 서로 다르면 별도 후보로
 * 유지해 방향별 도달성/퍼클률 차이를 숨기지 않는다.
 */
function equalRateMirrorRecommendationKey(
  setup: SetupVariant,
  policyEvaluation?: PolicyEvaluation | null,
): string | null {
  const hasMirrorRelation = setup.mirrorOf !== undefined
    || setup.mirroredVariantId !== undefined
    || isMirroredRuntimeVariant(setup);
  if (!hasMirrorRelation || setup.solveRate === undefined) return null;
  // A conditional orientation must not be chosen arbitrarily before its observation is visible.
  if (policyEvaluation?.branchId === "unobserved") return null;
  const policyScope = policyEvaluation
    ? `${policyEvaluation.ruleId}|${policyEvaluation.branchId}`
    : "unconditional";
  return `${setup.cycle}|${setup.family}|${canonicalLabeledMirrorGeometryKey(setup)}|${setup.solveRate}|${policyScope}`;
}

function isMirroredRuntimeVariant(setup: SetupVariant): boolean {
  return setup.id.split("--box-")[0].endsWith("--mirror");
}

function stagedRules(policy?: StructuredSetupPolicy): SetupSelectionRule[] {
  return policy?.selectionRules.filter((rule) =>
    rule.observation.runtimeSource === "visible-next-tail-after-precondition"
      && (rule.preconditionSetupIds?.length ?? 0) > 0) ?? [];
}

function cycle3InitialStageCatalog(
  catalog: readonly SetupVariant[],
  policy?: StructuredSetupPolicy,
  policyPrefix?: Piece[],
): SetupVariant[] {
  const rules = policy?.selectionRules ?? [];
  const continuationIds = new Set(stagedRules(policy).flatMap((rule) => [
    ...rule.branches.flatMap((branch) => branch.continuationSetupIds ?? []),
    ...(rule.default?.continuationSetupIds ?? []),
  ]));
  return catalog.filter((setup) => {
    const sourceId = canonicalSourceSetupId(setup);
    if (continuationIds.has(sourceId)) return false;
    const eligibilityRules = rules.filter((rule) => {
      if (!rule.initialEligibility) return false;
      const initialIds = rule.preconditionSetupIds ?? rule.candidateSetupIds;
      return initialIds.includes(sourceId);
    });
    if (eligibilityRules.length === 0) return true;
    if (!policyPrefix) return false;
    const sourcePrefix = isMirroredRuntimeVariant(setup)
      ? policyPrefix.map(mirrorPiece)
      : policyPrefix;
    return eligibilityRules.some((rule) => {
      const eligibility = rule.initialEligibility!;
      if (sourcePrefix.length < eligibility.observation.length) return false;
      return conditionMatches(
        eligibility.when,
        sourcePrefix.slice(0, eligibility.observation.length),
      );
    });
  });
}

/** Source says the TILS OQB fallback is used only when the earlier normal T+ILS is unreachable. */
function enforceCycle3BuildabilityFallback(
  candidates: SetupCandidate[],
  policies: Array<StructuredSetupPolicy | undefined>,
): SetupCandidate[] {
  const buildableIds = new Set(candidates.map(({ setup }) => canonicalSourceSetupId(setup)));
  return candidates.filter(({ setup }) => {
    const sourceId = canonicalSourceSetupId(setup);
    const rules = policies.flatMap((policy) => policy?.selectionRules ?? []).filter((rule) => {
      if (!rule.initialEligibility?.requiresUnbuildableSetupIds?.length) return false;
      return (rule.preconditionSetupIds ?? rule.candidateSetupIds).includes(sourceId);
    });
    return rules.every((rule) =>
      !rule.initialEligibility!.requiresUnbuildableSetupIds!.some((id) => buildableIds.has(id)));
  });
}

function selectedCycle3ClassCatalog(
  bundle: Extract<SelectedRecommendationBundle, { kind: "structured" }>,
  classPiece: Piece,
): SetupVariant[] {
  const binding = bundle.cycle3ClassBinding;
  if (!binding || (binding.source !== classPiece && binding.mirror !== classPiece)) return [];
  if (binding.source === binding.mirror || binding.mirror === undefined) return bundle.catalog;
  const mirroredClass = classPiece === binding.mirror;
  return bundle.catalog.filter((setup) => isMirroredRuntimeVariant(setup) === mirroredClass);
}

function compatibleContinuationGeometry(setup: SetupVariant, board: Board): SetupVariant | null {
  if (isSolutionShadowSetup(setup)) return setup;
  const progress = setupGeometryProgress(setup, board);
  return progress.status === "in-progress" ? setup : null;
}

export function cycle3StagedPreconditionRule(
  query: SetupQuery,
  precondition: SetupVariant,
): SetupSelectionRule | null {
  if (query.cycle !== 3) return null;
  const sourceId = canonicalSourceSetupId(precondition);
  const classPiece: Piece | null = sourceId.startsWith("cycle3-extra-t-") ? "T" : query.hold;
  if (!classPiece) return null;
  const policy = setupPolicyForCycle(3, classPiece);
  return stagedRules(policy).find((candidate) => candidate.preconditionSetupIds?.includes(sourceId)) ?? null;
}

/**
 * 공통 2P/3P 선행 셋업이 완성된 직후, 현재 보이는 NEXT 꼬리에서 다음 가방
 * prefix를 읽어 QB/OQB의 연장 geometry 또는 즉시 해법 전환을 결정한다.
 */
export function resolveCycle3StagedSetup(
  query: SetupQuery,
  precondition: SetupVariant,
): StagedSetupResolution | null {
  const sourceId = canonicalSourceSetupId(precondition);
  const classPiece: Piece | null = sourceId.startsWith("cycle3-extra-t-") ? "T" : query.hold;
  if (!classPiece) return null;
  const rule = cycle3StagedPreconditionRule(query, precondition);
  if (!rule || query.next.length < rule.observation.length) return null;

  const visibleObservation = query.next.slice(-rule.observation.length);
  const sourceObservation = isMirroredRuntimeVariant(precondition)
    ? visibleObservation.map(mirrorPiece)
    : visibleObservation;
  const branch = rule.branches.find(({ when }) => conditionMatches(when, sourceObservation));
  const outcome = branch ?? rule.default;
  if (!outcome?.stagedAction) return null;
  const instruction = outcome.instruction
    ?? (outcome.stagedAction === "extend-setup" ? "Continue to the conditional setup." : "Use the solve from the completed base setup.");
  const base = {
    ruleId: rule.id,
    branchId: branch?.id ?? "default",
    observation: visibleObservation,
    action: outcome.stagedAction,
    instruction,
  } as const;
  if (outcome.stagedAction === "solve-from-precondition") return base;

  const continuationIds = new Set(outcome.continuationSetupIds ?? []);
  const classCatalog = setupsForCycle3Class(classPiece);
  const continuations: SetupVariant[] = [];
  for (const setup of classCatalog) {
    if (!continuationIds.has(canonicalSourceSetupId(setup))) continue;
    const continuation = compatibleContinuationGeometry(setup, query.board);
    if (continuation) continuations.push(continuation);
  }
  const continuation = continuations.sort((left, right) =>
    compareScoreValues(candidateScore(left), candidateScore(right))
      || left.id.localeCompare(right.id))[0];
  return { ...base, continuation };
}

const PIECE_COUNT_SECTION_CYCLES = new Set<Cycle>([1, 2, 3, 5, 6, 7]);
const FOUR_PLUS_CANDIDATE_LIMIT = 8;
export const THREE_P_CANDIDATE_LIMIT = 4;
const OTHER_P_CANDIDATE_LIMIT = 8;
const QB_CANDIDATE_LIMIT = 8;
export function splitsSetupCandidatesByPieceCount(cycle: Cycle): boolean {
  return PIECE_COUNT_SECTION_CYCLES.has(cycle);
}

/**
 * UI 대상 회차는 전역 정렬 순서를 유지하면서 P 수별 한도를 독립 적용한다.
 * 따라서 높은 순위의 4P+ 후보가 많아도 3P 후보 최대 4개가 잘리지 않는다.
 */
export function limitSetupCandidatesForCycle(
  candidates: SetupCandidate[],
  cycle: Cycle,
  maxCandidates?: number,
): SetupCandidate[] {
  if (maxCandidates !== undefined) return candidates.slice(0, maxCandidates);
  if (!splitsSetupCandidatesByPieceCount(cycle)) return candidates;

  let fourPlusCount = 0;
  let threePCount = 0;
  let otherCount = 0;
  let qbCount = 0;
  return candidates.filter(({ setup, qbCondition }) => {
    // QB is rendered in its own section and must not consume the ordinary 3P
    // quota before the UI projection separates the sections.
    if (qbCondition !== undefined) {
      qbCount += 1;
      return qbCount <= QB_CANDIDATE_LIMIT;
    }
    const pieceCount = setup.placements.length;
    if (pieceCount >= 4) {
      fourPlusCount += 1;
      return fourPlusCount <= FOUR_PLUS_CANDIDATE_LIMIT;
    }
    if (pieceCount === 3) {
      threePCount += 1;
      return threePCount <= THREE_P_CANDIDATE_LIMIT;
    }
    otherCount += 1;
    return otherCount <= OTHER_P_CANDIDATE_LIMIT;
  });
}

export interface RecommendationCatalogSearch {
  catalog: readonly SetupVariant[];
  query: SetupQuery;
  policy?: StructuredSetupPolicy;
  policyPrefix?: Piece[];
  policyCatalog?: readonly SetupVariant[];
  placeableNextCount?: number;
  candidateLimit?: number;
  scoreForSetup?: (setup: SetupVariant) => readonly number[];
  /** Data-domain cycle when it differs from the live game phase (Cycle 8 uses game Cycle 1). */
  setupCycle?: number;
  source?: RecommendationSourceIdentity;
}

export interface SingleStageRecommendationPlan {
  searches: RecommendationCatalogSearch[];
  finalize: (batches: SetupCandidate[][]) => SetupCandidate[];
}

export type RecommendationStage = "primary" | "secondary";

export interface StagedRecommendationResult {
  stage: RecommendationStage;
  candidates: SetupCandidate[];
  preferredCandidateId: string | null;
  complete: boolean;
}

export type RecommendationProgramOperation =
  | { type: "search"; search: RecommendationCatalogSearch }
  | { type: "stage"; result: StagedRecommendationResult };

export type RecommendationProgram = Generator<
  RecommendationProgramOperation,
  SetupCandidate[],
  SetupCandidate[]
>;

function selectedStructuredPlan(
  query: SetupQuery,
  scope: SelectedRecommendationScope,
): SingleStageRecommendationPlan | null {
  if (query.cycle === 2 || query.cycle === 7) return null;
  const bundles = selectedBundlesForCycle(scope, query.cycle)
    .filter((bundle): bundle is Extract<SelectedRecommendationBundle, { kind: "structured" }> =>
      bundle.kind === "structured");

  if (query.cycle === 1) {
    const context = cycle1QueueContext(query);
    if (!context || !isNormalCycle1Context(context)) return { searches: [], finalize: () => [] };
    return {
      searches: bundles.map((bundle) => ({
        catalog: bundle.catalog,
        query: { ...query, next: context.searchNext },
        policy: bundle.policy,
        policyCatalog: bundle.catalog,
        placeableNextCount: context.placeableNextCount,
        source: recommendationSourceForBundle(bundle),
      })),
      finalize: (batches) => limitSetupCandidatesForCycle(
        batches.flat().sort(compareScores), 1, query.maxCandidates),
    };
  }

  if (query.cycle === 3) {
    const context = cycle3QueueContext(query);
    if (!context) return { searches: [], finalize: () => [] };
    return {
      searches: bundles.flatMap((bundle) => {
        const classCatalog = selectedCycle3ClassCatalog(bundle, context.classPiece);
        if (classCatalog.length === 0) return [];
        const initialCatalog = cycle3InitialStageCatalog(
          classCatalog,
          bundle.policy,
          context.policyPrefix,
        );
        return {
          catalog: initialCatalog.filter((setup) => fitsCycle3BuildPool(setup, context.buildPieces)),
          query: { ...query, next: context.searchNext },
          policy: bundle.policy,
          policyPrefix: context.policyPrefix,
          policyCatalog: initialCatalog,
          placeableNextCount: context.placeableNextCount,
          source: recommendationSourceForBundle(bundle),
        };
      }),
      finalize: (batches) => limitSetupCandidatesForCycle(
        enforceCycle3BuildabilityFallback(
          batches.flat(),
          bundles.map(({ policy }) => policy),
        ).sort(compareScores),
        3,
        query.maxCandidates,
      ),
    };
  }

  if (query.cycle === 4) {
    const context = cycle4QueueContext(query);
    if (!context || context.classificationMode === "duplicate-pool-unsupported") {
      return { searches: [], finalize: () => [] };
    }
    const classLabel = cycle4ClassLabel(context.missingPieces)
      ?? formatPieceSetForDisplay(context.missingPieces);
    return {
      searches: bundles.map((bundle) => ({
        catalog: bundle.catalog.filter((setup) => fitsCycle4BuildPool(setup, context.buildPieces)),
        query: { ...query, next: context.searchNext },
        policy: bundle.policy,
        policyCatalog: bundle.catalog,
        placeableNextCount: context.placeableNextCount,
        source: recommendationSourceForBundle(bundle),
      })),
      finalize: (batches) => batches.flat().map((candidate) => ({
        ...candidate,
        reasons: [`Classified as Cycle 4 No ${classLabel} from the first five pieces.`, ...candidate.reasons],
      })).sort(compareScores).slice(0, query.maxCandidates ?? 8),
    };
  }

  if (query.cycle === 5) {
    const context = cycle5QueueContext(query);
    if (!context || context.classificationMode === "duplicate-pair-unsupported") {
      return { searches: [], finalize: () => [] };
    }
    const classLabel = formatPieceSetForDisplay(context.classPieces, "/");
    return {
      searches: bundles.map((bundle) => ({
        // Explicit selection is the diagnostic activation gate; do not apply
        // runtimeEligible/review gates a second time here.
        catalog: bundle.catalog.filter((setup) =>
          setup.cycle === 5 && fitsCycle5BuildPool(setup, context.buildPieces)),
        query: { ...query, next: context.searchNext },
        policy: bundle.policy,
        policyCatalog: bundle.catalog,
        placeableNextCount: context.placeableNextCount,
        source: recommendationSourceForBundle(bundle),
      })),
      finalize: (batches) => {
        const candidates = batches.flat().map((candidate) => ({
          ...candidate,
          reasons: [`Classified as Cycle 5 ${classLabel} from HOLD + ACTIVE.`, ...candidate.reasons],
        })).sort(compareScores);
        const seenIds = new Set<string>();
        const seenGroups = new Set<string>();
        return limitSetupCandidatesForCycle(candidates.filter(({ setup }) => {
          if (seenIds.has(setup.id)) return false;
          if (setup.recommendationGroup
            && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)
            && seenGroups.has(setup.recommendationGroup)) return false;
          seenIds.add(setup.id);
          if (setup.recommendationGroup
            && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)) {
            seenGroups.add(setup.recommendationGroup);
          }
          return true;
        }), 5, query.maxCandidates);
      },
    };
  }

  if (query.cycle === 6) {
    const context = cycle6QueueContext(query);
    if (!context || context.classificationMode === "duplicate-pool-unsupported") {
      return { searches: [], finalize: () => [] };
    }
    return {
      searches: bundles.map((bundle) => ({
        catalog: bundle.catalog.filter((setup) => fitsCycle6BuildPool(setup, context.buildPieces)),
        query: { ...query, next: context.searchNext },
        policy: bundle.policy,
        policyCatalog: bundle.catalog,
        placeableNextCount: context.placeableNextCount,
        source: recommendationSourceForBundle(bundle),
      })),
      finalize: (batches) => {
        const seenIds = new Set<string>();
        const seenGroups = new Set<string>();
        return limitSetupCandidatesForCycle(batches.flat().sort(compareScores).filter(({ setup }) => {
          if (seenIds.has(setup.id)) return false;
          if (setup.recommendationGroup && seenGroups.has(setup.recommendationGroup)) return false;
          seenIds.add(setup.id);
          if (setup.recommendationGroup) seenGroups.add(setup.recommendationGroup);
          return true;
        }), 6, query.maxCandidates);
      },
    };
  }

  return { searches: [], finalize: () => [] };
}

/**
 * Shared orchestration for recommendation cycles that complete in one stage.
 * Both the synchronous API and the Worker API execute this exact catalog plan;
 * only the reachability executor differs.
 */
export function singleStageRecommendationPlan(
  query: SetupQuery,
  scope?: SelectedRecommendationScope,
): SingleStageRecommendationPlan | null {
  if (scope) return selectedStructuredPlan(query, scope);
  if (query.cycle === 1) {
    const context = cycle1QueueContext(query);
    if (!context || !isNormalCycle1Context(context)) {
      return { searches: [], finalize: () => [] };
    }
    return {
      searches: [{
        catalog: setupsForCycle(1),
        query: { ...query, next: context.searchNext },
        placeableNextCount: context.placeableNextCount,
      }],
      finalize: ([candidates = []]) =>
        limitSetupCandidatesForCycle(candidates, 1, query.maxCandidates),
    };
  }

  if (query.cycle === 3) {
    const context = cycle3QueueContext(query);
    if (!context) return { searches: [], finalize: () => [] };
    const classCatalog = setupsForCycle3Class(context.classPiece);
    const policy = setupPolicyForCycle(3, context.classPiece);
    const initialCatalog = cycle3InitialStageCatalog(
      classCatalog,
      policy,
      context.policyPrefix,
    );
    return {
      searches: [{
        catalog: initialCatalog.filter((setup) => fitsCycle3BuildPool(setup, context.buildPieces)),
        query: { ...query, next: context.searchNext },
        policy,
        policyPrefix: context.policyPrefix,
        policyCatalog: initialCatalog,
        placeableNextCount: context.placeableNextCount,
      }],
      finalize: ([candidates = []]) =>
        limitSetupCandidatesForCycle(
          enforceCycle3BuildabilityFallback(candidates, [policy]),
          3,
          query.maxCandidates,
        ),
    };
  }

  if (query.cycle === 4) {
    const context = cycle4QueueContext(query);
    if (!context || context.classificationMode === "duplicate-pool-unsupported") {
      return { searches: [], finalize: () => [] };
    }
    const classCatalog = setupsForCycle4Class(context.missingPieces);
    const classLabel = cycle4ClassLabel(context.missingPieces)
      ?? formatPieceSetForDisplay(context.missingPieces);
    return {
      searches: [{
        catalog: classCatalog.filter((setup) => fitsCycle4BuildPool(setup, context.buildPieces)),
        query: { ...query, next: context.searchNext },
        policyCatalog: classCatalog,
        placeableNextCount: context.placeableNextCount,
      }],
      finalize: ([candidates = []]) => candidates.map((candidate) => ({
        ...candidate,
        reasons: [`Classified as Cycle 4 No ${classLabel} from the first five pieces.`, ...candidate.reasons],
      })).sort(compareScores).slice(0, query.maxCandidates ?? 8),
    };
  }

  if (query.cycle === 5) {
    const context = cycle5QueueContext(query);
    if (!context || context.classificationMode === "duplicate-pair-unsupported") {
      return { searches: [], finalize: () => [] };
    }
    const classCatalog = setupsForCycle5Class(context.classPieces);
    const classLabel = formatPieceSetForDisplay(context.classPieces, "/");
    return {
      searches: [{
        catalog: classCatalog.filter((setup) =>
          setup.cycle === 5
          && setup.runtimeEligible !== false
          && fitsCycle5BuildPool(setup, context.buildPieces)),
        query: { ...query, next: context.searchNext },
        policyCatalog: classCatalog,
        placeableNextCount: context.placeableNextCount,
      }],
      finalize: ([batch = []]) => {
        const candidates = batch.map((candidate) => ({
          ...candidate,
          reasons: [
            `Classified as Cycle 5 ${classLabel} from HOLD + ACTIVE.`,
            ...(candidate.setup.bestsave
              ? ["The source marks this as an unconditional Bestsave setup, so it always avoids Cycle 6 No T."]
              : []),
            ...candidate.reasons,
          ],
        })).sort(compareScores);
        const seenIds = new Set<string>();
        const seenGroups = new Set<string>();
        return limitSetupCandidatesForCycle(candidates.filter(({ setup }) => {
          if (seenIds.has(setup.id)) return false;
          if (setup.recommendationGroup
            && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)
            && seenGroups.has(setup.recommendationGroup)) return false;
          seenIds.add(setup.id);
          if (setup.recommendationGroup
            && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)) {
            seenGroups.add(setup.recommendationGroup);
          }
          return true;
        }), 5, query.maxCandidates);
      },
    };
  }

  if (query.cycle === 6) {
    const context = cycle6QueueContext(query);
    if (!context || context.classificationMode === "duplicate-pool-unsupported") {
      return { searches: [], finalize: () => [] };
    }
    const searches = context.classPieces.flatMap<RecommendationCatalogSearch>((classPiece) => {
      const classCatalog = setupsForCycle6Class(classPiece);
      const buildable = classCatalog.filter((setup) =>
        fitsCycle6BuildPool(setup, context.buildPieces));
      return [{
        catalog: buildable,
        query: { ...query, next: context.searchNext },
        policy: setupPolicyForCycle(6, classPiece),
        policyCatalog: classCatalog,
        placeableNextCount: context.placeableNextCount,
      }];
    });
    return {
      searches,
      finalize: (batches) => {
        const candidates = batches.flatMap((batch, index) => {
          const classPiece = context.classPieces[index];
          return batch.map((candidate) => ({
            ...candidate,
            reasons: [
              `Classified as Cycle 6 No ${classPiece} from the first six pieces.`,
              ...candidate.reasons,
            ],
          }));
        }).sort(compareScores);
        const seenIds = new Set<string>();
        const seenGroups = new Set<string>();
        return limitSetupCandidatesForCycle(candidates.filter(({ setup }) => {
          if (seenIds.has(setup.id)) return false;
          if (setup.recommendationGroup && seenGroups.has(setup.recommendationGroup)) return false;
          seenIds.add(setup.id);
          if (setup.recommendationGroup) seenGroups.add(setup.recommendationGroup);
          return true;
        }), 6, query.maxCandidates);
      },
    };
  }

  return null;
}

function executeRecommendationSearchSync(search: RecommendationCatalogSearch): SetupCandidate[] {
  const candidates = queryCatalogInternal(
    search.catalog,
    search.query,
    search.policy,
    search.policyPrefix,
    search.policyCatalog,
    search.placeableNextCount,
    search.candidateLimit,
    search.scoreForSetup,
    search.setupCycle,
  );
  return search.source
    ? candidates.map((candidate) => ({ ...candidate, recommendationSource: search.source }))
    : candidates;
}

function limitCombined(candidates: SetupCandidate[], query: SetupQuery): SetupCandidate[] {
  return query.maxCandidates === undefined ? candidates : candidates.slice(0, query.maxCandidates);
}

function cycle2QbSearchPlan(
  query: SetupQuery,
  selectedBundle?: Extract<SelectedRecommendationBundle, { kind: "cycle2-qb" }>,
) {
  const context = cycle2QueueContext(query);
  const runtimeBundle = selectedBundle ? null : cycle2AdvancedQbRuntimeBundle();
  if (!context || (!selectedBundle && !runtimeBundle) || !context.policyPrefix) return null;
  const sourceCatalog = selectedBundle ? selectedBundle.catalog : runtimeBundle!.setups;
  const policy = selectedBundle ? selectedBundle.policy : runtimeBundle!.policy;
  const selections = selectCycle2AdvancedQbSetups(
    sourceCatalog,
    policy,
    context.buildPieces,
    context.policyPrefix,
    {
      deferRankSelectionUntilBuildable: true,
      includeRuntimeDisabled: selectedBundle !== undefined,
    },
  );
  if (selections.length === 0) return null;
  const selectionById = new Map(selections.map((selection) => [selection.setup.id, selection]));
  const catalog = selections.map(({ setup }) => setup);
  return {
    catalog,
    searchFor(selectedCatalog: readonly SetupVariant[]): RecommendationCatalogSearch {
      return {
        catalog: selectedCatalog,
        query: { ...query, next: context.searchNext },
        policyCatalog: selectedCatalog,
        placeableNextCount: context.placeableNextCount,
        source: selectedBundle ? recommendationSourceForBundle(selectedBundle) : undefined,
      };
    },
    finalize(buildable: SetupCandidate[]): SetupCandidate[] {
      const mapped = buildable.map((candidate) => {
        const selection = selectionById.get(candidate.setup.id);
        if (!selection) return candidate;
        const conditionLabel = cycle2AdvancedQbConditionLabel(selection.entry, selection.mirroredGeometry);
        return {
          ...candidate,
          score: [-2, selection.conditionRank, selection.entry.sourceOrder, ...candidate.score],
          reasons: [
            `${selection.classInfo.actualPool} Cycle 2 QB · ${conditionLabel}`,
            ...(selection.entry.runtimeCondition?.guidance ? [selection.entry.runtimeCondition.guidance] : []),
            "Builds only the source QB's initial 3P/4P baseline; continuation guidance is currently deferred.",
            ...candidate.reasons,
          ],
          qbCondition: conditionLabel,
          qbSaveTargets: cycle2AdvancedQbSaveTargets(selection.entry, selection.mirroredGeometry),
        };
      });
      const specific = mapped.filter(({ setup }) => selectionById.get(setup.id)?.fallbackCondition === false);
      return (specific.length > 0
        ? specific
        : mapped.filter(({ setup }) => selectionById.get(setup.id)?.fallbackCondition === true))
        .sort(compareScores)
        .slice(0, query.maxCandidates ?? 8);
    },
  };
}

function isMirroredSetupVariant(setup: SetupVariant): boolean {
  return setup.id.split("--box-")[0].endsWith("--mirror")
    || setup.derivedVariant === "mirror";
}

function setupMatchesCycle5AdvancedRef(
  setup: SetupVariant,
  ref: Cycle5AdvancedSetupRef,
  runtimeMirror = false,
): boolean {
  return canonicalSourceSetupId(setup) === ref.setupId
    && isMirroredSetupVariant(setup) === (runtimeMirror !== ((ref.transform ?? "identity") === "mirror-x"));
}

function setupPieceSignatureFitsPool(
  setup: SetupVariant,
  buildPieces: readonly Piece[],
): boolean {
  const available = [...buildPieces];
  return setup.pieceSignature.every((piece) => {
    const index = available.indexOf(piece);
    if (index < 0) return false;
    available.splice(index, 1);
    return true;
  });
}

function cycle5AdvancedSelectedSearchPlan(
  query: SetupQuery,
  bundle: Extract<SelectedRecommendationBundle, { kind: "cycle5-advanced" }>,
) {
  const context = cycle5QueueContext(query);
  if (!context || context.classificationMode === "duplicate-pair-unsupported" || query.hold === null) return null;
  const executablePolicy = normalizeSelectedCycle5AdvancedPolicy(bundle.policy, bundle.bundleId);
  const sourceState = bundle.runtimeMirror ? {
    hold: mirrorPiece(query.hold),
    active: mirrorPiece(query.active),
    next: query.next.map(mirrorPiece),
  } : {
    hold: query.hold,
    active: query.active,
    next: query.next,
  };
  const matchingPatternLabel = (
    patterns: readonly Cycle5AdvancedQueuePattern[],
    kind: "QB" | "OQB",
  ): string | undefined => {
    const pattern = patterns.find((candidate) =>
      cycle5AdvancedQueuePatternMatches(candidate, sourceState));
    return pattern
      ? cycle5AdvancedRecommendationLabel(
        context.classPieces,
        pattern,
        kind,
        bundle.runtimeMirror === true,
      ) ?? undefined
      : undefined;
  };
  const matches = matchingCycle5AdvancedEntries(executablePolicy, {
    ...sourceState,
  });
  // A directTwoLinePc entry is a terminal queue annotation, not a geometry
  // recommendation. It must not prevent a later executable OQB/direct entry
  // from reaching BFS in setup_test's selected-bundle projection.
  const actionableMatches = matches.filter((match) =>
    match.entry.kind !== "direct" || match.entry.directTwoLinePc !== true);
  const targetIds = new Set(cycle5AdvancedInitialBfsSetupIds(actionableMatches));
  if (targetIds.size === 0) return null;
  const directRefs = actionableMatches.flatMap((match) => match.entry.kind === "direct" ? match.setupRefs : []);
  const oqbIds = new Set(actionableMatches.flatMap((match) =>
    match.entry.kind === "oqb" && match.entry.preconditionSetupId
      ? [match.entry.preconditionSetupId]
      : []));
  const oqbPlacementCounts = new Map<string, Set<number>>();
  for (const match of actionableMatches) {
    if (match.entry.kind !== "oqb" || !match.entry.preconditionSetupId) continue;
    const counts = oqbPlacementCounts.get(match.entry.preconditionSetupId) ?? new Set<number>();
    counts.add(match.entry.checkpoint.placedCount);
    oqbPlacementCounts.set(match.entry.preconditionSetupId, counts);
  }
  const runtimeCatalog = bundle.runtimeMirror ? bundle.catalog.map(mirrorSetup) : bundle.catalog;
  const catalog = runtimeCatalog.filter((setup) => {
    const canonicalId = canonicalSourceSetupId(setup);
    if (!targetIds.has(canonicalId)) return false;
    if (bundle.productionGated
      && (setup.reviewStatus !== "reviewed" || setup.runtimeEligible !== true)) return false;
    if (oqbIds.has(canonicalId)) {
      return isMirroredSetupVariant(setup) === (bundle.runtimeMirror === true)
        && (oqbPlacementCounts.get(canonicalId)?.has(setup.placements.length) ?? false)
        && setupPieceSignatureFitsPool(setup, context.buildPieces);
    }
    if (!fitsCycle5BuildPool(setup, context.buildPieces)) return false;
    return directRefs.some((ref) => setupMatchesCycle5AdvancedRef(setup, ref, bundle.runtimeMirror));
  });
  return {
    search: {
      catalog,
      query: { ...query, next: context.searchNext },
      policyCatalog: runtimeCatalog,
      placeableNextCount: context.placeableNextCount,
      source: recommendationSourceForBundle(bundle),
    } satisfies RecommendationCatalogSearch,
    finalize(buildable: SetupCandidate[]): SetupCandidate[] {
      const buildableIds = new Set(buildable.map(({ setup }) => canonicalSourceSetupId(setup)));
      const decision = selectCycle5AdvancedInitialDecision(actionableMatches, buildableIds);
      if (!decision || decision.kind === "two-line-pc") return [];
      if (decision.kind === "oqb") {
        const recommendationLabel = matchingPatternLabel(decision.plan.initialPatterns, "OQB");
        return buildable.filter(({ setup }) =>
          canonicalSourceSetupId(setup) === decision.preconditionSetupId).map((candidate) => ({
          ...candidate,
          setup: typeof decision.bestsave === "boolean"
            ? { ...candidate.setup, bestsave: decision.bestsave }
            : candidate.setup,
          score: [-3, decision.plan.sourceOrder, ...candidate.score],
          reasons: [
            `Cycle 5 OQB precondition · ${decision.plan.id}`,
            `Observe the policy checkpoint after ${decision.plan.checkpoint.placedCount} placement(s).`,
            ...candidate.reasons,
          ],
          policy: {
            ruleId: decision.plan.id,
            branchId: "precondition",
            preferred: true,
          },
          qbCondition: decision.plan.id,
          ...(recommendationLabel ? { recommendationLabel } : {}),
        }));
      }
      const entry = executablePolicy.entries.find((candidate) =>
        candidate.kind === "direct" && candidate.id === decision.ruleId);
      return buildable.filter(({ setup }) =>
        decision.setupRefs.some((ref) => setupMatchesCycle5AdvancedRef(setup, ref, bundle.runtimeMirror))).map((candidate) => {
        const patterns = entry?.kind === "direct"
          ? entry.alternatives.filter((alternative) =>
            alternative.setupRefs.some((ref) =>
              setupMatchesCycle5AdvancedRef(candidate.setup, ref, bundle.runtimeMirror)))
            .map(({ pattern }) => pattern)
          : [];
        const recommendationLabel = matchingPatternLabel(patterns, "QB");
        return {
          ...candidate,
          setup: typeof decision.bestsave === "boolean"
            ? { ...candidate.setup, bestsave: decision.bestsave }
            : candidate.setup,
          score: [-3, ...candidate.score],
          reasons: [`Cycle 5 advanced queue rule · ${decision.ruleId}`, ...candidate.reasons],
          policy: {
            ruleId: decision.ruleId,
            branchId: "initial",
            preferred: true,
          },
          qbCondition: decision.ruleId,
          ...(recommendationLabel ? { recommendationLabel } : {}),
        };
      });
    },
  };
}

function selectedCycle7QbEntryForSetup(
  bundle: Extract<SelectedRecommendationBundle, { kind: "cycle7-qb" }>,
  setup: SetupVariant,
): Cycle7QbPolicyEntry | undefined {
  const id = canonicalSourceSetupId(setup);
  return bundle.policy.entries.find((entry) => entry.setupId === id);
}

function selectedCycle7QbRank(
  bundle: Extract<SelectedRecommendationBundle, { kind: "cycle7-qb" }>,
  classId: "LSZ" | "JSZ" | "ISZ" | "OSZ",
  entry: Cycle7QbPolicyEntry,
  nextBag: Piece[],
  setup: SetupVariant,
): number {
  const mirrored = isMirroredSetupVariant(setup);
  if (classId === "JSZ") {
    if (entry.mirror.kind !== "class-mirror" || !mirrored) return Number.POSITIVE_INFINITY;
  } else {
    if (entry.priorPoolClass !== classId) return Number.POSITIVE_INFINITY;
    if (entry.mirror.kind === "conditional-horizontal") {
      // Both forms are policy-addressable.
    } else if (mirrored) {
      return Number.POSITIVE_INFINITY;
    }
  }
  const sourceSequence = classId === "JSZ" ? nextBag.map(mirrorPiece) : nextBag;
  const conditionRank = cycle7QbConditionRank(entry, sourceSequence, setup);
  if (!Number.isFinite(conditionRank)) return conditionRank;
  const rule = bundle.policy.runtimePolicy?.formSelectionRules?.find((candidate) =>
    candidate.conditionId === entry.conditionId
    && (candidate.priorPoolClass === classId || candidate.mirrorClass === classId));
  if (!rule) return conditionRank;
  if (sourceSequence.length < rule.visiblePrefixLength) return Number.POSITIVE_INFINITY;
  const pivotIndex = sourceSequence.indexOf(rule.allBefore.pivot);
  const matches = pivotIndex >= 0 && rule.allBefore.pieces.every((piece) => {
    const index = sourceSequence.indexOf(piece);
    return index >= 0 && index < pivotIndex;
  });
  return canonicalSourceSetupId(setup) === (matches ? rule.selectSetupId : rule.otherwiseSetupId)
    ? conditionRank
    : Number.POSITIVE_INFINITY;
}

function selectedCycle7Advanced4pMatches(
  bundle: Extract<SelectedRecommendationBundle, { kind: "cycle7-advanced-4p" }>,
  buildPieces: Piece[],
  searchNext: Piece[],
  basePlaceableNextCount: number,
) {
  const signature = (pieces: readonly Piece[]) => [...pieces].sort().join("");
  const previousSignature = signature(buildPieces);
  if (buildPieces.length !== 3 || bundle.policy.runtimePolicy.fallbackClasses.some(({ classes }) =>
    classes.some((classId) => signature([...classId] as Piece[]) === previousSignature))) return [];
  const entries = new Map(bundle.policy.runtimePolicy.entries.map((entry) => [entry.setupId, entry]));
  const conditionalIds = new Set(bundle.policy.runtimePolicy.conditionalVariants
    .filter(({ requiresOqb }) => requiresOqb)
    .flatMap(({ branches }) => branches.map(({ setupId }) => setupId)));
  return bundle.catalog.flatMap((setup) => {
    const sourceId = canonicalSourceSetupId(setup);
    if (conditionalIds.has(sourceId)) return [];
    const sourceEntry = entries.get(sourceId);
    if (!sourceEntry) return [];
    const entry = isMirroredSetupVariant(setup) ? {
      ...sourceEntry,
      previousBagPieces: sourceEntry.previousBagPieces.map(mirrorPiece),
      fourthPieceFromNextBag: mirrorPiece(sourceEntry.fourthPieceFromNextBag),
      requiredHeldPieceAfterBuild: sourceEntry.requiredHeldPieceAfterBuild === null
        ? null
        : mirrorPiece(sourceEntry.requiredHeldPieceAfterBuild),
    } : sourceEntry;
    if (signature(entry.previousBagPieces) !== previousSignature || entry.nextBagSourcePosition !== 0) return [];
    const nextBagFirst = searchNext[basePlaceableNextCount];
    const nextBagSecond = searchNext[basePlaceableNextCount + 1];
    const usesFirst = entry.requiredHeldPieceAfterBuild === null
      && nextBagFirst === entry.fourthPieceFromNextBag;
    const usesSecond = nextBagSecond === entry.fourthPieceFromNextBag
      && (entry.requiredHeldPieceAfterBuild === null || nextBagFirst === entry.requiredHeldPieceAfterBuild);
    if (!usesFirst && !usesSecond) return [];
    if (signature(setup.pieceSignature) !== signature([
      ...entry.previousBagPieces,
      entry.fourthPieceFromNextBag,
    ])) return [];
    return [{
      setup,
      placeableNextCount: (usesFirst ? basePlaceableNextCount : basePlaceableNextCount + 1) + 1,
      savedPieceAfterBuild: usesFirst ? null : nextBagFirst ?? null,
      goodCycle8EntryRate: bundle.policy.runtimePolicy.goodCycle8.entryRates
        .find(({ setupId }) => setupId === sourceId)?.percent,
    }];
  });
}

/** One orchestration program shared by the synchronous API and Worker API. */
export function* recommendationProgram(
  query: SetupQuery,
  scope?: SelectedRecommendationScope,
): RecommendationProgram {
  if (!scope && query.cycle === 1) {
    const context = cycle1QueueContext(query);
    if (context?.classificationMode === "replacement-cycle" && context.replacement) {
      const ljxExactClass = cycle8LjxExactClass(
        context.replacement.extraPiece,
        context.replacement.replacedPiece,
      );
      const ljxBundle = cycle8LjxRuntimeBundle();
      if (ljxExactClass && ljxBundle) {
        const familyRank = new Map<Cycle8LjxFamilyKind, number>([
          ["general-4p", 0],
          ["general-3p", 1],
        ]);
        const search = (
          catalog: readonly SetupVariant[],
          familyKind: Cycle8LjxFamilyKind,
        ): RecommendationCatalogSearch => ({
          catalog,
          query: { ...query, next: context.searchNext },
          policyCatalog: ljxBundle.setups,
          placeableNextCount: context.placeableNextCount,
          setupCycle: 8,
          scoreForSetup: (setup) => [
            familyRank.get(familyKind)!,
            ...cycle8LjxScoreForSetup(setup, ljxExactClass),
            ...candidateScore(setup),
          ],
        });
        const annotate = (candidates: SetupCandidate[], familyKind: Cycle8LjxFamilyKind) =>
          candidates.map((candidate) => {
            const entry = cycle8LjxRuntimeEntryForSetup(candidate.setup);
            return {
              ...candidate,
              reasons: [
                `Classified as Cycle 8 ${ljxExactClass} from the exact seven-piece replacement window.`,
                `${familyKind === "general-4p" ? "General 4P" : "General 3P"} source family.`,
                ...(entry?.sourceRecommended === false ? ["The source marks this exact class as non-recommended."] : []),
                ...candidate.reasons,
              ],
            };
          });
        const general4 = annotate(yield {
          type: "search",
          search: search(cycle8LjxCatalogForClass(ljxExactClass, "general-4p"), "general-4p"),
        }, "general-4p");
        const general3 = annotate(yield {
          type: "search",
          search: search(cycle8LjxCatalogForClass(ljxExactClass, "general-3p"), "general-3p"),
        }, "general-3p");
        const candidates = limitSetupCandidatesForCycle([...general4, ...general3], 1, query.maxCandidates);
        yield {
          type: "stage",
          result: {
            stage: "primary",
            candidates,
            preferredCandidateId: candidates[0]?.setup.id ?? null,
            complete: true,
          },
        };
        return candidates;
      }
      const exactClass = cycle8TxExactClass(
        context.replacement.extraPiece,
        context.replacement.replacedPiece,
      );
      const bundle = cycle8TxRuntimeBundle();
      if (!exactClass || !bundle) {
        const result = { stage: "primary" as const, candidates: [], preferredCandidateId: null, complete: true };
        yield { type: "stage", result };
        return [];
      }

      const state: Cycle8TxQueueState = { hold: query.hold, active: query.active, next: query.next };
      const familyRank = new Map<Cycle8TxFamilyKind, number>([
        ["general-4p", 0],
        ["general-3p", 1],
        ["qb", 2],
        ["oqb", 3],
      ]);
      const search = (catalog: readonly SetupVariant[], familyKind: Cycle8TxFamilyKind): RecommendationCatalogSearch => ({
        catalog,
        query: { ...query, next: context.searchNext },
        policyCatalog: bundle.setups,
        placeableNextCount: context.placeableNextCount,
        setupCycle: 8,
        scoreForSetup: (setup) => [
          cycle8TxRuntimeEntryForSetup(setup)?.sourceOrder ?? Number.MAX_SAFE_INTEGER,
          ...candidateScore(setup),
        ],
      });
      const annotateGeneral = (candidates: SetupCandidate[], familyKind: Cycle8TxFamilyKind) =>
        candidates.map((candidate) => ({
          ...candidate,
          score: [familyRank.get(familyKind)!, ...candidate.score],
          reasons: [
            `Classified as Cycle 8 ${exactClass} from the exact seven-piece replacement window.`,
            `${familyKind === "general-4p" ? "General 4P" : "General 3P"} source family.`,
            ...candidate.reasons,
          ],
        }));

      const general4 = annotateGeneral(yield {
        type: "search",
        search: search(cycle8TxCatalogForClass(exactClass, "general-4p"), "general-4p"),
      }, "general-4p");
      const general3 = annotateGeneral(yield {
        type: "search",
        search: search(cycle8TxCatalogForClass(exactClass, "general-3p"), "general-3p"),
      }, "general-3p");

      const directEntries = matchingCycle8TxDirectQbEntries(exactClass, state);
      const directBySetup = new Map(directEntries.flatMap((entry) =>
        entry.setupIds.map((setupId) => [setupId, entry] as const)));
      const directCatalog = cycle8TxCatalogForClass(exactClass, "qb").filter((setup) =>
        directBySetup.has(canonicalCycle8TxSetupId(setup)));
      const directRaw = directCatalog.length > 0
        ? yield { type: "search", search: search(directCatalog, "qb") }
        : [];
      const direct = directRaw.flatMap((candidate) => {
        const entry = directBySetup.get(canonicalCycle8TxSetupId(candidate.setup));
        if (!entry) return [];
        return [{
          ...candidate,
          score: [familyRank.get("qb")!, ...candidate.score],
          reasons: [
            `Cycle 8 ${exactClass} direct QB · exact HOLD/ACTIVE/NEXT condition.`,
            ...(entry.postBuildHold ? [`The normalized queue window preserves ${entry.postBuildHold} in HOLD after the 3P build.`] : []),
            ...candidate.reasons,
          ],
          policy: { ruleId: entry.id, branchId: "direct", preferred: true },
          qbCondition: cycle8TxConditionLabel(entry, exactClass, "QB"),
          recommendationLabel: cycle8TxConditionLabel(entry, exactClass, "QB"),
        }];
      });

      const oqbPlans = matchingCycle8TxOqbPlans(exactClass, state);
      const oqbBySetup = new Map(oqbPlans.map((plan) => [plan.preconditionSetupId, plan]));
      const oqbCatalog = cycle8TxCatalogForClass(exactClass, "oqb").filter((setup) =>
        oqbBySetup.has(canonicalCycle8TxSetupId(setup)));
      const oqbRaw = oqbCatalog.length > 0
        ? yield { type: "search", search: search(oqbCatalog, "oqb") }
        : [];
      const oqb = oqbRaw.flatMap((candidate) => {
        const plan = oqbBySetup.get(canonicalCycle8TxSetupId(candidate.setup));
        if (!plan) return [];
        const branch = cycle8TxOqbBranch(plan, exactClass, state, candidate.plan);
        if (!branch) return [];
        return [{
          ...candidate,
          score: [familyRank.get("oqb")!, plan.checkpoint.placedCount, ...candidate.score],
          reasons: [
            `Cycle 8 ${exactClass} OQB precondition · exact staged queue policy.`,
            `Observe the selected ${branch.id} branch after ${plan.checkpoint.placedCount} placement(s).`,
            ...candidate.reasons,
          ],
          policy: { ruleId: plan.id, branchId: branch.id, preferred: true },
          qbCondition: cycle8TxConditionLabel(plan, exactClass, "OQB"),
          recommendationLabel: cycle8TxConditionLabel(plan, exactClass, "OQB"),
        }];
      });
      const ordered = [...general4, ...general3, ...direct, ...oqb];
      const candidates = limitSetupCandidatesForCycle(ordered, 1, query.maxCandidates);
      yield {
        type: "stage",
        result: {
          stage: "primary",
          candidates,
          preferredCandidateId: candidates[0]?.setup.id ?? null,
          complete: true,
        },
      };
      return candidates;
    }
  }
  if (scope && query.cycle === 5) {
    const standardPlan = selectedStructuredPlan(query, scope);
    const standardBatches: SetupCandidate[][] = [];
    for (const search of standardPlan?.searches ?? []) {
      standardBatches.push(yield { type: "search", search });
    }
    const standard = standardPlan?.finalize(standardBatches) ?? [];
    const advanced: SetupCandidate[] = [];
    for (const bundle of selectedBundlesForCycle(scope, 5)) {
      if (bundle.kind !== "cycle5-advanced") continue;
      const plan = cycle5AdvancedSelectedSearchPlan(query, bundle);
      if (!plan) continue;
      advanced.push(...plan.finalize(yield { type: "search", search: plan.search }));
    }
    const candidates = limitSetupCandidatesForCycle(
      [...advanced, ...standard].sort(compareScores), 5, query.maxCandidates);
    yield {
      type: "stage",
      result: {
        stage: "primary",
        candidates,
        preferredCandidateId: candidates[0]?.setup.id ?? null,
        complete: true,
      },
    };
    return candidates;
  }
  if (!scope && query.cycle === 5) {
    const context = cycle5QueueContext(query);
    const advancedBundle = context?.classificationMode === "normal-distinct-pair"
      ? promotedCycle5AdvancedBundleForPair(context.classPieces)
      : null;
    if (advancedBundle) {
      const advancedPlan = cycle5AdvancedSelectedSearchPlan(query, advancedBundle);
      const advanced = advancedPlan
        ? advancedPlan.finalize(yield { type: "search", search: advancedPlan.search })
        : [];
      const normalPlan = singleStageRecommendationPlan(query);
      const batches: SetupCandidate[][] = [];
      for (const search of normalPlan?.searches ?? []) {
        batches.push(yield { type: "search", search });
      }
      const standard = normalPlan?.finalize(batches) ?? [];
      const candidates = limitSetupCandidatesForCycle(
        [...advanced, ...standard].sort(compareScores), 5, query.maxCandidates);
      yield {
        type: "stage",
        result: {
          stage: "primary",
          candidates,
          preferredCandidateId: candidates[0]?.setup.id ?? null,
          complete: true,
        },
      };
      return candidates;
    }
  }
  const singleStagePlan = singleStageRecommendationPlan(query, scope);
  if (singleStagePlan) {
    const batches: SetupCandidate[][] = [];
    for (const search of singleStagePlan.searches) {
      batches.push(yield { type: "search", search });
    }
    const candidates = singleStagePlan.finalize(batches);
    yield {
      type: "stage",
      result: {
        stage: "primary",
        candidates,
        preferredCandidateId: candidates[0]?.setup.id ?? null,
        complete: true,
      },
    };
    return candidates;
  }

  if (scope && query.cycle === 2) {
    const context = cycle2QueueContext(query);
    if (!context) {
      const result = { stage: "primary" as const, candidates: [], preferredCandidateId: null, complete: true };
      yield { type: "stage", result };
      return [];
    }
    const structured = selectedBundlesForCycle(scope, 2)
      .filter((bundle): bundle is Extract<SelectedRecommendationBundle, { kind: "structured" }> =>
        bundle.kind === "structured");
    const general: SetupCandidate[] = [];
    const advanced: SetupCandidate[] = [];
    for (const bundle of structured) {
      const target = bundle.role === "advanced-3p" ? advanced : general;
      target.push(...(yield {
        type: "search",
        search: {
          catalog: bundle.catalog.filter((setup) =>
            fitsCycle2BuildPool(setup, context.buildPieces, bundle.policy)),
          query: { ...query, next: context.searchNext },
          policy: bundle.policy,
          policyPrefix: context.policyPrefix,
          policyCatalog: bundle.catalog,
          placeableNextCount: context.placeableNextCount,
          candidateLimit: bundle.role === "advanced-3p"
            ? query.maxCandidates ?? THREE_P_CANDIDATE_LIMIT
            : undefined,
          source: recommendationSourceForBundle(bundle),
        },
      }));
    }
    const limitedGeneral = limitSetupCandidatesForCycle(general.sort(compareScores), 2, query.maxCandidates);
    const limitedAdvanced = limitSetupCandidatesForCycle(advanced.sort(compareScores), 2, query.maxCandidates);
    const qbPlans = selectedBundlesForCycle(scope, 2)
      .filter((bundle): bundle is Extract<SelectedRecommendationBundle, { kind: "cycle2-qb" }> =>
        bundle.kind === "cycle2-qb")
      .map((bundle) => cycle2QbSearchPlan(query, bundle))
      .filter((plan): plan is NonNullable<ReturnType<typeof cycle2QbSearchPlan>> => plan !== null);
    const isOisz = formatPieceSetForDisplay(context.buildPieces) === "OISZ";
    const priorityRawByPlan: SetupCandidate[][] = [];
    const priorityCatalogs = qbPlans.map((plan) =>
      isOisz ? plan.catalog.filter((setup) => setup.priority === 100) : []);
    for (let index = 0; index < qbPlans.length; index += 1) {
      const catalog = priorityCatalogs[index];
      priorityRawByPlan.push(catalog.length > 0
        ? yield { type: "search", search: qbPlans[index].searchFor(catalog) }
        : []);
    }
    const priorityQb = qbPlans.flatMap((plan, index) => plan.finalize(priorityRawByPlan[index]));
    const primary = limitCombined([
      ...limitedGeneral,
      ...limitedAdvanced,
      ...priorityQb,
    ], query);
    const preferredCandidateId = primary.find(({ setup }) => setup.priority === 100)?.setup.id
      ?? primary[0]?.setup.id
      ?? null;
    yield {
      type: "stage",
      result: { stage: "primary", candidates: primary, preferredCandidateId, complete: false },
    };
    const qb = qbPlans.flatMap((plan, index) => {
      const priorityIds = new Set(priorityCatalogs[index].map(({ id }) => id));
      const remaining = plan.catalog.filter(({ id }) => !priorityIds.has(id));
      return [{ plan, index, remaining }];
    });
    const completedQb: SetupCandidate[] = [];
    for (const { plan, index, remaining } of qb) {
      const remainingRaw = remaining.length > 0
        ? yield { type: "search", search: plan.searchFor(remaining) }
        : [];
      completedQb.push(...plan.finalize([...priorityRawByPlan[index], ...remainingRaw]));
    }
    const candidates = limitCombined([...limitedGeneral, ...limitedAdvanced, ...completedQb], query);
    yield {
      type: "stage",
      result: { stage: "secondary", candidates, preferredCandidateId, complete: true },
    };
    return candidates;
  }

  if (query.cycle === 2) {
    const context = cycle2QueueContext(query);
    if (!context) {
      const result = { stage: "primary" as const, candidates: [], preferredCandidateId: null, complete: true };
      yield { type: "stage", result };
      return [];
    }
    const policy = setupPolicyForCycle(2);
    const generalCatalog = setupsForCycle2General();
    const advancedCatalog = setupsForCycle2Advanced3P();
    const general = limitSetupCandidatesForCycle(yield {
      type: "search",
      search: {
        catalog: generalCatalog.filter((setup) => fitsCycle2BuildPool(setup, context.buildPieces, policy)),
        query: { ...query, next: context.searchNext },
        policy,
        policyPrefix: context.policyPrefix,
        policyCatalog: generalCatalog,
        placeableNextCount: context.placeableNextCount,
      },
    }, 2, query.maxCandidates);
    const advanced = limitSetupCandidatesForCycle(yield {
      type: "search",
      search: {
        catalog: advancedCatalog.filter((setup) => fitsCycle2BuildPool(setup, context.buildPieces, policy)),
        query: { ...query, next: context.searchNext },
        policy,
        policyPrefix: context.policyPrefix,
        policyCatalog: advancedCatalog,
        placeableNextCount: context.placeableNextCount,
        candidateLimit: query.maxCandidates ?? THREE_P_CANDIDATE_LIMIT,
      },
    }, 2, query.maxCandidates);

    const qbPlan = cycle2QbSearchPlan(query);
    const isOisz = formatPieceSetForDisplay(context.buildPieces) === "OISZ";
    const priorityCatalog = isOisz
      ? qbPlan?.catalog.filter((setup) => setup.priority === 100) ?? []
      : [];
    const priorityRaw = priorityCatalog.length > 0
      ? yield { type: "search", search: qbPlan!.searchFor(priorityCatalog) }
      : [];
    const priorityQb = qbPlan?.finalize(priorityRaw) ?? [];
    const primary = limitCombined([...general, ...advanced, ...priorityQb], query);
    const preferredCandidateId = primary.find(({ setup }) => setup.priority === 100)?.setup.id
      ?? primary[0]?.setup.id
      ?? null;
    yield {
      type: "stage",
      result: { stage: "primary", candidates: primary, preferredCandidateId, complete: false },
    };

    const priorityIds = new Set(priorityCatalog.map(({ id }) => id));
    const remainingQbCatalog = qbPlan?.catalog.filter(({ id }) => !priorityIds.has(id)) ?? [];
    const remainingRaw = remainingQbCatalog.length > 0
      ? yield { type: "search", search: qbPlan!.searchFor(remainingQbCatalog) }
      : [];
    const qb = qbPlan?.finalize([...priorityRaw, ...remainingRaw]) ?? [];
    const candidates = limitCombined([...general, ...advanced, ...qb], query);
    yield {
      type: "stage",
      result: { stage: "secondary", candidates, preferredCandidateId, complete: true },
    };
    return candidates;
  }

  if (scope && query.cycle === 7) {
    const context = cycle7QueueContext(query);
    if (!context) {
      const result = { stage: "primary" as const, candidates: [], preferredCandidateId: null, complete: true };
      yield { type: "stage", result };
      return [];
    }
    const qbClass = cycle7QbClass(context.buildPieces);
    const nextBag = query.hold === null ? null : cycle7QbNextBag(query.next);
    let qb: SetupCandidate[] = [];
    if (qbClass && nextBag) {
      const rankedByBundle = selectedBundlesForCycle(scope, 7)
        .filter((bundle): bundle is Extract<SelectedRecommendationBundle, { kind: "cycle7-qb" }> =>
          bundle.kind === "cycle7-qb")
        .map((bundle) => ({
          bundle,
          ranked: bundle.catalog.flatMap((setup) => {
            const entry = selectedCycle7QbEntryForSetup(bundle, setup);
            if (!entry) return [];
            const conditionRank = selectedCycle7QbRank(bundle, qbClass, entry, nextBag, setup);
            return Number.isFinite(conditionRank) ? [{ setup, entry, conditionRank }] : [];
          }),
        }));
      const ranks = [...new Set(rankedByBundle.flatMap(({ ranked }) =>
        ranked.map(({ conditionRank }) => conditionRank)))].sort((left, right) => left - right);
      for (const conditionRank of ranks) {
        const buildableAtRank: SetupCandidate[] = [];
        for (const { bundle, ranked } of rankedByBundle) {
          const catalog = ranked.filter((candidate) => candidate.conditionRank === conditionRank)
            .map(({ setup }) => setup);
          if (catalog.length === 0) continue;
          const buildable = yield {
            type: "search",
            search: {
              catalog,
              query,
              policyCatalog: bundle.catalog,
              placeableNextCount: context.placeableNextCount,
              source: recommendationSourceForBundle(bundle),
            },
          };
          buildableAtRank.push(...buildable.map((candidate) => {
            const entry = selectedCycle7QbEntryForSetup(bundle, candidate.setup);
            return {
              ...candidate,
              setup: entry
                ? { ...candidate.setup, displayName: cycle7QbDisplayName(qbClass, entry, candidate.setup) }
                : candidate.setup,
              score: [-2, conditionRank, ...candidate.score],
              reasons: [
                `${qbClass} Cycle 7 QB · ${entry?.runtimeDescription ?? entry?.conditionLabel ?? "QB condition"}`,
                "Builds only the policy-selected QB initial baseline.",
                ...candidate.reasons,
              ],
              qbCondition: entry?.conditionLabel,
            };
          }));
        }
        if (buildableAtRank.length > 0) {
          qb = buildableAtRank.sort((left, right) => {
            const leftBundle = rankedByBundle.find(({ bundle }) =>
              bundle.bundleId === left.recommendationSource?.bundleId)?.bundle;
            const rightBundle = rankedByBundle.find(({ bundle }) =>
              bundle.bundleId === right.recommendationSource?.bundleId)?.bundle;
            const leftOrder = leftBundle
              ? selectedCycle7QbEntryForSetup(leftBundle, left.setup)?.sourceOrder ?? Number.MAX_SAFE_INTEGER
              : Number.MAX_SAFE_INTEGER;
            const rightOrder = rightBundle
              ? selectedCycle7QbEntryForSetup(rightBundle, right.setup)?.sourceOrder ?? Number.MAX_SAFE_INTEGER
              : Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder || compareScores(left, right);
          });
          break;
        }
      }
    }

    const standard: SetupCandidate[] = [];
    for (const bundle of selectedBundlesForCycle(scope, 7)) {
      if (bundle.kind !== "structured") continue;
      standard.push(...(yield {
        type: "search",
        search: {
          catalog: bundle.catalog.filter((setup) =>
            fitsCycle7BuildPool(setup, context.buildPieces, bundle.policy)),
          query: { ...query, next: context.searchNext },
          policy: bundle.policy,
          policyCatalog: bundle.catalog,
          placeableNextCount: context.placeableNextCount,
          source: recommendationSourceForBundle(bundle),
        },
      }));
    }
    const primary = limitSetupCandidatesForCycle(
      [...qb, ...standard].sort(compareScores), 7, query.maxCandidates);
    const preferredCandidateId = primary[0]?.setup.id ?? null;
    yield {
      type: "stage",
      result: { stage: "primary", candidates: primary, preferredCandidateId, complete: false },
    };
    const advanced: SetupCandidate[] = [];
    for (const bundle of selectedBundlesForCycle(scope, 7)) {
      if (bundle.kind !== "cycle7-advanced-4p") continue;
      const matches = selectedCycle7Advanced4pMatches(
        bundle,
        context.buildPieces,
        context.searchNext,
        context.placeableNextCount,
      );
      for (const placeableNextCount of [...new Set(matches.map((match) => match.placeableNextCount))]) {
        const atWindow = matches.filter((match) => match.placeableNextCount === placeableNextCount);
        const matchById = new Map(atWindow.map((match) => [match.setup.id, match]));
        const buildable = yield {
          type: "search",
          search: {
            catalog: atWindow.map(({ setup }) => setup),
            query: { ...query, next: context.searchNext },
            policy: bundle.policy,
            policyCatalog: bundle.catalog,
            placeableNextCount,
            source: recommendationSourceForBundle(bundle),
            scoreForSetup: (setup) => [
              -(matchById.get(setup.id)?.goodCycle8EntryRate ?? 0),
              ...candidateScore(setup),
            ],
          },
        };
        advanced.push(...buildable.map((candidate) => {
          const match = matchById.get(candidate.setup.id);
          return {
            ...candidate,
            score: [-1, ...candidate.score],
            reasons: [
              "Advanced 4P setup built from the previous bag's three pieces and the selected fourth piece.",
              ...(match?.savedPieceAfterBuild
                ? [`HOLD the first ${match.savedPieceAfterBuild} from the next bag and place NEXT[1].`]
                : []),
              ...(match?.goodCycle8EntryRate === undefined
                ? []
                : [`Documented good Cycle 8 entry rate: ${match.goodCycle8EntryRate}%.`]),
              ...candidate.reasons,
            ],
            goodCycle8EntryRate: match?.goodCycle8EntryRate,
          };
        }));
      }
    }
    const candidates = limitSetupCandidatesForCycle(
      [...qb, ...standard, ...advanced].sort(compareScores), 7, query.maxCandidates);
    yield {
      type: "stage",
      result: { stage: "secondary", candidates, preferredCandidateId, complete: true },
    };
    return candidates;
  }

  if (query.cycle === 7) {
    const context = cycle7QueueContext(query);
    if (!context) {
      const result = { stage: "primary" as const, candidates: [], preferredCandidateId: null, complete: true };
      yield { type: "stage", result };
      return [];
    }

    const qbClass = cycle7QbClass(context.buildPieces);
    const nextBag = query.hold === null ? null : cycle7QbNextBag(query.next);
    let qb: SetupCandidate[] = [];
    if (cycle7QbRuntimeBundle() && qbClass && nextBag) {
      const rankedSetups = cycle7QbCatalogForClass(qbClass).flatMap((setup) => {
        const entry = cycle7QbPolicyEntryForSetup(setup);
        return entry ? [{ setup, conditionRank: cycle7QbRecommendationRank(qbClass, entry, nextBag, setup) }] : [];
      }).filter(({ conditionRank }) => Number.isFinite(conditionRank));
      const ranks = [...new Set(rankedSetups.map(({ conditionRank }) => conditionRank))]
        .sort((left, right) => left - right);
      for (const conditionRank of ranks) {
        const catalog = rankedSetups
          .filter((ranked) => ranked.conditionRank === conditionRank)
          .map(({ setup }) => setup);
        const buildable = yield {
          type: "search",
          search: { catalog, query, policyCatalog: catalog, placeableNextCount: context.placeableNextCount },
        };
        if (buildable.length === 0) continue;
        qb = buildable.map((candidate) => {
          const entry = cycle7QbPolicyEntryForSetup(candidate.setup);
          return {
            ...candidate,
            setup: entry
              ? { ...candidate.setup, displayName: cycle7QbDisplayName(qbClass, entry, candidate.setup) }
              : candidate.setup,
            score: [-2, conditionRank, ...candidate.score],
            reasons: [
              `${qbClass} Cycle 7 QB · ${entry?.runtimeDescription ?? entry?.conditionLabel ?? "QB condition"}`,
              "Builds only the source QB's initial 3P baseline; continuation guidance is currently deferred.",
              ...candidate.reasons,
            ],
            qbCondition: entry?.conditionLabel,
          };
        }).sort((left, right) =>
          cycle7QbSourceOrder(left.setup) - cycle7QbSourceOrder(right.setup)
          || compareScores(left, right));
        break;
      }
    }

    const policy = setupPolicyForCycle(7);
    const catalog = setupsForCycle(7);
    const standard = yield {
      type: "search",
      search: {
        catalog: catalog.filter((setup) => fitsCycle7BuildPool(setup, context.buildPieces, policy)),
        query: { ...query, next: context.searchNext },
        policy,
        policyCatalog: catalog,
        placeableNextCount: context.placeableNextCount,
      },
    };
    const primary = limitSetupCandidatesForCycle([...qb, ...standard], 7, query.maxCandidates);
    const preferredCandidateId = primary[0]?.setup.id ?? null;
    yield {
      type: "stage",
      result: { stage: "primary", candidates: primary, preferredCandidateId, complete: false },
    };

    const advancedBundle = cycle7Advanced4pRuntimeBundle();
    const matches = advancedBundle
      ? cycle7Advanced4pMatches(
        context.buildPieces,
        context.searchNext,
        context.placeableNextCount,
        advancedBundle,
      )
      : [];
    const matchById = new Map(matches.map((match) => [match.setup.id, match]));
    const advancedRaw: SetupCandidate[] = [];
    if (advancedBundle) {
      for (const placeableNextCount of [...new Set(matches.map((match) => match.placeableNextCount))]) {
        const matchedCatalog = matches
          .filter((match) => match.placeableNextCount === placeableNextCount)
          .map(({ setup }) => setup);
        advancedRaw.push(...(yield {
          type: "search",
          search: {
            catalog: matchedCatalog,
            query: { ...query, next: context.searchNext },
            policy: advancedBundle.policy,
            policyCatalog: advancedBundle.setups,
            placeableNextCount,
            scoreForSetup: (setup) => [
              -(cycle7Advanced4pGoodCycle8Rate(setup) ?? 0),
              ...candidateScore(setup),
            ],
          },
        }));
      }
    }
    const advanced = advancedRaw.map((candidate) => {
      const goodCycle8EntryRate = cycle7Advanced4pGoodCycle8Rate(candidate.setup);
      const savedPiece = matchById.get(candidate.setup.id)?.savedPieceAfterBuild;
      return {
        ...candidate,
        score: [-1, ...candidate.score],
        reasons: [
          "Advanced 4P setup built from the previous bag's three pieces and the selected fourth piece.",
          ...(savedPiece ? [`HOLD the first ${savedPiece} from the next bag and place NEXT[1].`] : []),
          ...(goodCycle8EntryRate === undefined ? [] : [`Documented good Cycle 8 entry rate: ${goodCycle8EntryRate}%.`]),
          ...candidate.reasons,
        ],
        goodCycle8EntryRate,
      };
    }).sort(compareScores);
    const candidates = limitSetupCandidatesForCycle([...qb, ...standard, ...advanced], 7, query.maxCandidates);
    yield {
      type: "stage",
      result: { stage: "secondary", candidates, preferredCandidateId, complete: true },
    };
    return candidates;
  }

  return [];
}

export function querySetups(
  query: SetupQuery,
  scope?: SelectedRecommendationScope,
): SetupCandidate[] {
  const program = recommendationProgram(query, scope);
  let cursor = program.next();
  while (!cursor.done) {
    cursor = cursor.value.type === "search"
      ? program.next(executeRecommendationSearchSync(cursor.value.search))
      : program.next([]);
  }
  return cursor.value;
}

/**
 * 승격 전/후의 5회차 class catalog를 주입해 실시간 BFS로 조회한다.
 *
 * class 파일 선택은 geometry record가 아니라 HOLD+ACTIVE의 순서 없는 두 미노로
 * 먼저 끝내야 한다. 이 함수는 선택된 한 class catalog만 받으므로, draft를 운영
 * catalog에 섞지 않고도 알고리즘을 검증할 수 있다. 정식 승격 후에는 catalog
 * router가 이 함수에 해당 pair의 source/mirror class만 전달한다.
 */
export function queryCycle5ClassCatalog(
  classCatalog: readonly SetupVariant[],
  query: SetupQuery,
): SetupCandidate[] {
  if (query.cycle !== 5) return [];
  const context = cycle5QueueContext(query);
  if (!context || context.classificationMode === "duplicate-pair-unsupported") return [];

  const buildableSignatures = classCatalog.filter((setup) =>
    setup.cycle === 5
      && setup.runtimeEligible !== false
      && fitsCycle5BuildPool(setup, context.buildPieces));
  const classLabel = formatPieceSetForDisplay(context.classPieces, "/");
  const candidates = queryCatalogInternal(
    buildableSignatures,
    { ...query, next: context.searchNext },
    undefined,
    undefined,
    classCatalog,
    context.placeableNextCount,
  ).map((candidate) => ({
    ...candidate,
    reasons: [
      `Classified as Cycle 5 ${classLabel} from HOLD + ACTIVE.`,
      ...(candidate.setup.bestsave
        ? ["The source marks this as an unconditional Bestsave setup, so it always avoids Cycle 6 No T."]
        : []),
      ...candidate.reasons,
    ],
  })).sort(compareScores);

  const seenIds = new Set<string>();
  const seenGroups = new Set<string>();
  const uniqueCandidates = candidates.filter(({ setup }) => {
    if (seenIds.has(setup.id)) return false;
    if (setup.recommendationGroup
      && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)
      && seenGroups.has(setup.recommendationGroup)) return false;
    seenIds.add(setup.id);
    if (setup.recommendationGroup
      && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)) {
      seenGroups.add(setup.recommendationGroup);
    }
    return true;
  });
  return limitSetupCandidatesForCycle(uniqueCandidates, 5, query.maxCandidates);
}

/**
 * 아직 런타임 catalog에 통합하지 않은 외부 후보 배열을 조회한다.
 * 외부 후보는 이 함수를 사용하면 승격된 런타임 데이터를 수정하지 않고 검사할 수 있다.
 */
export function queryCatalog(catalog: readonly SetupVariant[], query: SetupQuery): SetupCandidate[] {
  return queryCatalogInternal(catalog, query);
}

function queryCatalogInternal(
  catalog: readonly SetupVariant[],
  query: SetupQuery,
  policy?: StructuredSetupPolicy,
  policyPrefix?: Piece[],
  policyCatalog: readonly SetupVariant[] = catalog,
  placeableNextCount?: number,
  candidateLimit?: number,
  scoreForSetup?: (setup: SetupVariant) => readonly number[],
  setupCycle: number = query.cycle,
): SetupCandidate[] {
  const reachabilityCache: ReachabilityCache = new Map();
  const rankedSetups = catalog
    .filter((setup) => setup.cycle === setupCycle && !isSolutionShadowSetup(setup))
    .map((setup) => {
      const policyEvaluation = evaluateSelectionPolicy(policy, setup, policyCatalog, policyPrefix);
      const effectiveSetup = policyEvaluation?.solveRate === undefined
        ? setup
        : { ...setup, solveRate: policyEvaluation.solveRate };
      return {
        setup,
        effectiveSetup,
        policyEvaluation,
        score: [
          policyEvaluation?.preferred ? -1 : 0,
          ...(scoreForSetup?.(effectiveSetup) ?? candidateScore(effectiveSetup)),
        ],
      };
    })
    .sort((left, right) =>
      compareScoreValues(left.score, right.score)
      || left.setup.id.localeCompare(right.setup.id));

  const ranked: SetupCandidate[] = [];
  const seenRecommendationGroups = new Set<string>();
  const seenEqualRateMirrorRecommendations = new Set<string>();
  const hasHighestBuildableStageGroups = rankedSetups.some(({ setup }) =>
    isHighestBuildableStageRecommendationGroup(setup.recommendationGroup));
  for (const { setup, effectiveSetup, policyEvaluation, score } of rankedSetups) {
      // 같은 논리 셋업의 이동·회전형 중 하나를 이미 찾았다면 나머지 geometry는
      // UI에서 어차피 제거되므로 비싼 도달성 BFS를 반복하지 않는다.
      if (setup.recommendationGroup
        && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)
        && seenRecommendationGroups.has(setup.recommendationGroup)) continue;
      const plan = findBuildPlan(
        setup,
        query.board,
        query.active,
        query.hold,
        query.next,
        query.holdAvailable ?? true,
        placeableNextCount,
        reachabilityCache,
      );
      if (!plan) continue;
      const mirrorRecommendationKey = equalRateMirrorRecommendationKey(effectiveSetup, policyEvaluation);
      if (mirrorRecommendationKey && seenEqualRateMirrorRecommendations.has(mirrorRecommendationKey)) continue;
      if (setup.recommendationGroup
        && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)) {
        seenRecommendationGroups.add(setup.recommendationGroup);
      }
      if (mirrorRecommendationKey) seenEqualRateMirrorRecommendations.add(mirrorRecommendationKey);
      const reasons = [`User priority: ${setup.priority ?? 0}.`];
      if (policyEvaluation) reasons.push(policyEvaluation.reason);
      else if (!policy) reasons.push("Candidate before cycle-specific recommendation policy.");
      reasons.push(plan.holds === 0 ? "Buildable without HOLD." : `Buildable with ${plan.holds} HOLD${plan.holds === 1 ? "" : "s"}.`);
      if (effectiveSetup.solveRate !== undefined) {
        reasons.push(`${policyEvaluation?.solveRate !== undefined ? "Conditional" : "Documented"} PC rate: ${effectiveSetup.solveRate}%.`);
      }
      if (effectiveSetup.saves !== undefined) {
        reasons.push(effectiveSetup.saveMetricKind === "project-priority"
          ? `Project default save priority: ${effectiveSetup.saves}.`
          : `Documented Saves: ${effectiveSetup.saves}%.`);
      }
      if (setup.reviewStatus === "draft") reasons.push("Geometry data is an unreviewed draft.");
      ranked.push({
        setup: effectiveSetup,
        plan,
        score,
        reasons,
        policy: policyEvaluation ? {
          ruleId: policyEvaluation.ruleId,
          branchId: policyEvaluation.branchId,
          preferred: policyEvaluation.preferred,
        } : undefined,
      });
      if (!hasHighestBuildableStageGroups && candidateLimit !== undefined && ranked.length >= candidateLimit) break;
  }
  const projected = retainHighestBuildableRecommendationStages(ranked).sort(compareScores);
  return candidateLimit === undefined ? projected : projected.slice(0, candidateLimit);
}

/** Cooperative counterpart used only by browser recommendation Workers. */
export async function queryCatalogCooperative(
  catalog: readonly SetupVariant[],
  query: SetupQuery,
  control: CooperativeSearchControl,
  policy?: StructuredSetupPolicy,
  policyPrefix?: Piece[],
  policyCatalog: readonly SetupVariant[] = catalog,
  placeableNextCount?: number,
  candidateLimit?: number,
  scoreForSetup?: (setup: SetupVariant) => readonly number[],
  setupCycle: number = query.cycle,
): Promise<SetupCandidate[]> {
  const reachabilityCache: ReachabilityCache = new Map();
  const rankedSetups = catalog
    .filter((setup) => setup.cycle === setupCycle && !isSolutionShadowSetup(setup))
    .map((setup) => {
      const policyEvaluation = evaluateSelectionPolicy(policy, setup, policyCatalog, policyPrefix);
      const effectiveSetup = policyEvaluation?.solveRate === undefined
        ? setup
        : { ...setup, solveRate: policyEvaluation.solveRate };
      return {
        setup,
        effectiveSetup,
        policyEvaluation,
        score: [
          policyEvaluation?.preferred ? -1 : 0,
          ...(scoreForSetup?.(effectiveSetup) ?? candidateScore(effectiveSetup)),
        ],
      };
    })
    .sort((left, right) =>
      compareScoreValues(left.score, right.score)
      || left.setup.id.localeCompare(right.setup.id));

  const ranked: SetupCandidate[] = [];
  const seenRecommendationGroups = new Set<string>();
  const seenEqualRateMirrorRecommendations = new Set<string>();
  const hasHighestBuildableStageGroups = rankedSetups.some(({ setup }) =>
    isHighestBuildableStageRecommendationGroup(setup.recommendationGroup));
  for (const { setup, effectiveSetup, policyEvaluation, score } of rankedSetups) {
    if (setup.recommendationGroup
      && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)
      && seenRecommendationGroups.has(setup.recommendationGroup)) continue;
    const plan = await findBuildPlanCooperative(
      setup,
      query.board,
      query.active,
      query.hold,
      query.next,
      query.holdAvailable ?? true,
      placeableNextCount,
      reachabilityCache,
      control,
    );
    if (!plan) continue;
    const mirrorRecommendationKey = equalRateMirrorRecommendationKey(effectiveSetup, policyEvaluation);
    if (mirrorRecommendationKey && seenEqualRateMirrorRecommendations.has(mirrorRecommendationKey)) continue;
    if (setup.recommendationGroup
      && !isHighestBuildableStageRecommendationGroup(setup.recommendationGroup)) {
      seenRecommendationGroups.add(setup.recommendationGroup);
    }
    if (mirrorRecommendationKey) seenEqualRateMirrorRecommendations.add(mirrorRecommendationKey);
    const reasons = [`User priority: ${setup.priority ?? 0}.`];
    if (policyEvaluation) reasons.push(policyEvaluation.reason);
    else if (!policy) reasons.push("Candidate before cycle-specific recommendation policy.");
    reasons.push(plan.holds === 0 ? "Buildable without HOLD." : `Buildable with ${plan.holds} HOLD${plan.holds === 1 ? "" : "s"}.`);
    if (effectiveSetup.solveRate !== undefined) {
      reasons.push(`${policyEvaluation?.solveRate !== undefined ? "Conditional" : "Documented"} PC rate: ${effectiveSetup.solveRate}%.`);
    }
    if (effectiveSetup.saves !== undefined) {
      reasons.push(effectiveSetup.saveMetricKind === "project-priority"
        ? `Project default save priority: ${effectiveSetup.saves}.`
        : `Documented Saves: ${effectiveSetup.saves}%.`);
    }
    if (setup.reviewStatus === "draft") reasons.push("Geometry data is an unreviewed draft.");
    ranked.push({
      setup: effectiveSetup,
      plan,
      score,
      reasons,
      policy: policyEvaluation ? {
        ruleId: policyEvaluation.ruleId,
        branchId: policyEvaluation.branchId,
        preferred: policyEvaluation.preferred,
      } : undefined,
    });
    if (!hasHighestBuildableStageGroups && candidateLimit !== undefined && ranked.length >= candidateLimit) break;
  }
  const projected = retainHighestBuildableRecommendationStages(ranked).sort(compareScores);
  return candidateLimit === undefined ? projected : projected.slice(0, candidateLimit);
}
