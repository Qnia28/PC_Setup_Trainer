import rawCycle1 from "../../setups/cycle-1-setups.json";
import rawCycle1Policy from "../../setups/cycle-1-policy.json";
import rawCycle2 from "../../setups/cycle-2-setups.json";
import rawCycle2Policy from "../../setups/cycle-2-policy.json";
import rawCycle2Advanced3P from "../../setups/cycle-2-advanced-3p-setups.json";
import rawCycle2Advanced3PPolicy from "../../setups/cycle-2-advanced-3p-policy.json";
import rawCycle3I from "../../setups/cycle-3-extra-i-setups.json";
import rawCycle3IPolicy from "../../setups/cycle-3-extra-i-policy.json";
import rawCycle3LJ from "../../setups/cycle-3-extra-lj-setups.json";
import rawCycle3LJPolicy from "../../setups/cycle-3-extra-lj-policy.json";
import rawCycle3O from "../../setups/cycle-3-extra-o-setups.json";
import rawCycle3OPolicy from "../../setups/cycle-3-extra-o-policy.json";
import rawCycle3SZ from "../../setups/cycle-3-extra-sz-setups.json";
import rawCycle3SZPolicy from "../../setups/cycle-3-extra-sz-policy.json";
import rawCycle3T from "../../setups/cycle-3-extra-t-setups.json";
import rawCycle3TPolicy from "../../setups/cycle-3-extra-t-policy.json";
import rawCycle6I from "../../setups/cycle-6-no-i-setups.json";
import rawCycle6IPolicy from "../../setups/cycle-6-no-i-policy.json";
import rawCycle6LJ from "../../setups/cycle-6-no-lj-setups.json";
import rawCycle6LJPolicy from "../../setups/cycle-6-no-lj-policy.json";
import rawCycle6O from "../../setups/cycle-6-no-o-setups.json";
import rawCycle6OPolicy from "../../setups/cycle-6-no-o-policy.json";
import rawCycle6SZ from "../../setups/cycle-6-no-sz-setups.json";
import rawCycle6SZPolicy from "../../setups/cycle-6-no-sz-policy.json";
import rawCycle6T from "../../setups/cycle-6-no-t-setups.json";
import rawCycle6TPolicy from "../../setups/cycle-6-no-t-policy.json";
import rawCycle7 from "../../setups/cycle-7-setups.json";
import rawCycle7Policy from "../../setups/cycle-7-policy.json";
import rawManifest from "../../setups/catalog-manifest.json";
import {
  cycle4RuntimeCatalog,
  cycle4SourceCatalog,
  setupsForCycle4Class,
} from "./cycle4Catalog";
import {
  cycle5RuntimeCatalog,
  cycle5SourceCatalog,
  setupsForCycle5Class,
} from "./cycle5Catalog";
import { expandMirroredSetups, mirrorSetup } from "./mirror";
import { expandEquivalentPlacementVariants } from "./placementVariants";
import { applyStructuredPolicyMetrics, type StructuredSetupPolicy } from "./policy";
import { expandBoxSetups } from "./rotation";
import { assertValidCatalog, type SetupVariant } from "./schema";
import type { Piece } from "../engine/types";
import { cycle8TxAllRuntimeCatalog, cycle8TxSourceCatalog } from "./cycle8TxCatalog";
import { cycle8LjxAllRuntimeCatalog, cycle8LjxSourceCatalog } from "./cycle8LjxCatalog";

