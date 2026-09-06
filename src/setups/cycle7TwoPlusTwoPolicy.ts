import { PIECES, type Piece } from "../engine/types";
import { cycle7QueueContext } from "./cycle7Context";
import type { SetupQuery } from "./query";
import type { SetupVariant } from "./schema";

export interface Cycle7TwoPlusTwoEntry {
  id: string;
  candidateSetupIds: string[];
  previousBagPieces: Piece[];
  nextBagPrefixPieces: Piece[];
  /** Source-entry Good Save metric, not an individual form's PC success rate. */
  goodSavePercent: number;
  order: number;
}

export interface Cycle7TwoPlusTwoPolicy {
  schemaVersion: 2;
  cycle: 7;
  reviewStatus: "draft" | "reviewed";
  metrics: [];
  selectionRules: [];
  runtimePolicy: {
    catalogKind: "cycle7-2plus2-qb";
    integrationState: "active" | "inactive";
    executable: boolean;
    setupBuildSegments: [2, 2];
    requiredUnplacedPriorPiece: "T";
    classSelector: "exact-prior-three-multiset";
    pairSelector: "unordered-next-bag-first-two";
    ranking: "good-save-desc-then-entry-order";
  };
  entries: Cycle7TwoPlusTwoEntry[];
}

export interface Cycle7TwoPlusTwoBundle {
  catalog: SetupVariant[];
  policy: Cycle7TwoPlusTwoPolicy;
}

const signature = (pieces: readonly Piece[]) => [...pieces].sort().join("");
const validPieces = (pieces: unknown, length: number): pieces is Piece[] =>
  Array.isArray(pieces) && pieces.length === length
  && pieces.every(piece => (PIECES as readonly unknown[]).includes(piece));

/** Validates the executable representation without applying production activation. */
export function cycle7TwoPlusTwoBundleValid(bundle: Cycle7TwoPlusTwoBundle): boolean {
  const p = bundle?.policy;
  const r = p?.runtimePolicy;
  if (p?.schemaVersion !== 2 || p.cycle !== 7
    || !Array.isArray(p.metrics) || p.metrics.length !== 0
    || !Array.isArray(p.selectionRules) || p.selectionRules.length !== 0
    || r?.catalogKind !== "cycle7-2plus2-qb" || r.executable !== true
    || r.setupBuildSegments?.join(",") !== "2,2" || r.requiredUnplacedPriorPiece !== "T"
    || r.classSelector !== "exact-prior-three-multiset"
    || r.pairSelector !== "unordered-next-bag-first-two"
    || r.ranking !== "good-save-desc-then-entry-order"
    || !Array.isArray(p.entries) || p.entries.length === 0 || !Array.isArray(bundle.catalog)) return false;
  const byId = new Map(bundle.catalog.map(s => [s.id, s]));
  if (byId.size !== bundle.catalog.length) return false;
  const refs = new Set<string>(), entries = new Set<string>();
  for (const entry of p.entries) {
    if (!entry?.id || entries.has(entry.id)
      || !validPieces(entry.previousBagPieces, 3) || !entry.previousBagPieces.includes("T")
      || !validPieces(entry.nextBagPrefixPieces, 2) || new Set(entry.nextBagPrefixPieces).size !== 2
      || entry.nextBagPrefixPieces.includes("T")
      || !Number.isFinite(entry.goodSavePercent) || entry.goodSavePercent < 0 || entry.goodSavePercent > 100
      || !Number.isInteger(entry.order) || entry.order < 0
      || !Array.isArray(entry.candidateSetupIds) || entry.candidateSetupIds.length === 0) return false;
    entries.add(entry.id);
    const required = [...entry.previousBagPieces, ...entry.nextBagPrefixPieces];
    required.splice(required.indexOf("T"), 1);
    for (const id of entry.candidateSetupIds) {
      const setup = byId.get(id);
      if (!setup || refs.has(id) || setup.cycle !== 7 || setup.geometryKind !== undefined
        || setup.placements.length !== 4 || signature(setup.pieceSignature) !== signature(required)
        || setup.recommendationGroup !== entry.id) return false;
      refs.add(id);
    }
  }
  return refs.size === byId.size;
}

export function cycle7TwoPlusTwoRuntimeReady(
  gate: { runtimeEnabled?: boolean; conditionCompilerReady?: boolean; setupCount?: number; logicalSetupCount?: number } | undefined,
  bundle: Cycle7TwoPlusTwoBundle,
): boolean {
  return gate?.runtimeEnabled === true && gate.conditionCompilerReady === true
    && gate.setupCount === bundle.catalog.length && gate.logicalSetupCount === bundle.policy.entries.length
    && bundle.policy.reviewStatus === "reviewed" && bundle.policy.runtimePolicy.integrationState === "active"
    && bundle.catalog.every(s => s.reviewStatus === "reviewed" && s.runtimeEligible === true)
    && cycle7TwoPlusTwoBundleValid(bundle);
}

export function cycle7TwoPlusTwoMatches(query: SetupQuery, bundle: Cycle7TwoPlusTwoBundle) {
  if (query.cycle !== 7 || !cycle7TwoPlusTwoBundleValid(bundle)) return null;
  const context = cycle7QueueContext(query);
  if (!context) return null;
  const pair = query.next.slice(context.placeableNextCount, context.placeableNextCount + 2);
  if (!validPieces(context.buildPieces, 3) || !validPieces(pair, 2)
    || pair.includes("T") || new Set(pair).size !== 2) return null;
  const entries = bundle.policy.entries.filter(entry =>
    signature(entry.previousBagPieces) === signature(context.buildPieces)
    && signature(entry.nextBagPrefixPieces) === signature(pair));
  const entryBySetupId = new Map(entries.flatMap(entry => entry.candidateSetupIds.map(id => [id, entry] as const)));
  return {
    catalog: bundle.catalog.filter(setup => entryBySetupId.has(setup.id)),
    entryBySetupId,
    // All next-pair pieces are non-T. Exact composition removes only one prior
    // T, so every legal four-placement plan consumes precisely 2 prior + 2 next.
    // Later NEXT pieces may release HOLD, but are never placeable by BFS.
    placeableNextCount: context.placeableNextCount + 2,
  };
}

export function cycle7TwoPlusTwoLabel(entry: Cycle7TwoPlusTwoEntry): string {
  return `${entry.previousBagPieces.join("")} - ${entry.nextBagPrefixPieces.join("")} 2+2`;
}
