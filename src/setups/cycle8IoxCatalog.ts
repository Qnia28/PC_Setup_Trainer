import rawManifest from "../../setups/catalog-manifest.json";
import rawIxCatalog from "../../setups/cycle-8-ix-setups.json";
import rawIxPolicy from "../../setups/cycle-8-ix-policy.json";
import rawOxCatalog from "../../setups/cycle-8-ox-setups.json";
import rawOxPolicy from "../../setups/cycle-8-ox-policy.json";
import type { Piece } from "../engine/types";
import { mirrorSetup } from "./mirror";
import { expandBoxSetups } from "./rotation";
import type { SetupVariant } from "./schema";

export type Cycle8IoxExactClass =
  | "I>T" | "I>O" | "I>L" | "I>J" | "I>S" | "I>Z"
  | "O>T" | "O>I" | "O>L" | "O>J" | "O>S" | "O>Z";
export type Cycle8IoxFamilyKind = "general-4p" | "general-3p" | "two-line-pc";

export interface Cycle8IoxRuntimeEntry {
  setupId: string;
  sourceOrder: number;
  familyKind: Cycle8IoxFamilyKind;
  sourceClass: Cycle8IoxExactClass;
  exactClasses: Cycle8IoxExactClass[];
  mirrorMode: "within-class" | "exact-class";
  sourceRecommended: boolean;
}

export interface Cycle8IoxTwoLineDirection {
  exactClass: "O>S" | "O>Z";
  nextCycle: 5;
  nextClass: "TZ" | "TS";
}

export interface Cycle8IoxTwoLinePcPlan {
  id: string;
  setupId: string;
  sourceOrder: number;
  lineCount: 2;
  probabilityPercent: number;
  directions: Cycle8IoxTwoLineDirection[];
}

interface Cycle8IoxPolicy {
  reviewStatus?: string;
  metrics: Array<{
    setupId: string;
    direction: Cycle8IoxExactClass | "horizontalMirror";
    values: { solveRate?: number };
  }>;
  runtimePolicy: {
    catalogKind: "cycle8-i" | "cycle8-o";
    integrationState: "active" | "inactive";
    familyOrder: Cycle8IoxFamilyKind[];
    entries: Cycle8IoxRuntimeEntry[];
    twoLinePcPlans?: Cycle8IoxTwoLinePcPlan[];
    fallback: "none";
  };
}

interface Cycle8AdditionalCatalogManifest {
  setups?: string;
  runtimeEnabled?: boolean;
  conditionCompilerReady?: boolean;
  setupCount?: number;
  logicalSetupCount?: number;
}

interface Cycle8IoxManifest {
  cycles?: Record<string, { additionalCatalogs?: Cycle8AdditionalCatalogManifest[] }>;
}

export interface Cycle8IoxRuntimeBundle {
  setups: SetupVariant[];
  policy: Cycle8IoxPolicy;
}

interface CatalogState {
  extraPiece: "I" | "O";
  filename: "cycle-8-ix-setups.json" | "cycle-8-ox-setups.json";
  sourceCatalog: SetupVariant[];
  policy: Cycle8IoxPolicy;
  sourceById: Map<string, SetupVariant>;
  entryById: Map<string, Cycle8IoxRuntimeEntry>;
  metricBySetupAndDirection: Map<string, number | undefined>;
  allRuntimeCatalog: SetupVariant[];
  runtimeByClass: Map<Cycle8IoxExactClass, SetupVariant[]>;
}

const manifest = rawManifest as Cycle8IoxManifest;

export function canonicalCycle8IoxSetupId(setup: SetupVariant): string {
  return (setup.policySourceId ?? setup.id).split("--box-")[0]!.replace(/--mirror$/, "");
}

function isMirroredRuntimeSetup(setup: SetupVariant): boolean {
  return setup.id.split("--box-")[0]!.endsWith("--mirror") || setup.derivedVariant === "mirror";
}