const cycle1Policy = rawCycle1Policy as unknown as StructuredSetupPolicy;
const cycle1Catalog = applyStructuredPolicyMetrics(rawCycle1 as SetupVariant[], cycle1Policy);
const cycle2StandardPolicy = rawCycle2Policy as unknown as StructuredSetupPolicy;
const cycle2Advanced3PPolicy = rawCycle2Advanced3PPolicy as unknown as StructuredSetupPolicy;
const cycle2Policy: StructuredSetupPolicy = {
  ...cycle2StandardPolicy,
  metrics: [...cycle2StandardPolicy.metrics, ...cycle2Advanced3PPolicy.metrics],
  buildConstraints: [
    ...(cycle2StandardPolicy.buildConstraints ?? []),
    ...(cycle2Advanced3PPolicy.buildConstraints ?? []),
  ],
  selectionRules: [...cycle2StandardPolicy.selectionRules, ...cycle2Advanced3PPolicy.selectionRules],
  rankingHints: cycle2StandardPolicy.rankingHints,
};
const cycle2StandardCatalog = applyStructuredPolicyMetrics(
  rawCycle2 as SetupVariant[],
  cycle2StandardPolicy,
);
const cycle2Advanced3PCatalog = applyStructuredPolicyMetrics(
  rawCycle2Advanced3P as unknown as SetupVariant[],
  cycle2Advanced3PPolicy,
);
const cycle2Catalog = [...cycle2StandardCatalog, ...cycle2Advanced3PCatalog];
const cycle3OPolicy = rawCycle3OPolicy as unknown as StructuredSetupPolicy;
const cycle3O = applyStructuredPolicyMetrics(rawCycle3O as unknown as SetupVariant[], cycle3OPolicy);
const cycle3TPolicy = rawCycle3TPolicy as unknown as StructuredSetupPolicy;
const cycle3T = applyStructuredPolicyMetrics(rawCycle3T as unknown as SetupVariant[], cycle3TPolicy);
const cycle3IPolicy = rawCycle3IPolicy as unknown as StructuredSetupPolicy;
const cycle3I = applyStructuredPolicyMetrics(rawCycle3I as unknown as SetupVariant[], cycle3IPolicy);
const cycle3LJPolicy = rawCycle3LJPolicy as unknown as StructuredSetupPolicy;
const cycle3LJ = applyStructuredPolicyMetrics(rawCycle3LJ as unknown as SetupVariant[], cycle3LJPolicy);
const cycle3SZPolicy = rawCycle3SZPolicy as unknown as StructuredSetupPolicy;
const cycle3SZ = applyStructuredPolicyMetrics(rawCycle3SZ as unknown as SetupVariant[], cycle3SZPolicy);
const cycle6IPolicy = rawCycle6IPolicy as unknown as StructuredSetupPolicy;
const cycle6I = applyStructuredPolicyMetrics(rawCycle6I as unknown as SetupVariant[], cycle6IPolicy);
const cycle6LJPolicy = rawCycle6LJPolicy as unknown as StructuredSetupPolicy;
const cycle6LJ = applyStructuredPolicyMetrics(rawCycle6LJ as unknown as SetupVariant[], cycle6LJPolicy);
const cycle6OPolicy = rawCycle6OPolicy as unknown as StructuredSetupPolicy;
const cycle6O = applyStructuredPolicyMetrics(rawCycle6O as unknown as SetupVariant[], cycle6OPolicy);
const cycle6SZPolicy = rawCycle6SZPolicy as unknown as StructuredSetupPolicy;
const cycle6SZ = applyStructuredPolicyMetrics(rawCycle6SZ as unknown as SetupVariant[], cycle6SZPolicy);
const cycle6TPolicy = rawCycle6TPolicy as unknown as StructuredSetupPolicy;
const cycle6T = applyStructuredPolicyMetrics(rawCycle6T as unknown as SetupVariant[], cycle6TPolicy);
const cycle7Policy = rawCycle7Policy as unknown as StructuredSetupPolicy;
const cycle7Catalog = applyStructuredPolicyMetrics(rawCycle7 as SetupVariant[], cycle7Policy);

const cycle1RuntimeCatalog = expandBoxSetups(expandMirroredSetups(
  expandEquivalentPlacementVariants(cycle1Catalog),
));
// Expand the two Cycle 2 source catalogs together so an existing cross-catalog
// mirror geometry remains one physical runtime record. Split the resulting
// records back into recommendation tiers by their canonical source identity.
const cycle2RuntimeCatalog = expandBoxSetups(expandMirroredSetups(
  expandEquivalentPlacementVariants(cycle2Catalog),
));
const cycle2StandardSourceIds = new Set(cycle2StandardCatalog.map(({ id }) => id));
const cycle2Advanced3PSourceIds = new Set(cycle2Advanced3PCatalog.map(({ id }) => id));
const cycle2CanonicalSourceId = (setup: SetupVariant): string =>
  setup.policySourceId ?? setup.id.split("--box-")[0].replace(/--mirror$/, "");
const cycle2StandardRuntimeCatalog = cycle2RuntimeCatalog.filter((setup) =>
  cycle2StandardSourceIds.has(cycle2CanonicalSourceId(setup)));
const cycle2Advanced3PRuntimeCatalog = cycle2RuntimeCatalog.filter((setup) =>
  cycle2Advanced3PSourceIds.has(cycle2CanonicalSourceId(setup)));
