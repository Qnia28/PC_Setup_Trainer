import rawManifest from "../../setups/catalog-manifest.json";
import rawCatalog from "../../setups/cycle-8-ljx-setups.json";
import rawPolicy from "../../setups/cycle-8-ljx-policy.json";
import type { Piece } from "../engine/types";
import { mirrorSetup } from "./mirror";
import { expandBoxSetups } from "./rotation";
import type { SetupVariant } from "./schema";

export type Cycle8LjxExactClass =
  | "L>T" | "L>O" | "L>I" | "L>J" | "L>S" | "L>Z"
  | "J>T" | "J>O" | "J>I" | "J>L" | "J>S" | "J>Z";
export type Cycle8LjxFamilyKind = "general-4p" | "general-3p";

export interface Cycle8LjxRuntimeEntry {
  setupId: string;
  sourceOrder: number;
  familyKind: Cycle8LjxFamilyKind;
  sourceClass: Cycle8LjxExactClass;
  mirrorClass: Cycle8LjxExactClass;
  sourceRecommended: boolean;
}

interface Cycle8LjxPolicy {
  reviewStatus?: string;
  metrics: Array<{ setupId: string; direction: Cycle8LjxExactClass; values: { solveRate?: number } }>;
  runtimePolicy: {
    catalogKind: "cycle8-ljx";
    integrationState: "active" | "inactive";
    familyOrder: Cycle8LjxFamilyKind[];
    entries: Cycle8LjxRuntimeEntry[];
    fallback: "none";
  };
}

interface Cycle8AdditionalCatalogManifest {
  setups?: string;
  runtimeEnabled?: boolean;
  conditionCompilerReady?: boolean;
  setupCount?: number;
}

interface Cycle8LjxManifest {
  cycles?: Record<string, { additionalCatalogs?: Cycle8AdditionalCatalogManifest[] }>;
}

export interface Cycle8LjxRuntimeBundle {
  setups: SetupVariant[];
  policy: Cycle8LjxPolicy;
}

const manifest = rawManifest as Cycle8LjxManifest;
const sourceCatalog = rawCatalog as unknown as SetupVariant[];
const policy = rawPolicy as unknown as Cycle8LjxPolicy;
const sourceById = new Map(sourceCatalog.map((setup) => [setup.id, setup]));
const entryById = new Map(policy.runtimePolicy.entries.map((entry) => [entry.setupId, entry]));
const metricBySetupAndClass = new Map(policy.metrics.map((metric) => [
  `${metric.setupId}\0${metric.direction}`,
  metric.values.solveRate,
]));

export function canonicalCycle8LjxSetupId(setup: SetupVariant): string {
  return (setup.policySourceId ?? setup.id).split("--box-")[0]!.replace(/--mirror$/, "");
}

function isMirroredRuntimeSetup(setup: SetupVariant): boolean {
  return setup.id.split("--box-")[0]!.endsWith("--mirror") || setup.derivedVariant === "mirror";
}

function exactClassForEntryVariant(
  entry: Cycle8LjxRuntimeEntry,
  mirrored: boolean,
): Cycle8LjxExactClass {
  return mirrored ? entry.mirrorClass : entry.sourceClass;
}

function runtimeVariantsForEntry(entry: Cycle8LjxRuntimeEntry): SetupVariant[] {
  const setup = sourceById.get(entry.setupId);
  if (!setup) return [];
  return expandBoxSetups([setup, mirrorSetup(setup)]).map((variant) => {
    const exactClass = exactClassForEntryVariant(entry, isMirroredRuntimeSetup(variant));
    return {
      ...variant,
      displayName: variant.displayName.replace(entry.sourceClass, exactClass),
      solveRate: metricBySetupAndClass.get(`${entry.setupId}\0${exactClass}`),
    };
  });
}

