import rawManifest from "../../setups/catalog-manifest.json";
import { PIECES, type Cycle, type Piece } from "../engine/types";
import { expandMirroredSetups } from "../setups/mirror";
import { expandEquivalentPlacementVariants } from "../setups/placementVariants";
import { applyStructuredPolicyMetrics, type StructuredSetupPolicy } from "../setups/policy";
import { expandBoxSetups } from "../setups/rotation";
import type {
  Cycle3ClassBinding,
  SelectedRecommendationBundle,
} from "../setups/recommendationScope";
import { isSolutionShadowSetup, type SetupVariant, type TargetPlacement } from "../setups/schema";

export type SetupTestCatalogGroup = "promoted" | "draft";

export interface SetupTestCatalogDescriptor {
  id: string;
  label: string;
  cycle: Cycle;
  group: SetupTestCatalogGroup;
  variant: "general" | "qb";
  setupPath: string;
  policyPath?: string;
}

export interface SetupTestCatalogBundle {
  catalog: SetupVariant[];
  policy: unknown;
}

function requiredPolicy<T>(bundle: SetupTestCatalogBundle, descriptor: SetupTestCatalogDescriptor): T {
  if (!bundle.policy || typeof bundle.policy !== "object") {
    throw new Error(`${descriptor.label} requires its matching policy file.`);
  }
  return bundle.policy as T;
}

function cycle3ClassBindingFromPath(path: string): Cycle3ClassBinding | undefined {
  const match = /(?:^|[-/])extra-(o|t|i|lj|sz)(?:[-/]|$)/i.exec(path);
  if (!match) return undefined;
  if (match[1].toLowerCase() === "lj") return { source: "L", mirror: "J" };
  if (match[1].toLowerCase() === "sz") return { source: "S", mirror: "Z" };
  const source = match[1].toUpperCase() as "O" | "T" | "I";
  return { source, mirror: source };
}

/** Converts one explicitly selected setup-test file into a recommendation source. */
export function setupTestRecommendationBundle(
  descriptor: SetupTestCatalogDescriptor,
  bundle: SetupTestCatalogBundle,
): SelectedRecommendationBundle {
  const path = descriptor.setupPath.toLowerCase();
  const base = {
    bundleId: descriptor.id,
    cycle: descriptor.cycle,
    catalog: bundle.catalog,
  };
  if (descriptor.cycle === 2 && descriptor.variant === "qb") {
    return { ...base, kind: "cycle2-qb", cycle: 2, policy: requiredPolicy(bundle, descriptor) };
  }
  if (descriptor.cycle === 5 && descriptor.variant === "qb") {
    return { ...base, kind: "cycle5-advanced", cycle: 5, policy: requiredPolicy(bundle, descriptor) };
  }
  if (descriptor.cycle === 7 && descriptor.variant === "qb") {
    if (path.includes("2plus2")) {
      return { ...base, kind: "cycle7-2plus2-qb", cycle: 7, policy: requiredPolicy(bundle, descriptor) };
    }
    return { ...base, kind: "cycle7-qb", cycle: 7, policy: requiredPolicy(bundle, descriptor) };
  }
  if (descriptor.cycle === 7 && /(?:^|[-/])4p(?:[-/]|$)/.test(path)) {
    return { ...base, kind: "cycle7-advanced-4p", cycle: 7, policy: requiredPolicy(bundle, descriptor) };
  }
  return {
    ...base,
    kind: "structured",
    ...(descriptor.cycle === 2 && /advanced-3p/.test(path) ? { role: "advanced-3p" as const } : {}),
    ...(descriptor.cycle === 3
      ? { cycle3ClassBinding: cycle3ClassBindingFromPath(path) }
      : {}),
    ...(bundle.policy && typeof bundle.policy === "object"
      ? { policy: bundle.policy as StructuredSetupPolicy }
      : {}),
  };
}

const promotedSetupLoaders = {
  ...import.meta.glob<string>("../../setups/cycle-*-setups.json", { query: "?raw", import: "default" }),
  ...import.meta.glob<string>("../../setups/QB/cycle-*-setups.json", { query: "?raw", import: "default" }),
};
const promotedPolicyLoaders = {
  ...import.meta.glob<string>("../../setups/cycle-*-policy.json", { query: "?raw", import: "default" }),
  ...import.meta.glob<string>("../../setups/QB/cycle-*-policy.json", { query: "?raw", import: "default" }),
};

function isPiece(value: unknown): value is Piece {
  return typeof value === "string" && (PIECES as readonly string[]).includes(value);
}

function cycleFromPath(path: string): Cycle | null {
  const match = /(?:^|\/)cycle-([1-7])(?:-|$)/i.exec(path);
  return match ? Number(match[1]) as Cycle : null;
}