function exactClassForEntryVariant(
  entry: Cycle8IoxRuntimeEntry,
  mirrored: boolean,
): Cycle8IoxExactClass {
  if (entry.mirrorMode === "exact-class" && mirrored) {
    return entry.exactClasses.find((classId) => classId !== entry.sourceClass) ?? entry.sourceClass;
  }
  return entry.sourceClass;
}

function makeState(
  extraPiece: "I" | "O",
  filename: CatalogState["filename"],
  rawCatalog: unknown,
  rawPolicy: unknown,
): CatalogState {
  const sourceCatalog = rawCatalog as SetupVariant[];
  const policy = rawPolicy as Cycle8IoxPolicy;
  const sourceById = new Map(sourceCatalog.map((setup) => [setup.id, setup]));
  const entryById = new Map(policy.runtimePolicy.entries.map((entry) => [entry.setupId, entry]));
  const metricBySetupAndDirection = new Map(policy.metrics.map((metric) => [
    `${metric.setupId}\0${metric.direction}`,
    metric.values.solveRate,
  ]));
  const allRuntimeCatalog = policy.runtimePolicy.entries.flatMap((entry) => {
    const setup = sourceById.get(entry.setupId);
    if (!setup) return [];
    return expandBoxSetups([setup, mirrorSetup(setup)]).map((variant) => {
      const mirrored = isMirroredRuntimeSetup(variant);
      const exactClass = exactClassForEntryVariant(entry, mirrored);
      const metricDirection = mirrored && entry.mirrorMode === "within-class"
        ? "horizontalMirror"
        : exactClass;
      return {
        ...variant,
        displayName: setup.displayName === "2L"
          ? "2L"
          : variant.displayName.replace(entry.sourceClass, exactClass),
        solveRate: metricBySetupAndDirection.get(`${entry.setupId}\0${metricDirection}`),
      };
    });
  });
  const runtimeByClass = new Map<Cycle8IoxExactClass, SetupVariant[]>();
  for (const setup of allRuntimeCatalog) {
    const entry = entryById.get(canonicalCycle8IoxSetupId(setup));
    if (!entry) continue;
    const exactClass = exactClassForEntryVariant(entry, isMirroredRuntimeSetup(setup));
    const bucket = runtimeByClass.get(exactClass);
    if (bucket) bucket.push(setup);
    else runtimeByClass.set(exactClass, [setup]);
  }
  return {
    extraPiece,
    filename,
    sourceCatalog,
    policy,
    sourceById,
    entryById,
    metricBySetupAndDirection,
    allRuntimeCatalog,
    runtimeByClass,
  };
}

const states: Record<"I" | "O", CatalogState> = {
  I: makeState("I", "cycle-8-ix-setups.json", rawIxCatalog, rawIxPolicy),
  O: makeState("O", "cycle-8-ox-setups.json", rawOxCatalog, rawOxPolicy),
};

function exactCoverage(ids: string[], expected: string[]): boolean {
  return ids.length === expected.length
    && new Set(ids).size === ids.length
    && ids.every((id) => expected.includes(id));
}

function twoLinePlansValid(state: CatalogState): boolean {
  const plans = state.policy.runtimePolicy.twoLinePcPlans ?? [];
  if (state.extraPiece === "I") return plans.length === 0;
  const plan = plans[0];
  return plans.length === 1
    && plan?.setupId === "geometry-cycle-8-ox-item-040-f000"
    && state.entryById.get(plan.setupId)?.familyKind === "two-line-pc"
    && plan.lineCount === 2
    && plan.probabilityPercent === 33.33
    && JSON.stringify(plan.directions) === JSON.stringify([
      { exactClass: "O>S", nextCycle: 5, nextClass: "TZ" },
      { exactClass: "O>Z", nextCycle: 5, nextClass: "TS" },
    ]);
}

