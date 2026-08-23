import rawManifest from "../../setups/catalog-manifest.json";
import rawCatalog from "../../setups/cycle-8-tx-setups.json";
import rawPolicy from "../../setups/cycle-8-tx-policy.json";
import type { Piece } from "../engine/types";
import { mirrorPiece, mirrorSetup } from "./mirror";
import { expandBoxSetups } from "./rotation";
import type { BuildPlan } from "./reachability";
import type { SetupVariant } from "./schema";

export type Cycle8TxExactClass = "T>O" | "T>I" | "T>L" | "T>J" | "T>S" | "T>Z";
export type Cycle8TxFamilyKind = "general-4p" | "general-3p" | "qb" | "oqb";

interface Cycle8TxInitialWindow {
  hold: Piece;
  activeNextPermutation: Piece[];
  nextCount: number;
  followingPiece?: Piece;
}

export interface Cycle8TxRuntimeEntry {
  setupId: string;
  sourceOrder: number;
  familyKind: Cycle8TxFamilyKind;
  sourceClass: Cycle8TxExactClass;
  exactClasses: Cycle8TxExactClass[];
  mirrorMode: "none" | "within-class" | "exact-class";
}

export interface Cycle8TxDirectQbEntry {
  id: string;
  exactClasses: Cycle8TxExactClass[];
  setupIds: string[];
  initialWindow: Cycle8TxInitialWindow;
  postBuildHold?: Piece;
}

export interface Cycle8TxOqbBranch {
  id: string;
  sourceOrder: number;
  observedPiece?: Piece;
  predicateKind?: "to-iz-xyo" | "ti-oz-sio" | "tz-oi-iox";
  fallback?: boolean;
  continuationSetupIds?: string[];
  action?: "solve-from-precondition";
}

export interface Cycle8TxOqbPlan {
  id: string;
  exactClasses: Cycle8TxExactClass[];
  preconditionSetupId: string;
  initialWindow: Cycle8TxInitialWindow;
  checkpoint: { placedCount: number };
  observation: { kind: "post-build-next-slot"; index: number } | { kind: "post-build-seven"; width: 7 };
  branches: Cycle8TxOqbBranch[];
}

interface Cycle8TxPolicy {
  reviewStatus?: string;
  metrics: Array<{ setupId: string; direction: Cycle8TxExactClass; values: { solveRate?: number } }>;
  runtimePolicy: {
    catalogKind: "cycle8-tx";
    integrationState: "active" | "inactive";
    familyOrder: Cycle8TxFamilyKind[];
    entries: Cycle8TxRuntimeEntry[];
    directQb: Cycle8TxDirectQbEntry[];
    oqbPlans: Cycle8TxOqbPlan[];
    fallback: "none";
  };
}

interface Cycle8TxManifest {
  cycles?: Record<string, {
    runtimeEnabled?: boolean;
    conditionCompilerReady?: boolean;
    setupCount?: number;
    additionalCatalogs?: Array<{ setupCount?: number }>;
  }>;
}

export interface Cycle8TxRuntimeBundle {
  setups: SetupVariant[];
  policy: Cycle8TxPolicy;
}

export interface Cycle8TxQueueState {
  hold: Piece | null;
  active: Piece;
  next: Piece[];
}

const manifest = rawManifest as Cycle8TxManifest;
const sourceCatalog = rawCatalog as unknown as SetupVariant[];
const policy = rawPolicy as unknown as Cycle8TxPolicy;
const sourceById = new Map(sourceCatalog.map((setup) => [setup.id, setup]));
const entryById = new Map(policy.runtimePolicy.entries.map((entry) => [entry.setupId, entry]));
const metricBySetupAndClass = new Map(policy.metrics.map((metric) => [
  `${metric.setupId}\0${metric.direction}`,
  metric.values.solveRate,
]));

export function canonicalCycle8TxSetupId(setup: SetupVariant): string {
  return (setup.policySourceId ?? setup.id).split("--box-")[0]!.replace(/--mirror$/, "");
}

function isMirroredRuntimeSetup(setup: SetupVariant): boolean {
  return setup.id.split("--box-")[0]!.endsWith("--mirror") || setup.derivedVariant === "mirror";
}

function exactClassForEntryVariant(
  entry: Cycle8TxRuntimeEntry,
  mirrored: boolean,
): Cycle8TxExactClass {
  if (entry.mirrorMode === "exact-class" && mirrored) {
    return entry.exactClasses.find((classId) => classId !== entry.sourceClass) ?? entry.sourceClass;
  }
  return entry.sourceClass;
}

function runtimeVariantsForEntry(entry: Cycle8TxRuntimeEntry): SetupVariant[] {
  const setup = sourceById.get(entry.setupId);
  if (!setup) return [];
  const variants = entry.mirrorMode === "none"
    ? [setup]
    : [setup, mirrorSetup(setup)];
  return expandBoxSetups(variants).map((variant) => {
    const exactClass = exactClassForEntryVariant(entry, isMirroredRuntimeSetup(variant));
    const solveRate = metricBySetupAndClass.get(`${entry.setupId}\0${exactClass}`);
    return {
      ...variant,
      displayName: variant.displayName.replace(entry.sourceClass, exactClass),
      solveRate,
    };
  });
}

