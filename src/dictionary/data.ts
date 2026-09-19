import manifest from "../../setups/catalog-manifest.json";
import { applyStructuredPolicyMetrics, type PolicyCondition, type StructuredSetupPolicy } from "../setups/policy";
import { mirrorSetup } from "../setups/mirror";
import { normalizeSelectedCycle5AdvancedPolicy } from "../setups/selectedCycle5AdvancedPolicyAdapter";
import type { Cycle5AdvancedOqbObservation, Cycle5AdvancedQueuePattern, Cycle5AdvancedPostCheckpoint } from "../setups/cycle5AdvancedPolicy";
import type { SetupVariant } from "../setups/schema";
import type { DictionaryBranch, DictionaryEntry } from "./model";
import { canonicalId } from "./model";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const number = (value: unknown): number | undefined => typeof value === "number" ? value : undefined;
const bool = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;

export interface DictionarySource { setups: string; policy?: string; cycle: number; qb: boolean }
export function dictionarySources(value: unknown): DictionarySource[] {
  const result: DictionarySource[] = [];
  function visit(value: unknown, cycle: number, active: boolean, qb: boolean) {
    const node = record(value);
    const enabled = active && node.runtimeEnabled !== false && node.conditionCompilerReady !== false;
    if (!enabled) return;
    if (typeof node.setups === "string") result.push({ setups: node.setups,
      policy: typeof node.policy === "string" ? node.policy : undefined, cycle,
      qb: qb || node.setups.startsWith("QB/") });
    for (const [key, child] of Object.entries(node)) {
      if (Array.isArray(child)) child.forEach(item => visit(item, cycle, enabled, qb));
      else if (child && typeof child === "object") visit(child, cycle, enabled, qb || key.startsWith("qb") || key === "advanced");
    }
  }
  for (const [cycle, node] of Object.entries(record(record(value).cycles))) visit(node, Number(cycle), true, false);
  return result;
}

export function conditionText(condition: PolicyCondition): string {
  const values = condition.values?.join(" / ") ?? "";
  switch (condition.operator) {
    case "prefixIn": return `Prefix: ${values}`;
    case "contains": case "containsAll": return `Contains: ${values}`;
    case "orderBefore": return `Order: ${condition.values?.join(" → ")}`;
    case "allOf": return (condition.conditions ?? []).map(conditionText).join(" AND ");
    case "anyOf": return (condition.conditions ?? []).map(conditionText).join(" OR ");
    case "not": return condition.condition ? `NOT (${conditionText(condition.condition)})` : "Excluded";
  }
}
function patternText(pattern: Cycle5AdvancedQueuePattern): string {
  const body = (parts: Cycle5AdvancedQueuePattern["parts"]) => parts.map(part =>
    part.kind === "ordered" ? part.symbols.join("") : `[${part.symbols.join("")}]!`).join("");
  return `${pattern.scope === "visible-seven" ? "H+A+N" : "Next bag (5)"}: ${body(pattern.parts)}`
    + (pattern.excludes?.length ? ` (except: ${pattern.excludes.map(exclude => body(exclude.parts)).join(" / ")})` : "");
}
function observationText(observation: Cycle5AdvancedOqbObservation): string {
  if (observation.kind === "relative-order") return `Order: ${observation.pieces.join(" / ")}`;
  if (observation.kind === "hidden-bag-piece") return `Remaining piece: ${observation.knownRemainingBagPieces.join("")} (${observation.visibleCountFromThatSet} visible)`;
  return `${observation.uiSlot ?? "New NEXT"}`;
}