export function cycle8IoxRuntimeReady(
  manifestEntry: Cycle8AdditionalCatalogManifest | undefined,
  state: CatalogState,
): boolean {
  const setupIds = state.sourceCatalog.map(({ id }) => id);
  const runtime = state.policy.runtimePolicy;
  const expectedFamilies = state.extraPiece === "I"
    ? "general-4p,general-3p"
    : "general-4p,two-line-pc";
  return manifestEntry?.setups === state.filename
    && manifestEntry.runtimeEnabled === true
    && manifestEntry.conditionCompilerReady === true
    && manifestEntry.setupCount === state.sourceCatalog.length
    && manifestEntry.logicalSetupCount === state.policy.runtimePolicy.entries.length
    && state.sourceCatalog.length > 0
    && state.sourceCatalog.every(({ reviewStatus, runtimeEligible }) =>
      reviewStatus === "reviewed" && runtimeEligible === true)
    && state.policy.reviewStatus === "reviewed"
    && runtime.catalogKind === `cycle8-${state.extraPiece.toLowerCase()}`
    && runtime.integrationState === "active"
    && runtime.fallback === "none"
    && runtime.familyOrder.join(",") === expectedFamilies
    && exactCoverage(runtime.entries.map(({ setupId }) => setupId), setupIds)
    && twoLinePlansValid(state);
}

function manifestEntry(state: CatalogState): Cycle8AdditionalCatalogManifest | undefined {
  return manifest.cycles?.["8"]?.additionalCatalogs
    ?.find(({ setups }) => setups === state.filename);
}

export function cycle8IoxRuntimeBundle(extraPiece: "I" | "O"): Cycle8IoxRuntimeBundle | null {
  const state = states[extraPiece];
  return cycle8IoxRuntimeReady(manifestEntry(state), state)
    ? { setups: state.allRuntimeCatalog, policy: state.policy }
    : null;
}

export function cycle8IoxSourceCatalog(): SetupVariant[] {
  return [...states.I.sourceCatalog, ...states.O.sourceCatalog];
}

export function cycle8IoxAllRuntimeCatalog(): SetupVariant[] {
  return [...states.I.allRuntimeCatalog, ...states.O.allRuntimeCatalog];
}

export function cycle8IoxCatalogForClass(exactClass: Cycle8IoxExactClass): SetupVariant[] {
  return states[exactClass[0] as "I" | "O"].runtimeByClass.get(exactClass) ?? [];
}

export function cycle8IoxRuntimeEntryForSetup(setup: SetupVariant): Cycle8IoxRuntimeEntry | undefined {
  const canonicalId = canonicalCycle8IoxSetupId(setup);
  return states.I.entryById.get(canonicalId) ?? states.O.entryById.get(canonicalId);
}

export function cycle8IoxExactClassForSetup(setup: SetupVariant): Cycle8IoxExactClass | null {
  const entry = cycle8IoxRuntimeEntryForSetup(setup);
  return entry ? exactClassForEntryVariant(entry, isMirroredRuntimeSetup(setup)) : null;
}

export function cycle8IoxExactClass(
  extraPiece: Piece,
  replacedPiece: Piece,
): Cycle8IoxExactClass | null {
  if ((extraPiece !== "I" && extraPiece !== "O") || replacedPiece === extraPiece) return null;
  return `${extraPiece}>${replacedPiece}` as Cycle8IoxExactClass;
}

export function cycle8IoxScoreForSetup(setup: SetupVariant): readonly number[] {
  return [cycle8IoxRuntimeEntryForSetup(setup)?.sourceOrder ?? Number.MAX_SAFE_INTEGER];
}

export function cycle8IoxTwoLinePcPlanForSetup(
  setup: SetupVariant,
  exactClass: Cycle8IoxExactClass,
): { plan: Cycle8IoxTwoLinePcPlan; direction: Cycle8IoxTwoLineDirection } | null {
  const state = states[exactClass[0] as "I" | "O"];
  const plan = state.policy.runtimePolicy.twoLinePcPlans?.find(({ setupId }) =>
    setupId === canonicalCycle8IoxSetupId(setup));
  const direction = plan?.directions.find((candidate) => candidate.exactClass === exactClass);
  return plan && direction ? { plan, direction } : null;
}