const allRuntimeCatalog = policy.runtimePolicy.entries.flatMap(runtimeVariantsForEntry);
const runtimeByClass = new Map<Cycle8TxExactClass, SetupVariant[]>();
for (const setup of allRuntimeCatalog) {
  const exactClass = cycle8TxExactClassForSetup(setup);
  if (!exactClass) continue;
  const bucket = runtimeByClass.get(exactClass);
  if (bucket) bucket.push(setup);
  else runtimeByClass.set(exactClass, [setup]);
}

function exactCoverage(ids: string[], expected: string[]): boolean {
  return ids.length === expected.length
    && new Set(ids).size === ids.length
    && ids.every((id) => expected.includes(id));
}

export function cycle8TxRuntimeReady(
  manifestEntry: { runtimeEnabled?: boolean; conditionCompilerReady?: boolean; setupCount?: number } | undefined,
  setups: Array<{ id: string; reviewStatus?: string; runtimeEligible?: boolean }>,
  candidatePolicy: Pick<Cycle8TxPolicy, "reviewStatus" | "runtimePolicy">,
): boolean {
  const setupIds = setups.map(({ id }) => id);
  const runtime = candidatePolicy.runtimePolicy;
  return manifestEntry?.runtimeEnabled === true
    && manifestEntry.conditionCompilerReady === true
    && manifestEntry.setupCount === setups.length
    && setups.length > 0
    && setups.every(({ reviewStatus, runtimeEligible }) => reviewStatus === "reviewed" && runtimeEligible === true)
    && candidatePolicy.reviewStatus === "reviewed"
    && runtime?.catalogKind === "cycle8-tx"
    && runtime.integrationState === "active"
    && runtime.fallback === "none"
    && runtime.familyOrder.join(",") === "general-4p,general-3p,qb,oqb"
    && exactCoverage(runtime.entries.map(({ setupId }) => setupId), setupIds);
}

export function cycle8TxRuntimeBundle(): Cycle8TxRuntimeBundle | null {
  const cycle8 = manifest.cycles?.["8"];
  const additionalCount = cycle8?.additionalCatalogs?.reduce((sum, entry) =>
    sum + (entry.setupCount ?? 0), 0) ?? 0;
  const primaryEntry = cycle8 ? { ...cycle8, setupCount: (cycle8.setupCount ?? 0) - additionalCount } : undefined;
  return cycle8TxRuntimeReady(primaryEntry, sourceCatalog, policy)
    ? { setups: allRuntimeCatalog, policy }
    : null;
}

export function cycle8TxSourceCatalog(): SetupVariant[] {
  return sourceCatalog;
}

export function cycle8TxAllRuntimeCatalog(): SetupVariant[] {
  return allRuntimeCatalog;
}

export function cycle8TxCatalogForClass(
  exactClass: Cycle8TxExactClass,
  familyKind?: Cycle8TxFamilyKind,
): SetupVariant[] {
  const catalog = runtimeByClass.get(exactClass) ?? [];
  return familyKind === undefined
    ? catalog
    : catalog.filter((setup) => cycle8TxRuntimeEntryForSetup(setup)?.familyKind === familyKind);
}

export function cycle8TxRuntimeEntryForSetup(setup: SetupVariant): Cycle8TxRuntimeEntry | undefined {
  return entryById.get(canonicalCycle8TxSetupId(setup));
}

export function cycle8TxExactClassForSetup(setup: SetupVariant): Cycle8TxExactClass | null {
  const entry = cycle8TxRuntimeEntryForSetup(setup);
  return entry ? exactClassForEntryVariant(entry, isMirroredRuntimeSetup(setup)) : null;
}

export function cycle8TxExactClass(
  extraPiece: Piece,
  replacedPiece: Piece,
): Cycle8TxExactClass | null {
  if (extraPiece !== "T" || replacedPiece === "T") return null;
  return `T>${replacedPiece}` as Cycle8TxExactClass;
}

function sortedSignature(pieces: readonly Piece[]): string {
  return [...pieces].sort().join("");
}

export function cycle8TxSourceQueueState(
  state: Cycle8TxQueueState,
  exactClass: Cycle8TxExactClass,
): Cycle8TxQueueState {
  if (exactClass !== "T>J" && exactClass !== "T>Z") return state;
  return {
    hold: state.hold === null ? null : mirrorPiece(state.hold),
    active: mirrorPiece(state.active),
    next: state.next.map(mirrorPiece),
  };
}

export function cycle8TxInitialWindowMatches(
  window: Cycle8TxInitialWindow,
  state: Cycle8TxQueueState,
): boolean {
  if (state.hold !== window.hold || state.next.length < window.nextCount) return false;
  const observed = [state.active, ...state.next.slice(0, window.nextCount)];
  if (sortedSignature(observed) !== sortedSignature(window.activeNextPermutation)) return false;
  return window.followingPiece === undefined || state.next[window.nextCount] === window.followingPiece;
}