/** Converts only explicitly linked branches; never guesses from similar fields. */
export function projectDictionarySource(source: DictionarySource, rawSetups: unknown, rawPolicy: unknown): DictionaryEntry[] {
  const policy = record(rawPolicy);
  if (!Array.isArray(rawSetups)) throw new Error(`Unable to read setups: ${source.setups}`);
  let setups = (rawSetups as SetupVariant[]).filter(setup => setup.reviewStatus === "reviewed");
  if (Array.isArray(policy.metrics) && Array.isArray(policy.selectionRules)) {
    const runtimeEntries = records(record(policy.runtimePolicy).entries);
    const sourceClass = new Map(runtimeEntries.map(entry => [entry.setupId, entry.sourceClass]));
    // Directional metrics must not let the last (mirrored) record overwrite the source rate.
    const metrics = records(policy.metrics).filter(metric => metric.direction === undefined || metric.direction === sourceClass.get(metric.setupId));
    setups = applyStructuredPolicyMetrics(setups, { ...policy, metrics,
      rankingHints: Array.isArray(policy.rankingHints) ? policy.rankingHints : [],
    } as unknown as StructuredSetupPolicy);
  }
  const byId = new Map(setups.map(setup => [setup.id, setup]));
  const formsFor = (ids: string[]) => ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const refForms = (refs: Array<{ setupId: string; transform?: string }>) => refs.flatMap(ref => {
    const setup = byId.get(ref.setupId);
    return setup ? [ref.transform === "mirror-x" ? mirrorSetup(setup) : setup] : [];
  });
  const result: DictionaryEntry[] = [];
  const covered = new Set<string>();
  const add = (id: string, forms: SetupVariant[], extra: Partial<DictionaryEntry> = {}) => {
    if (!forms.length) return;
    forms.forEach(setup => covered.add(setup.policySourceId ?? setup.id.replace(/--mirror$/, "")));
    result.push({ key: `${source.setups}:${id}`, title: forms[0]!.displayName,
      source: source.setups.replace(/^QB\//, "").replace(/-setups\.json$/, ""), dataCycle: source.cycle,
      kind: source.qb ? "QB" : "General", forms, conditions: [], branches: [], ...extra });
  };

  if (source.cycle === 5 && source.qb) {
    const bundle = normalizeSelectedCycle5AdvancedPolicy(rawPolicy, source.setups);
    function postBranches(post: Cycle5AdvancedPostCheckpoint): DictionaryBranch[] {
      return post.branches.map(branch => ({
        condition: `${observationText(post.observation)} · ${branch.fallback ? "Otherwise" : branch.observedPieces?.join(" / ") ?? "Match"}`,
        forms: refForms(branch.continuationSetupRefs ?? []),
        note: branch.action ? `Add ${branch.action.piece} → ${branch.action.resultingPieceCount}P` : undefined,
        ...(branch.action ? { forms: [{ id: "action", cycle: 5, family: "action", displayName: `${branch.action.piece} placement`,
          pieceSignature: [branch.action.piece], placements: [{ id: "action", piece: branch.action.piece, cells: branch.action.cells }],
          difficulty: 1, reviewStatus: "reviewed" } as SetupVariant] } : {}),
      }));
    }
    for (const entry of bundle.entries) {
      if (entry.kind === "direct") {
        add(entry.id, refForms(entry.alternatives.flatMap(alternative => alternative.setupRefs)), {
          planId: entry.id, bestsave: entry.bestsave, conditions: entry.alternatives.map(alternative => patternText(alternative.pattern)),
        });
      } else {
        add(entry.id, refForms(entry.preconditionSetupId ? [{ setupId: entry.preconditionSetupId, transform: entry.preconditionTransform }] : []), {
          kind: "OQB", planId: entry.id, bestsave: entry.bestsave,
          conditions: entry.initialPatterns.map(patternText),
          observation: `After ${entry.checkpoint.placedCount}P: ${observationText(entry.observation)}`,
          branches: entry.branches.map(branch => ({
            condition: branch.relativeOrder ? `${branch.relativeOrder.before} → ${branch.relativeOrder.after}` : branch.observedPieces?.join(" / ") ?? "Match",
            forms: refForms(branch.continuationSetupRefs), note: branch.terminal ? "Solve PC from this field" : undefined,
            children: branch.postCheckpoint ? postBranches(branch.postCheckpoint) : undefined,
          })),
        });
      }
    }
  }

  for (const rule of records(policy.selectionRules)) {
    const preconditions = strings(rule.preconditionSetupIds);
    if (!preconditions.length) continue;
    const branches = records(rule.branches).map(branch => ({ condition: conditionText(branch.when as unknown as PolicyCondition),
      forms: formsFor(strings(branch.continuationSetupIds)),
      note: branch.stagedAction === "solve-from-precondition" ? "Solve PC from this field" : undefined }));
    if (rule.default) { const branch = record(rule.default); branches.push({ condition: "Otherwise", forms: formsFor(strings(branch.continuationSetupIds)),
      note: branch.stagedAction === "solve-from-precondition" ? "Solve PC from this field" : undefined }); }
    add(String(rule.id), formsFor(preconditions), { kind: "OQB", planId: String(rule.id), branches,
      observation: `After setup: next bag (${record(rule.observation).length ?? ""})` });
  }

  const runtime = record(policy.runtimePolicy);
  for (const entry of records(runtime.directQb)) {
    const window = record(entry.initialWindow);
    add(String(entry.id), formsFor(strings(entry.setupIds)), { kind: "QB", planId: String(entry.id),
      conditions: [`HOLD ${window.hold} · [${strings(window.activeNextPermutation).join("")}]!${window.followingPiece ?? ""}`,
        ...(entry.postBuildHold ? [`Hold after setup: ${entry.postBuildHold}`] : [])] });
  }
  for (const plan of records(runtime.oqbPlans)) {
    const window = record(plan.initialWindow);
    const observation = record(plan.observation);
    add(String(plan.id), formsFor([String(plan.preconditionSetupId)]), { kind: "OQB", planId: String(plan.id),
      conditions: [`HOLD ${window.hold} · [${strings(window.activeNextPermutation).join("")}]!${window.followingPiece ?? ""}`],
      observation: `After ${record(plan.checkpoint).placedCount}P: ${observation.kind === "post-build-next-slot" ? `NEXT[${observation.index}]` : "H+A+N"}`,
      branches: records(plan.branches).map(branch => ({
        condition: typeof branch.observedPiece === "string" ? branch.observedPiece : branch.fallback ? "Otherwise" : branch.predicateKind === "to-iz-xyo" ? "[H,A]=[TO] · NEXT=[IZ]!XYO (X≠Y, X/Y≠O)" : branch.predicateKind === "ti-oz-sio" ? "H=T · A=I · NEXT=[OZ]!SIO" : branch.predicateKind === "tz-oi-iox" ? "H=T · A=Z · NEXT=[OI]!IOX (X≠I/O)" : "Observation",
        forms: formsFor(strings(branch.continuationSetupIds)), note: branch.action === "solve-from-precondition" ? "Solve PC from this field" : undefined,
      })),
    });
  }

  // Cycle 1 direct QB uses ordered last-two branches, not generic selectionRules.
  for (const entry of records(policy.entries).filter(entry => Array.isArray(entry.candidateGroups))) {
    const groups = entry.candidateGroups as unknown[][];
    const refs = groups.flat().map(record);
    for (const ref of refs) {
      const setup = refForms([{ setupId: String(ref.setupId), transform: typeof ref.transform === "string" ? ref.transform : undefined }]);
      add(`${entry.id}:${ref.setupId}`, setup.map(form => ({ ...form, solveRate: number(ref.solveRate) ?? form.solveRate })), {
        kind: "QB", planId: String(entry.id), conditions: [`Last two pieces: ${strings(entry.orderedLastTwo).join(" → ")}`],
      });
    }
  }

  const groups = new Map<string, SetupVariant[]>();
  for (const setup of setups) {
    if (covered.has(setup.id) || setup.geometryKind === "solution-shadow" || setup.runtimeEligible === false) continue;
    const key = setup.recommendationGroup ?? setup.id;
    const group = groups.get(key) ?? []; group.push(setup); groups.set(key, group);
  }
  for (const [key, forms] of groups) {
    const ids = new Set(forms.map(form => form.id));
    const entries = records(policy.entries).filter(entry => entry.runtimeEnabled !== false && (ids.has(String(entry.setupId)) || strings(entry.candidateSetupIds).some(id => ids.has(id))));
    const conditions = entries.flatMap(entry => {
      if (typeof entry.conditionLabel === "string") {
        const runtimeCondition = record(entry.runtimeCondition);
        return [entry.conditionLabel,
          ...(entry.sourcePool ? [`Current bag: ${entry.sourcePool}`] : []),
          ...(runtimeCondition.includeNextBagPatterns ? [`Next bag: ${strings(runtimeCondition.includeNextBagPatterns).join(" / ")}`] : []),
          ...(runtimeCondition.nextBagOrderBefore ? [`Next bag order: ${strings(runtimeCondition.nextBagOrderBefore).join(" → ")}`] : []),
          ...(runtimeCondition.buildOrderBefore ? [`Build order: ${strings(runtimeCondition.buildOrderBefore).join(" → ")}`] : [])];
      }
      if (entry.previousBagPieces && entry.nextBagPrefixPieces) return [`Current [${strings(entry.previousBagPieces).join("")}] · Next [${strings(entry.nextBagPrefixPieces).join("")}]`];
      return [];
    });
    add(key, forms, { conditions, bestsave: forms[0]?.bestsave ?? bool(entries[0]?.bestsave),
      goodSavePercent: number(entries[0]?.goodSavePercent) });
  }
  return result;
}

// Never recurse into ignored review, source, or generated audit workspaces.
const loaders = import.meta.glob([
  "../../setups/*-setups.json", "../../setups/*-policy.json",
  "../../setups/QB/*-setups.json", "../../setups/QB/*-policy.json",
], { import: "default" });
const cache = new Map<number, Promise<DictionaryEntry[]>>();
export function loadDictionary(cycle: number): Promise<DictionaryEntry[]> {
  const cached = cache.get(cycle); if (cached) return cached;
  const sources = dictionarySources(manifest).filter(source => source.cycle === cycle);
  async function load(path: string): Promise<unknown> {
    const loader = loaders[`../../setups/${path}`];
    if (!loader) throw new Error(`Public data file not found: ${path}`);
    return loader();
  }
  const pending = Promise.all(sources.map(async source => {
    const [setups, policy] = await Promise.all([load(source.setups), source.policy ? load(source.policy) : Promise.resolve({})]);
    return projectDictionarySource(source, setups, policy);
  })).then(async groups => {
    const { setupCatalog } = await import("../setups/catalog");
    const physical = new Map<string, SetupVariant[]>();
    for (const form of setupCatalog) {
      const id = canonicalId(form), forms = physical.get(id) ?? [];
      forms.push(form); physical.set(id, forms);
    }
    return groups.flat().map(entry => {
      if (entry.kind !== "General") return entry;
      const forms = new Map<string, SetupVariant>();
      for (const source of entry.forms) for (const form of physical.get(source.id) ?? [source]) forms.set(form.id, form);
      return { ...entry, forms: [...forms.values()] };
    });
  }).catch(error => { cache.delete(cycle); throw error; });
  cache.set(cycle, pending);
  return pending;
}