const allRuntimeCatalog = policy.runtimePolicy.entries.flatMap(runtimeVariantsForEntry);
const runtimeByClass = new Map<Cycle8LjxExactClass, SetupVariant[]>();
for (const setup of allRuntimeCatalog) {
  const exactClass = cycle8LjxExactClassForSetup(setup);
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

export function cycle8LjxRuntimeReady(
  manifestEntry: Cycle8AdditionalCatalogManifest | undefined,
  setups: Array<{ id: string; reviewStatus?: string; runtimeEligible?: boolean }>,
  candidatePolicy: Pick<Cycle8LjxPolicy, "reviewStatus" | "runtimePolicy">,
): boolean {
  const setupIds = setups.map(({ id }) => id);
  const runtime = candidatePolicy.runtimePolicy;
  return manifestEntry?.setups === "cycle-8-ljx-setups.json"
    && manifestEntry.runtimeEnabled === true
    && manifestEntry.conditionCompilerReady === true
    && manifestEntry.setupCount === setups.length
    && setups.length > 0
    && setups.every(({ reviewStatus, runtimeEligible }) => reviewStatus === "reviewed" && runtimeEligible === true)
    && candidatePolicy.reviewStatus === "reviewed"
    && runtime?.catalogKind === "cycle8-ljx"
    && runtime.integrationState === "active"
    && runtime.fallback === "none"
    && runtime.familyOrder.join(",") === "general-4p,general-3p"
    && exactCoverage(runtime.entries.map(({ setupId }) => setupId), setupIds);
}

function manifestEntry(): Cycle8AdditionalCatalogManifest | undefined {
  return manifest.cycles?.["8"]?.additionalCatalogs
    ?.find(({ setups }) => setups === "cycle-8-ljx-setups.json");
}

export function cycle8LjxRuntimeBundle(): Cycle8LjxRuntimeBundle | null {
  return cycle8LjxRuntimeReady(manifestEntry(), sourceCatalog, policy)
    ? { setups: allRuntimeCatalog, policy }
    : null;
}

export function cycle8LjxSourceCatalog(): SetupVariant[] {
  return sourceCatalog;
}

export function cycle8LjxAllRuntimeCatalog(): SetupVariant[] {
  return allRuntimeCatalog;
}

export function cycle8LjxCatalogForClass(
  exactClass: Cycle8LjxExactClass,
  familyKind?: Cycle8LjxFamilyKind,
): SetupVariant[] {
  const catalog = runtimeByClass.get(exactClass) ?? [];
  return familyKind === undefined
    ? catalog
    : catalog.filter((setup) => cycle8LjxRuntimeEntryForSetup(setup)?.familyKind === familyKind);
}

export function cycle8LjxRuntimeEntryForSetup(setup: SetupVariant): Cycle8LjxRuntimeEntry | undefined {
  return entryById.get(canonicalCycle8LjxSetupId(setup));
}

export function cycle8LjxExactClassForSetup(setup: SetupVariant): Cycle8LjxExactClass | null {
  const entry = cycle8LjxRuntimeEntryForSetup(setup);
  return entry ? exactClassForEntryVariant(entry, isMirroredRuntimeSetup(setup)) : null;
}

export function cycle8LjxExactClass(
  extraPiece: Piece,
  replacedPiece: Piece,
): Cycle8LjxExactClass | null {
  if ((extraPiece !== "L" && extraPiece !== "J") || replacedPiece === extraPiece) return null;
  return `${extraPiece}>${replacedPiece}` as Cycle8LjxExactClass;
}

export function cycle8LjxScoreForSetup(
  setup: SetupVariant,
  exactClass: Cycle8LjxExactClass,
): readonly number[] {
  const sourceOrder = cycle8LjxRuntimeEntryForSetup(setup)?.sourceOrder ?? Number.MAX_SAFE_INTEGER;
  if (exactClass.startsWith("L>") && setup.solveRate !== undefined) {
    return [-setup.solveRate, sourceOrder];
  }
  return [sourceOrder];
}