export function matchingCycle8TxDirectQbEntries(
  exactClass: Cycle8TxExactClass,
  state: Cycle8TxQueueState,
): Cycle8TxDirectQbEntry[] {
  const sourceState = cycle8TxSourceQueueState(state, exactClass);
  return policy.runtimePolicy.directQb.filter((entry) =>
    entry.exactClasses.includes(exactClass) && cycle8TxInitialWindowMatches(entry.initialWindow, sourceState));
}

export function matchingCycle8TxOqbPlans(
  exactClass: Cycle8TxExactClass,
  state: Cycle8TxQueueState,
): Cycle8TxOqbPlan[] {
  const sourceState = cycle8TxSourceQueueState(state, exactClass);
  return policy.runtimePolicy.oqbPlans.filter((entry) =>
    entry.exactClasses.includes(exactClass) && cycle8TxInitialWindowMatches(entry.initialWindow, sourceState));
}

export function cycle8TxQueueAfterBuildPlan(
  state: Cycle8TxQueueState,
  plan: BuildPlan,
): Cycle8TxQueueState | null {
  let hold = state.hold;
  let active = state.active;
  let queueIndex = 0;
  for (const step of plan.steps) {
    if (step.action === "hold") {
      if (hold === null) {
        hold = active;
        const next = state.next[queueIndex++];
        if (!next) return null;
        active = next;
      } else {
        [active, hold] = [hold, active];
      }
      continue;
    }
    const next = state.next[queueIndex++];
    if (next) active = next;
  }
  return { hold, active, next: state.next.slice(queueIndex) };
}

function setEqualsPair(left: Piece, right: Piece, a: Piece, b: Piece): boolean {
  return (left === a && right === b) || (left === b && right === a);
}

export function cycle8TxPostBuildPredicateMatches(
  predicate: NonNullable<Cycle8TxOqbBranch["predicateKind"]>,
  state: Cycle8TxQueueState,
): boolean {
  if (state.hold === null || state.next.length < 5) return false;
  const [n0, n1, n2, n3, n4] = state.next;
  if (predicate === "to-iz-xyo") {
    return setEqualsPair(state.hold, state.active, "T", "O")
      && setEqualsPair(n0, n1, "I", "Z")
      && n2 !== "O" && n3 !== "O" && n2 !== n3 && n4 === "O";
  }
  if (predicate === "ti-oz-sio") {
    return state.hold === "T" && state.active === "I"
      && setEqualsPair(n0, n1, "O", "Z")
      && n2 === "S" && n3 === "I" && n4 === "O";
  }
  return state.hold === "T" && state.active === "Z"
    && setEqualsPair(n0, n1, "O", "I")
    && n2 === "I" && n3 === "O" && n4 !== "I" && n4 !== "O";
}

export function cycle8TxOqbBranch(
  plan: Cycle8TxOqbPlan,
  exactClass: Cycle8TxExactClass,
  initialState: Cycle8TxQueueState,
  buildPlan: BuildPlan,
): Cycle8TxOqbBranch | null {
  const after = cycle8TxQueueAfterBuildPlan(initialState, buildPlan);
  if (!after) return null;
  const sourceAfter = cycle8TxSourceQueueState(after, exactClass);
  if (plan.observation.kind === "post-build-next-slot") {
    const observed = sourceAfter.next[plan.observation.index];
    return plan.branches.find((branch) => branch.observedPiece === observed)
      ?? plan.branches.find(({ fallback }) => fallback === true)
      ?? null;
  }
  return plan.branches.find(({ predicateKind }) =>
    predicateKind !== undefined && cycle8TxPostBuildPredicateMatches(predicateKind, sourceAfter))
    ?? plan.branches.find(({ fallback }) => fallback === true)
    ?? null;
}

export function cycle8TxOqbPlanById(id: string): Cycle8TxOqbPlan | undefined {
  return policy.runtimePolicy.oqbPlans.find((plan) => plan.id === id);
}

export function cycle8TxOqbContinuation(
  setupId: string,
  exactClass: Cycle8TxExactClass,
): SetupVariant | null {
  return cycle8TxCatalogForClass(exactClass).find((setup) =>
    canonicalCycle8TxSetupId(setup) === setupId) ?? null;
}

export function cycle8TxConditionLabel(
  entry: Cycle8TxDirectQbEntry | Cycle8TxOqbPlan,
  exactClass: Cycle8TxExactClass,
  kind: "QB" | "OQB",
): string {
  const source = entry.initialWindow;
  const transform = (piece: Piece) => exactClass === "T>J" || exactClass === "T>Z"
    ? mirrorPiece(piece)
    : piece;
  const permutation = source.activeNextPermutation.map(transform).join("");
  const following = source.followingPiece ? transform(source.followingPiece) : "";
  return `${exactClass} · ${transform(source.hold)}-[${permutation}]!${following} ${kind}`;
}