function manifestCatalogPairs(value: unknown, pairs = new Map<string, string | undefined>()): Map<string, string | undefined> {
  if (Array.isArray(value)) {
    for (const child of value) manifestCatalogPairs(child, pairs);
    return pairs;
  }
  if (!value || typeof value !== "object") return pairs;
  const record = value as Record<string, unknown>;
  if (typeof record.setups === "string") {
    pairs.set(record.setups.replaceAll("\\", "/"), typeof record.policy === "string"
      ? record.policy.replaceAll("\\", "/")
      : undefined);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "setups" || key === "policy" || key.endsWith("Sha256")) continue;
    manifestCatalogPairs(child, pairs);
  }
  return pairs;
}

export const promotedSetupTestCatalogs: SetupTestCatalogDescriptor[] = [
  ...manifestCatalogPairs(rawManifest).entries(),
].flatMap(([setupPath, policyPath]) => {
  const cycle = cycleFromPath(setupPath);
  const moduleKey = `../../setups/${setupPath}`;
  if (!cycle || !(moduleKey in promotedSetupLoaders)) return [];
  return [{
    id: `promoted:${setupPath}`,
    label: setupPath.split("/").at(-1)!,
    cycle,
    group: "promoted" as const,
    variant: /(^|\/)QB\//i.test(setupPath) || /-qb-/i.test(setupPath) ? "qb" as const : "general" as const,
    setupPath,
    policyPath,
  }];
}).sort((left, right) => left.cycle - right.cycle || left.label.localeCompare(right.label));

export async function fetchDraftSetupTestCatalogs(): Promise<SetupTestCatalogDescriptor[]> {
  const response = await fetch("/__setup_test/drafts", { headers: { accept: "application/json" } });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return [];
  const value = await response.json() as {
    catalogs?: Array<{ id: string; label: string; cycle: number; variant: "general" | "qb" }>;
  };
  return (value.catalogs ?? []).flatMap((catalog) => {
    if (!Number.isInteger(catalog.cycle) || catalog.cycle < 1 || catalog.cycle > 7) return [];
    return [{
      id: `draft:${catalog.id}`,
      label: catalog.label,
      cycle: catalog.cycle as Cycle,
      group: "draft" as const,
      variant: catalog.variant,
      setupPath: catalog.id,
    }];
  });
}

function normalizePlacement(value: unknown, setupId: string, index: number): TargetPlacement | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isPiece(record.piece) || !Array.isArray(record.cells)) return null;
  const cells = record.cells.flatMap((cell) => {
    if (!cell || typeof cell !== "object") return [];
    const { x, y } = cell as { x?: unknown; y?: unknown };
    return Number.isInteger(x) && Number.isInteger(y) ? [{ x: x as number, y: y as number }] : [];
  });
  if (cells.length !== 4) return null;
  return {
    id: typeof record.id === "string" && record.id ? record.id : `${setupId}-p${index}`,
    piece: record.piece,
    cells,
  };
}

