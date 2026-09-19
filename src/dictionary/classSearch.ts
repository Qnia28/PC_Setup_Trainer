import { PIECES } from "../engine/types";
import { setupPolicyForCycle, setupsForCycle2General, setupsForCycle2Advanced3P, setupsForCycle3Class,
  setupsForCycle4Class, setupsForCycle5Class, setupsForCycle6Class } from "../setups/catalog";
import { fitsCycle2BuildPool } from "../setups/cycle2Context";
import { cycle2AdvancedQbClass } from "../setups/cycle2AdvancedQb";
import { cycle2AdvancedQbRuntimeBundle } from "../setups/cycle2AdvancedQbCatalog";
import { promotedCycle5AdvancedBundleForPair } from "../setups/cycle5AdvancedCatalog";
import { expandEquivalentPlacementVariants } from "../setups/placementVariants";
import { mirrorSetup } from "../setups/mirror";
import type { SetupVariant } from "../setups/schema";
import { canonicalId, type DictionaryEntry } from "./model";
import type { DictionarySearchInput } from "./searchInput";

/** Catalog membership only. No queue order, future observation, or BFS claim is made. */
export function searchDictionaryClass(entries: DictionaryEntry[], query: Extract<DictionarySearchInput, { kind: "class" }>): DictionaryEntry[] {
  const { pc, pieces } = query;
  const missing = PIECES.filter(piece => !pieces.includes(piece));
  let catalog: SetupVariant[] = [];
  if (pc === 2) catalog = [...setupsForCycle2General(), ...setupsForCycle2Advanced3P()]
    .filter(setup => fitsCycle2BuildPool(setup, pieces, setupPolicyForCycle(2)));
  if (pc === 3) catalog = setupsForCycle3Class(pieces[0]!);
  if (pc === 4) catalog = setupsForCycle4Class(missing);
  if (pc === 5) catalog = setupsForCycle5Class(pieces);
  if (pc === 6) catalog = setupsForCycle6Class(missing[0]!);

  const bySource = new Map<string, SetupVariant[]>();
  for (const setup of catalog) {
    const key = canonicalId(setup), forms = bySource.get(key) ?? [];
    forms.push(setup); bySource.set(key, forms);
  }
  const qb2 = pc === 2 ? cycle2AdvancedQbRuntimeBundle() : null;
  const qb2Class = qb2 ? cycle2AdvancedQbClass(qb2.policy, pieces) : null;
  const qb5 = pc === 5 ? promotedCycle5AdvancedBundleForPair(pieces) : null;
  const qb5Ids = new Set(qb5?.catalog.map(setup => setup.id));
  return entries.filter(entry => entry.dataCycle === pc).flatMap(entry => {
    let forms: SetupVariant[] = [];
    if (pc === 2 && entry.kind === "QB" && qb2 && qb2Class) {
      for (const form of entry.forms) {
        const policy = qb2.policy.entries.find(item => item.setupId === canonicalId(form));
        if (!policy || policy.runtimeEnabled === false || policy.sourcePool !== qb2Class.sourcePool) continue;
        const physical = expandEquivalentPlacementVariants([form]);
        forms.push(...(qb2Class.mirroredClass ? physical.map(mirrorSetup) : physical));
        if (qb2Class.selfMirroredClass && policy.runtimeCondition.automaticMirror !== false) forms.push(...physical.map(mirrorSetup));
      }
    } else if (pc === 5 && entry.kind !== "General") {
      if (qb5 && entry.forms.some(form => qb5Ids.has(canonicalId(form)))) {
        forms = entry.forms.map(form => qb5.runtimeMirror ? mirrorSetup(form) : form);
      }
    } else {
      forms = entry.forms.flatMap(form => bySource.get(canonicalId(form)) ?? []);
    }
    const unique = [...new Map(forms.map(form => [form.id, form])).values()];
    return unique.length ? [{ ...entry, forms: unique, referenceForm: entry.forms[0] }] : [];
  });
}