const cycle7RuntimeCatalog = expandBoxSetups(expandMirroredSetups(
  expandEquivalentPlacementVariants(cycle7Catalog),
));
const nonClassedSource = [...cycle1Catalog, ...cycle2Catalog, ...cycle7Catalog];
const nonClassedRuntime = [
  ...cycle1RuntimeCatalog,
  ...cycle2RuntimeCatalog,
  ...cycle7RuntimeCatalog,
];

const cycle3RuntimeByPiece: Record<Piece, SetupVariant[]> = {
  O: expandBoxSetups(expandMirroredSetups(expandEquivalentPlacementVariants(cycle3O))),
  T: expandBoxSetups(expandMirroredSetups(expandEquivalentPlacementVariants(cycle3T))),
  I: expandBoxSetups(expandMirroredSetups(expandEquivalentPlacementVariants(cycle3I))),
  L: expandBoxSetups(expandEquivalentPlacementVariants(cycle3LJ)),
  J: expandBoxSetups(expandEquivalentPlacementVariants(cycle3LJ).map(mirrorSetup)),
  S: expandBoxSetups(expandEquivalentPlacementVariants(cycle3SZ)),
  Z: expandBoxSetups(expandEquivalentPlacementVariants(cycle3SZ).map(mirrorSetup)),
};

interface SymmetryPolicyFile extends StructuredSetupPolicy {
  symmetryPolicy?: { appliesToSetupIds?: string[] };
}

function expandSelectedMirrors(catalog: SetupVariant[], policy: StructuredSetupPolicy): SetupVariant[] {
  const ids = new Set((policy as SymmetryPolicyFile).symmetryPolicy?.appliesToSetupIds ?? []);
  const physicalCatalog = expandEquivalentPlacementVariants(catalog);
  return [
    ...physicalCatalog,
    ...physicalCatalog.filter((setup) => ids.has(setup.policySourceId ?? setup.id)).map(mirrorSetup),
  ];
}

const cycle6RuntimeByPiece: Record<Piece, SetupVariant[]> = {
  S: expandBoxSetups(expandEquivalentPlacementVariants(cycle6SZ)),
  Z: expandBoxSetups(expandEquivalentPlacementVariants(cycle6SZ).map(mirrorSetup)),
  O: expandBoxSetups(expandSelectedMirrors(cycle6O, cycle6OPolicy)),
  L: expandBoxSetups(expandEquivalentPlacementVariants(cycle6LJ)),
  J: expandBoxSetups(expandEquivalentPlacementVariants(cycle6LJ).map(mirrorSetup)),
  I: expandBoxSetups(expandSelectedMirrors(cycle6I, cycle6IPolicy)),
  T: expandBoxSetups(expandSelectedMirrors(cycle6T, cycle6TPolicy)),
};

export const sourceSetupCatalog = [
  ...nonClassedSource,
  ...cycle3O,
  ...cycle3T,
  ...cycle3I,
  ...cycle3LJ,
  ...cycle3SZ,
  ...cycle4SourceCatalog,
  ...cycle5SourceCatalog,
  ...cycle6SZ,
  ...cycle6O,
  ...cycle6LJ,
  ...cycle6I,
  ...cycle6T,
  ...cycle8TxSourceCatalog(),
  ...cycle8LjxSourceCatalog(),
];
assertValidCatalog(sourceSetupCatalog);

export const setupCatalog = [
  ...nonClassedRuntime,
  ...cycle3RuntimeByPiece.O,
  ...cycle3RuntimeByPiece.T,
  ...cycle3RuntimeByPiece.I,
  ...cycle3RuntimeByPiece.L,
  ...cycle3RuntimeByPiece.J,
  ...cycle3RuntimeByPiece.S,
  ...cycle3RuntimeByPiece.Z,
  ...cycle4RuntimeCatalog,
  ...cycle5RuntimeCatalog,
  ...cycle6RuntimeByPiece.S,
  ...cycle6RuntimeByPiece.Z,
  ...cycle6RuntimeByPiece.O,
  ...cycle6RuntimeByPiece.L,
  ...cycle6RuntimeByPiece.J,
  ...cycle6RuntimeByPiece.I,
  ...cycle6RuntimeByPiece.T,
  ...cycle8TxAllRuntimeCatalog(),
  ...cycle8LjxAllRuntimeCatalog(),
];
assertValidCatalog(setupCatalog);