export function normalizeSetupTestCatalog(raw: unknown, descriptor: SetupTestCatalogDescriptor): SetupVariant[] {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { records?: unknown }).records)
      ? (raw as { records: unknown[] }).records
      : [];
  const normalized = values.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id ? record.id : `${descriptor.id}-${index}`;
    if (!Array.isArray(record.placements)) return [];
    const placements = record.placements.map((placement, placementIndex) =>
      normalizePlacement(placement, id, placementIndex));
    if (placements.some((placement) => placement === null) || placements.length < 1 || placements.length > 8) return [];
    const validPlacements = placements as TargetPlacement[];
    const signature = Array.isArray(record.pieceSignature) && record.pieceSignature.every(isPiece)
      ? record.pieceSignature as Piece[]
      : validPlacements.map(({ piece }) => piece);
    if (signature.length !== validPlacements.length) return [];
    const difficulty = typeof record.difficulty === "number"
      && Number.isInteger(record.difficulty)
      && record.difficulty >= 1
      && record.difficulty <= 5
      ? record.difficulty as 1 | 2 | 3 | 4 | 5
      : 3;
    const setup: SetupVariant = {
      id,
      cycle: descriptor.cycle,
      family: typeof record.family === "string" ? record.family : descriptor.label.replace(/-setups\.json$/i, ""),
      displayName: typeof record.displayName === "string"
        ? record.displayName
        : typeof record.name === "string" ? record.name : id,
      pieceSignature: signature,
      placements: validPlacements,
      difficulty,
      reviewStatus: record.reviewStatus === "reviewed" ? "reviewed" : "draft",
    };
    if (record.geometryKind === "solution-shadow") setup.geometryKind = "solution-shadow";
    if (typeof record.formLabel === "string") setup.formLabel = record.formLabel;
    if (record.side === "left" || record.side === "right" || record.side === "neutral") setup.side = record.side;
    if (typeof record.recommendationGroup === "string") setup.recommendationGroup = record.recommendationGroup;
    if (Array.isArray(record.equivalentPlacementVariants)) {
      setup.equivalentPlacementVariants = record.equivalentPlacementVariants.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const variant = value as Record<string, unknown>;
        if (typeof variant.id !== "string" || !Array.isArray(variant.translations)) return [];
        const translations = variant.translations.flatMap((translation) => {
          if (!translation || typeof translation !== "object") return [];
          const item = translation as Record<string, unknown>;
          return typeof item.placementId === "string"
            && Number.isInteger(item.dx)
            && Number.isInteger(item.dy)
            ? [{ placementId: item.placementId, dx: item.dx as number, dy: item.dy as number }]
            : [];
        });
        return translations.length === variant.translations.length
          ? [{ id: variant.id, translations }]
          : [];
      });
    }
    if (typeof record.fumen === "string") setup.fumen = record.fumen;
    if (typeof record.mirrorOf === "string") setup.mirrorOf = record.mirrorOf;
    if (typeof record.mirroredVariantId === "string") setup.mirroredVariantId = record.mirroredVariantId;
    if (typeof record.solveRate === "number") setup.solveRate = record.solveRate;
    if (typeof record.mirroredSolveRate === "number") setup.mirroredSolveRate = record.mirroredSolveRate;
    if (typeof record.saves === "number") setup.saves = record.saves;
    if (typeof record.bestsave === "boolean") setup.bestsave = record.bestsave;
    if (typeof record.runtimeEligible === "boolean") setup.runtimeEligible = record.runtimeEligible;
    if (record.saveMetricKind === "percentage" || record.saveMetricKind === "project-priority") {
      setup.saveMetricKind = record.saveMetricKind;
    }
    if (typeof record.priority === "number") setup.priority = record.priority;
    return [setup];
  });
  const seenIds = new Set<string>();
  return normalized.filter(({ id }) => {
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
}

async function loadPromoted(descriptor: SetupTestCatalogDescriptor): Promise<{ catalog: unknown; policy: unknown }> {
  const setupLoader = promotedSetupLoaders[`../../setups/${descriptor.setupPath}`];
  if (!setupLoader) throw new Error(`Promoted catalog is unavailable: ${descriptor.label}`);
  const policyLoader = descriptor.policyPath
    ? promotedPolicyLoaders[`../../setups/${descriptor.policyPath}`]
    : undefined;
  const [catalogText, policyText] = await Promise.all([setupLoader(), policyLoader?.() ?? null]);
  return {
    catalog: JSON.parse(catalogText),
    policy: policyText ? JSON.parse(policyText) : null,
  };
}

async function loadDraft(descriptor: SetupTestCatalogDescriptor): Promise<{ catalog: unknown; policy: unknown }> {
  const parameters = new URLSearchParams({ id: descriptor.setupPath });
  const response = await fetch(`/__setup_test/draft?${parameters}`, { headers: { accept: "application/json" } });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`Draft catalog is unavailable: ${descriptor.label}`);
  }
  return response.json() as Promise<{ catalog: unknown; policy: unknown }>;
}

export async function loadSetupTestCatalog(
  descriptor: SetupTestCatalogDescriptor,
): Promise<SetupTestCatalogBundle> {
  const loaded = descriptor.group === "promoted"
    ? await loadPromoted(descriptor)
    : await loadDraft(descriptor);
  const normalized = normalizeSetupTestCatalog(loaded.catalog, descriptor);
  if (descriptor.cycle === 7 && descriptor.setupPath.includes("2plus2")) {
    // This family already stores its approved mirror/congruent physical forms.
    return { catalog: normalized, policy: loaded.policy };
  }
  let withMetrics = normalized;
  if (loaded.policy && typeof loaded.policy === "object") {
    try { withMetrics = applyStructuredPolicyMetrics(normalized, loaded.policy as StructuredSetupPolicy); }
    catch { /* An incomplete draft policy must not hide otherwise testable geometry. */ }
  }
  const initialSetups = withMetrics.filter((setup) => !isSolutionShadowSetup(setup));
  const solutionShadows = withMetrics.filter(isSolutionShadowSetup);
  return {
    catalog: [
      ...expandBoxSetups(expandMirroredSetups(expandEquivalentPlacementVariants(initialSetups))),
      ...expandMirroredSetups(solutionShadows),
    ],
    policy: loaded.policy,
  };
}
