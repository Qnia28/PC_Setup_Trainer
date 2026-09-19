import type { Piece } from "../engine/types";
import type { SetupVariant } from "./schema";

export interface PolicyCondition {
  operator: "prefixIn" | "contains" | "containsAll" | "orderBefore" | "allOf" | "anyOf" | "not";
  values?: string[];
  conditions?: PolicyCondition[];
  condition?: PolicyCondition;
}

export interface PolicyChoice {
  preferSetupIds: string[];
  resultMetrics?: {
    solveRate?: number;
  };
}

export interface SetupSelectionRule {
  id: string;
  candidateSetupIds: string[];
  /** 0P에서 새 7-bag의 정확한 prefix를 만족해야만 초기 BFS 후보가 된다. */
  initialEligibility?: {
    observation: {
      kind: "cycle3-new-bag-prefix";
      length: number;
    };
    /** source geometry 기준 조건. 파생 미러는 queue도 source 기준으로 반전해 평가한다. */
    when: PolicyCondition;
    /** 이 일반 셋업이 실제 BFS로 도달 가능하면 본 fallback 후보를 숨긴다. */
    requiresUnbuildableSetupIds?: string[];
  };
  /** 먼저 공통 geometry를 만든 뒤 관측하는 QB/OQB 단계형 규칙의 선행 셋업. */
  preconditionSetupIds?: string[];
  observation: {
    kind: "next-bag-prefix";
    length: number;
    /** 선행 셋업 직후 UI에 보이는 NEXT 꼬리에서 다음 가방 prefix를 읽는다. */
    runtimeSource?: "visible-next-tail-after-precondition";
  };
  branches: Array<PolicyChoice & {
    id: string;
    when: PolicyCondition;
    stagedAction?: "extend-setup" | "solve-from-precondition";
    continuationSetupIds?: string[];
    instruction?: string;
  }>;
  default?: PolicyChoice & {
    stagedAction?: "extend-setup" | "solve-from-precondition";
    continuationSetupIds?: string[];
    instruction?: string;
  };
}

export interface StructuredSetupPolicy {
  schemaVersion: 2;
  cycle: number;
  metrics: Array<{
    setupId: string;
    values: {
      solveRate?: number;
      mirroredSolveRate?: number;
      saves?: number;
      saveMetricKind?: "percentage" | "project-priority";
      nextPcGPercent?: number;
      nextPcTPercent?: number;
    };
  }>;
  buildConstraints?: Array<{
    id: string;
    candidateSetupIds: string[];
    requiredSavedPiece: Piece;
    exactPoolSignature: string;
  }>;
  selectionRules: SetupSelectionRule[];
  rankingHints?: Array<{
    kind: "project-default-save-priority";
    valuesByPieceCount: Record<string, number>;
  }>;
}

export interface PolicyEvaluation {
  ruleId: string;
  branchId: string | "default" | "unobserved";
  observedPrefix?: Piece[];
  preferred: boolean;
  solveRate?: number;
  reason: string;
}

function sideFromFormLabel(formLabel?: string): SetupVariant["side"] {
  if (formLabel?.startsWith("left")) return "left";
  if (formLabel?.startsWith("right")) return "right";
  return "neutral";
}

export function conditionMatches(condition: PolicyCondition, sequence: Piece[]): boolean {
  const values = condition.values ?? [];
  if (condition.operator === "prefixIn") return values.includes(sequence.join(""));
  if (condition.operator === "contains" || condition.operator === "containsAll") {
    return values.every((piece) => sequence.includes(piece as Piece));
  }
  if (condition.operator === "orderBefore") {
    const [before, after] = values;
    const beforeIndex = sequence.indexOf(before as Piece);
    const afterIndex = sequence.indexOf(after as Piece);
    return beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex;
  }
  if (condition.operator === "allOf") {
    return (condition.conditions ?? []).every((part) => conditionMatches(part, sequence));
  }
  if (condition.operator === "anyOf") {
    return (condition.conditions ?? []).some((part) => conditionMatches(part, sequence));
  }
  if (condition.operator === "not") {
    return condition.condition ? !conditionMatches(condition.condition, sequence) : false;
  }
  return false;
}

