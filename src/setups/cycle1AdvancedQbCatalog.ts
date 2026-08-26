import rawManifest from "../../setups/catalog-manifest.json";
import rawCatalog from "../../setups/QB/cycle-1-advanced-qb-setups.json";
import rawPolicy from "../../setups/QB/cycle-1-advanced-qb-policy.json";
import type { Piece } from "../engine/types";
import type { Cycle1QueueContext } from "./cycle1Context";
import { mirrorSetup } from "./mirror";
import { expandBoxSetups } from "./rotation";
import type { SetupQuery } from "./query";
import type { SetupVariant } from "./schema";

export interface Cycle1AdvancedQbSetupRef {
  setupId: string;
  transform: "identity" | "mirror-x";
  transformRule: "identity" | "mirror-x" | "fixed-left-srs-exception";
  solveRate: number;
  recommended: boolean;
  pieceCount: 3 | 4;
  rankGroup: number;
  itemOrder: number;
  frameOrder: number;
  boxMode?: "all-wall-minimals";
}

export interface Cycle1AdvancedQbEntry {
  id: string;
  orderedLastTwo: [Piece, Piece];
  unorderedPair: [Piece, Piece];
  sectionOrder: number;
  branchOrder: number;
  candidateGroups: Cycle1AdvancedQbSetupRef[][];
  excludedSetupIds: string[];
}

interface Cycle1AdvancedQbPolicy {
  schemaVersion: number;
  cycle: number;
  classId: string;
  reviewStatus?: string;
  qbSemantics: {
    family: string;
    oqbIncluded: boolean;
    holdOccupied: {
      buildWindowSlots: string[];
      orderedLastTwoSlots: string[];
    };
    holdEmpty: {
      buildWindowSlots: string[];
      orderedLastTwoSlots: string[];
      uniqueComplementRequired: boolean;
    };
    fallback: string;
  };
  entries: Cycle1AdvancedQbEntry[];
  runtimePolicy: {
    schemaVersion: number;
    catalogKind: string;
    integrationState: string;
    executable: boolean;
    orderedBranchCount: number;
    unorderedPairCount: number;
    physicalSetupCount: number;
    logicalSetupCount: number;
    fallback: string;
  };
}

interface Cycle1AdvancedQbManifestEntry {
  runtimeEnabled?: boolean;
  conditionCompilerReady?: boolean;
  setupCount?: number;
  logicalSetupCount?: number;
}

interface Cycle1AdvancedQbManifest {
  cycles?: Record<string, {
    qb?: Cycle1AdvancedQbManifestEntry;
  }>;
}

export interface Cycle1AdvancedQbRuntimeBundle {
  setups: SetupVariant[];
  policy: Cycle1AdvancedQbPolicy;
}

export interface Cycle1AdvancedQbObservation {
  orderedLastTwo: [Piece, Piece];
  basis: "hold-occupied" | "hold-empty-inferred-complement";
  buildNext: Piece[];
  placeableNextCount: number;
}

interface MaterializedSetupMeta {
  entry: Cycle1AdvancedQbEntry;
  ref: Cycle1AdvancedQbSetupRef;
}

const manifest = rawManifest as Cycle1AdvancedQbManifest;
const sourceCatalog = rawCatalog as unknown as SetupVariant[];
const policy = rawPolicy as unknown as Cycle1AdvancedQbPolicy;
const sourceById = new Map(sourceCatalog.map((setup) => [setup.id, setup]));
const entryByOrder = new Map(policy.entries.map((entry) => [entry.orderedLastTwo.join(""), entry]));
const catalogCache = new Map<string, SetupVariant[]>();
const materializedMeta = new WeakMap<SetupVariant, MaterializedSetupMeta>();

function exactCoverage(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((value) => expected.includes(value));
}