function indexCatalogByCycle(
  catalog: readonly SetupVariant[],
): ReadonlyMap<number, readonly SetupVariant[]> {
  const byCycle = new Map<number, SetupVariant[]>();
  for (const setup of catalog) {
    const bucket = byCycle.get(setup.cycle);
    if (bucket) bucket.push(setup);
    else byCycle.set(setup.cycle, [setup]);
  }
  for (const bucket of byCycle.values()) Object.freeze(bucket);
  return byCycle;
}

const EMPTY_SETUP_CATALOG: readonly SetupVariant[] = Object.freeze([]);
const sourceSetupCatalogByCycle = indexCatalogByCycle(sourceSetupCatalog);
const setupCatalogByCycle = indexCatalogByCycle(setupCatalog);

export function setupsForCycle(cycle: number): readonly SetupVariant[] {
  return setupCatalogByCycle.get(cycle) ?? EMPTY_SETUP_CATALOG;
}

/** Cycle 2 source-page general catalog, kept separate from advanced 3P at runtime. */
export function setupsForCycle2General(): SetupVariant[] {
  return cycle2StandardRuntimeCatalog;
}

/** Cycle 2 advanced 3P catalog, ranked after the general and QB tiers. */
export function setupsForCycle2Advanced3P(): SetupVariant[] {
  return cycle2Advanced3PRuntimeCatalog;
}

export function setupsForCycle3Class(classPiece: Piece): SetupVariant[] {
  return cycle3RuntimeByPiece[classPiece];
}

export { setupsForCycle4Class };

export { setupsForCycle5Class };

export function setupsForCycle6Class(classPiece: Piece): SetupVariant[] {
  return cycle6RuntimeByPiece[classPiece];
}

export function setupPolicyForCycle(
  cycle: number,
  classPiece?: Piece,
): StructuredSetupPolicy | undefined {
  if (cycle === 2) return cycle2Policy;
  if (cycle === 3 && classPiece === "O") return cycle3OPolicy;
  if (cycle === 3 && classPiece === "T") return cycle3TPolicy;
  if (cycle === 3 && classPiece === "I") return cycle3IPolicy;
  if (cycle === 3 && (classPiece === "L" || classPiece === "J")) return cycle3LJPolicy;
  if (cycle === 3 && (classPiece === "S" || classPiece === "Z")) return cycle3SZPolicy;
  if (cycle === 6 && (classPiece === "S" || classPiece === "Z")) return cycle6SZPolicy;
  if (cycle === 6 && classPiece === "O") return cycle6OPolicy;
  if (cycle === 6 && (classPiece === "L" || classPiece === "J")) return cycle6LJPolicy;
  if (cycle === 6 && classPiece === "I") return cycle6IPolicy;
  if (cycle === 6 && classPiece === "T") return cycle6TPolicy;
  if (cycle === 7) return cycle7Policy;
  return undefined;
}

export interface SetupCatalogCoverage {
  cycle: number;
  logicalSetupCount: number;
  setupCount: number;
  runtimeVariantCount: number;
  complete: boolean;
  note: string;
}

interface CatalogManifest {
  cycles: Record<string, {
    logicalSetupCount?: number;
    setupCount: number;
    runtimeEnabled?: boolean;
    complete: boolean;
    note: string;
  }>;
}

const catalogManifest = rawManifest as CatalogManifest;

export function setupCoverageForCycle(cycle: number): SetupCatalogCoverage {
  const setupCount = sourceSetupCatalogByCycle.get(cycle)?.length ?? 0;
  const runtimeVariantCount = setupsForCycle(cycle).length;
  const manifestEntry = catalogManifest.cycles[String(cycle)];
  if (manifestEntry?.runtimeEnabled === false) {
    return {
      cycle,
      logicalSetupCount: manifestEntry.logicalSetupCount ?? manifestEntry.setupCount,
      setupCount: 0,
      runtimeVariantCount: 0,
      complete: false,
      note: `${manifestEntry.note} Production data is promoted and awaiting runtime integration.`,
    };
  }
  if (manifestEntry) {
    if (manifestEntry.setupCount !== setupCount) {
      throw new Error(`Cycle ${cycle} manifest setupCount (${manifestEntry.setupCount}) does not match the catalog (${setupCount}).`);
    }
    return {
      cycle,
      logicalSetupCount: manifestEntry.logicalSetupCount ?? setupCount,
      setupCount,
      runtimeVariantCount,
      complete: manifestEntry.complete,
      note: manifestEntry.note,
    };
  }
  return {
    cycle,
    logicalSetupCount: setupCount,
    setupCount,
    runtimeVariantCount,
    complete: false,
    note: "Setup data for this cycle is not registered yet.",
  };
}
