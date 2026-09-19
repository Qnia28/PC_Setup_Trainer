import { createBoard } from "../engine/board";
import type { Cycle, Piece } from "../engine/types";
import type { SetupCandidate, SetupQuery } from "../setups/query";
import type { SetupVariant } from "../setups/schema";
import { groupLogicalSetups, logicalSetupGroupKey } from "../setups/logicalGrouping";
export { percent } from "../site/setupMetricDisplay";

export type DictionaryPc = Cycle | 8;
export interface DictionaryGroup {
  key: string;
  title: string;
  entries: DictionaryEntry[];
  formCount: number;
}

/** Presentation grouping only: each child's conditions and physical forms stay intact. */
export function groupDictionaryEntries(entries: DictionaryEntry[]): DictionaryGroup[] {
  const groups = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    const key = `${entry.dataCycle}:${entry.kind}:${entry.planId ?? logicalSetupGroupKey(entry.forms[0]!)}`;
    const children = groups.get(key) ?? [];
    children.push(entry); groups.set(key, children);
  }
  return [...groups].map(([key, children]) => {
    const forms = children.flatMap(entry => entry.forms);
    const logical = groupLogicalSetups(forms);
    return { key, title: logical.length === 1 ? logical[0]!.displayName : children[0]!.title,
      entries: children, formCount: forms.length };
  });
}

function compareRateDescending(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right - left;
}

/** Sort cards by the physical form whose rates are shown on each collapsed card. */
export function sortDictionaryGroupsByRates(groups: readonly DictionaryGroup[]): DictionaryGroup[] {
  return [...groups].sort((left, right) => {
    const a = left.entries[0]!.forms[0]!;
    const b = right.entries[0]!.forms[0]!;
    return compareRateDescending(a.solveRate, b.solveRate)
      || compareRateDescending(a.nextPcGPercent, b.nextPcGPercent)
      || compareRateDescending(a.nextPcTPercent, b.nextPcTPercent);
  });
}

export interface DictionaryBranch {
  condition: string;
  forms: SetupVariant[];
  note?: string;
  children?: DictionaryBranch[];
}
export interface DictionaryEntry {
  key: string;
  title: string;
  source: string;
  dataCycle: number;
  kind: "General" | "QB" | "OQB";
  forms: SetupVariant[];
  conditions: string[];
  branches: DictionaryBranch[];
  observation?: string;
  planId?: string;
  bestsave?: boolean | null;
  goodSavePercent?: number;
  referenceForm?: SetupVariant;
  searchCondition?: string;
}

export function normalizeQueue(value: string): string { return value.toUpperCase().replace(/\s/g, ""); }
export function dictionaryQuery(pc: DictionaryPc, value: string): SetupQuery {
  const queue = normalizeQueue(value);
  if (!/^[TILJOSZ]{7}$/.test(queue)) throw new Error("Enter 7 pieces: HOLD + ACTIVE + NEXT 5 (T I L J O S Z).");
  const cycle = pc === 8 ? 1 : pc;
  return { cycle, board: createBoard(), hold: queue[0] as Piece, active: queue[1] as Piece,
    next: [...queue.slice(2)] as Piece[], holdAvailable: true,
    maxCandidates: Number.MAX_SAFE_INTEGER, includeAllForms: true, includePendingOqb: true };
}

export function canonicalId(setup: SetupVariant): string {
  return (setup.policySourceId ?? setup.id).split("--box-")[0]!.replace(/--mirror$/, "");
}
export function bestsaveLabel(value: boolean | null | undefined): string {
  return value === true ? "Yes" : value === false ? "No" : "—";
}

/** Search uses the production policy result, never a second loose geometry filter. */
export function searchedEntries(entries: DictionaryEntry[], candidates: SetupCandidate[]): DictionaryEntry[] {
  const result = new Map<string, DictionaryEntry>();
  for (const candidate of candidates) {
    const id = canonicalId(candidate.setup);
    const matches = entries.filter(entry => entry.forms.some(form => canonicalId(form) === id));
    // PC# 8 shares the runtime cycle with PC# 1, but not its dictionary page.
    if (!matches.length) continue;
    const exact = matches.filter(entry => entry.planId && candidate.policy?.ruleId?.replace(/--mirror$/, "") === entry.planId.replace(/--mirror$/, ""));
    const entry = exact[0] ?? matches.find(entry => !entry.planId);
    // A valid runtime-derived form may not be a standalone source record.
    const key = entry?.key ?? `${candidate.setup.cycle}:${id}:${candidate.policy?.ruleId ?? ""}`;
    const existing = result.get(key);
    if (existing) {
      if (!existing.forms.some(form => form.id === candidate.setup.id)) existing.forms.push(candidate.setup);
      continue;
    }
    result.set(key, { ...(entry ?? {
      key, title: candidate.setup.displayName, source: "Runtime setups", dataCycle: candidate.setup.cycle,
      kind: candidate.qbCondition ? "QB" : "General", conditions: [], branches: [],
    }), forms: [candidate.setup], title: candidate.setup.displayName,
      referenceForm: entry?.forms[0],
      searchCondition: candidate.recommendationLabel,
      bestsave: candidate.setup.bestsave ?? entry?.bestsave,
      goodSavePercent: candidate.goodSavePercent ?? entry?.goodSavePercent,
    });
  }
  return [...result.values()];
}