export function cycle1AdvancedQbRuntimeReady(
  manifestEntry: Cycle1AdvancedQbManifestEntry | undefined,
  setups: Array<{ id: string; reviewStatus?: string; runtimeEligible?: boolean }>,
  candidatePolicy: Cycle1AdvancedQbPolicy,
): boolean {
  const runtime = candidatePolicy.runtimePolicy;
  const setupIds = setups.map(({ id }) => id);
  const referencedIds = candidatePolicy.entries.flatMap((entry) =>
    entry.candidateGroups.flat().map(({ setupId }) => setupId));
  const orderedPairs = candidatePolicy.entries.map(({ orderedLastTwo }) => orderedLastTwo.join(""));
  const unorderedPairs = new Set(candidatePolicy.entries.map(({ unorderedPair }) => unorderedPair.join("")));
  return manifestEntry?.runtimeEnabled === true
    && manifestEntry.conditionCompilerReady === true
    && manifestEntry.setupCount === setups.length
    && manifestEntry.logicalSetupCount === 74
    && setups.length === 75
    && setups.every(({ reviewStatus, runtimeEligible }) => reviewStatus === "reviewed" && runtimeEligible === true)
    && candidatePolicy.schemaVersion === 3
    && candidatePolicy.cycle === 1
    && candidatePolicy.classId === "advanced-qb"
    && candidatePolicy.reviewStatus === "reviewed"
    && candidatePolicy.qbSemantics.family === "QB"
    && candidatePolicy.qbSemantics.oqbIncluded === false
    && candidatePolicy.qbSemantics.holdEmpty.uniqueComplementRequired === true
    && candidatePolicy.qbSemantics.fallback === "none"
    && runtime.schemaVersion === 1
    && runtime.catalogKind === "cycle1-advanced-qb"
    && runtime.integrationState === "active"
    && runtime.executable === true
    && runtime.fallback === "none"
    && runtime.orderedBranchCount === 42
    && runtime.unorderedPairCount === 21
    && runtime.physicalSetupCount === 75
    && runtime.logicalSetupCount === 74
    && candidatePolicy.entries.length === 42
    && new Set(orderedPairs).size === 42
    && unorderedPairs.size === 21
    && exactCoverage([...new Set(referencedIds)], setupIds);
}

export function cycle1AdvancedQbRuntimeBundle(): Cycle1AdvancedQbRuntimeBundle | null {
  return cycle1AdvancedQbRuntimeReady(manifest.cycles?.["1"]?.qb, sourceCatalog, policy)
    ? { setups: sourceCatalog, policy }
    : null;
}

export function cycle1AdvancedQbObservation(
  query: SetupQuery,
  context: Cycle1QueueContext,
): Cycle1AdvancedQbObservation | null {
  if (query.cycle !== 1 || query.next.length < 5) return null;
  if (context.classificationMode === "normal-seven-bag" && query.hold !== null) {
    return {
      orderedLastTwo: [query.next[3]!, query.next[4]!],
      basis: "hold-occupied",
      buildNext: query.next.slice(0, 3),
      placeableNextCount: 3,
    };
  }
  if (context.classificationMode === "normal-seven-bag-prefix"
    && query.hold === null
    && context.inferredLastPiece) {
    return {
      orderedLastTwo: [query.next[4]!, context.inferredLastPiece],
      basis: "hold-empty-inferred-complement",
      buildNext: query.next.slice(0, 4),
      placeableNextCount: 4,
    };
  }
  return null;
}

export function matchingCycle1AdvancedQbEntry(
  query: SetupQuery,
  context: Cycle1QueueContext,
): Cycle1AdvancedQbEntry | null {
  const observation = cycle1AdvancedQbObservation(query, context);
  return observation ? entryByOrder.get(observation.orderedLastTwo.join("")) ?? null : null;
}

function materializeRef(entry: Cycle1AdvancedQbEntry, ref: Cycle1AdvancedQbSetupRef): SetupVariant[] {
  const source = sourceById.get(ref.setupId);
  if (!source) return [];
  const transformed = ref.transform === "mirror-x" ? mirrorSetup(source) : source;
  const rated = { ...transformed, solveRate: ref.solveRate };
  const variants = ref.boxMode === "all-wall-minimals" ? expandBoxSetups([rated]) : [rated];
  for (const variant of variants) materializedMeta.set(variant, { entry, ref });
  return variants;
}

export function cycle1AdvancedQbCatalogForEntry(entry: Cycle1AdvancedQbEntry): SetupVariant[] {
  const cached = catalogCache.get(entry.id);
  if (cached) return cached;
  const catalog = entry.candidateGroups.flatMap((group) => group.flatMap((ref) => materializeRef(entry, ref)));
  catalogCache.set(entry.id, catalog);
  return catalog;
}

export function cycle1AdvancedQbMetaForSetup(setup: SetupVariant): MaterializedSetupMeta | undefined {
  return materializedMeta.get(setup);
}

export function cycle1AdvancedQbScoreForSetup(setup: SetupVariant): readonly number[] {
  const ref = materializedMeta.get(setup)?.ref;
  if (!ref) return [Number.MAX_SAFE_INTEGER];
  return [
    ref.rankGroup,
    -ref.solveRate,
    -ref.pieceCount,
    ref.itemOrder,
    ref.frameOrder,
  ];
}

export function cycle1AdvancedQbConditionLabel(entry: Cycle1AdvancedQbEntry): string {
  return `Cycle 1 ${entry.orderedLastTwo.join("")} QB`;
}