export function applyStructuredPolicyMetrics(
  catalog: readonly SetupVariant[],
  policy: StructuredSetupPolicy,
): SetupVariant[] {
  const metrics = new Map(policy.metrics.map((entry) => [entry.setupId, entry.values]));
  const savePriority = policy.rankingHints?.find(({ kind }) => kind === "project-default-save-priority");

  return catalog.map((setup) => {
    const setupMetrics = metrics.get(setup.id);
    const fallbackSavePriority = savePriority?.valuesByPieceCount[String(setup.placements.length)];
    const formLabel = setup.formLabel === "neutral" ? undefined : setup.formLabel;
    return {
      ...setup,
      priority: setup.priority ?? 0,
      formLabel,
      side: setup.side ?? sideFromFormLabel(formLabel),
      solveRate: setupMetrics?.solveRate ?? setup.solveRate,
      mirroredSolveRate: setupMetrics?.mirroredSolveRate ?? setup.mirroredSolveRate,
      saves: setupMetrics?.saves ?? setup.saves ?? fallbackSavePriority,
      nextPcGPercent: setupMetrics?.nextPcGPercent ?? setup.nextPcGPercent,
      nextPcTPercent: setupMetrics?.nextPcTPercent ?? setup.nextPcTPercent,
      saveMetricKind: setupMetrics?.saveMetricKind
        ?? setup.saveMetricKind
        ?? (fallbackSavePriority !== undefined ? "project-priority" : undefined),
    };
  });
}

function isRuleCandidate(setup: SetupVariant, rule: SetupSelectionRule): boolean {
  return rule.candidateSetupIds.includes(setup.id)
    || (setup.policySourceId !== undefined && rule.candidateSetupIds.includes(setup.policySourceId))
    || (setup.mirrorOf !== undefined && rule.candidateSetupIds.includes(setup.mirrorOf));
}

function isPreferredVariant(
  setup: SetupVariant,
  choice: PolicyChoice,
  catalog: readonly SetupVariant[],
): boolean {
  if (choice.preferSetupIds.includes(setup.id)
    || (setup.policySourceId !== undefined && choice.preferSetupIds.includes(setup.policySourceId))) return true;

  const preferredSides = new Set(
    choice.preferSetupIds
      .map((id) => catalog.find((candidate) => candidate.id === id)?.side)
      .filter((side): side is "left" | "right" => side === "left" || side === "right"),
  );
  return (setup.side === "left" || setup.side === "right") && preferredSides.has(setup.side);
}

export function evaluateSelectionPolicy(
  policy: StructuredSetupPolicy | undefined,
  setup: SetupVariant,
  catalog: readonly SetupVariant[],
  visibleNextBagPrefix: Piece[] | undefined,
): PolicyEvaluation | null {
  if (!policy) return null;

  const rule = policy.selectionRules.find((candidate) => isRuleCandidate(setup, candidate));
  if (!rule) return null;
  if (rule.observation.runtimeSource === "visible-next-tail-after-precondition") {
    return {
      ruleId: rule.id,
      branchId: "unobserved",
      preferred: false,
      reason: "This staged policy is evaluated only after its precondition is completed.",
    };
  }
  if (!visibleNextBagPrefix || visibleNextBagPrefix.length < rule.observation.length) {
    return {
      ruleId: rule.id,
      branchId: "unobserved",
      preferred: false,
      reason: "The first three pieces of the next bag are not fully visible, so the fixed-orientation base rate is used.",
    };
  }

  const observation = visibleNextBagPrefix.slice(0, rule.observation.length);
  const branch = rule.branches.find(({ when }) => conditionMatches(when, observation));
  const choice = branch ?? rule.default;
  if (!choice) {
    return {
      ruleId: rule.id,
      branchId: "unobserved",
      observedPrefix: observation,
      preferred: false,
      reason: `No policy branch matches next-bag prefix ${observation.join("")}; the fixed-orientation base rate is used.`,
    };
  }

  const preferred = isPreferredVariant(setup, choice, catalog);
  return {
    ruleId: rule.id,
    branchId: branch?.id ?? "default",
    observedPrefix: observation,
    preferred,
    solveRate: preferred ? choice.resultMetrics?.solveRate : undefined,
    reason: preferred
      ? `Recommended for next-bag prefix ${observation.join("")}.`
      : `This is the opposite orientation for next-bag prefix ${observation.join("")}; the fixed-orientation base rate is used.`,
  };
}
