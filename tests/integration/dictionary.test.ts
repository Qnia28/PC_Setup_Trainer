import { describe, expect, it } from "vitest";
import { loadDictionary } from "../../src/dictionary/data";
import { dictionaryQuery, groupDictionaryEntries, searchedEntries, type DictionaryPc } from "../../src/dictionary/model";
import { queryCatalog, querySetups } from "../../src/setups/query";
import { queryCatalogCooperative } from "../../src/setups/query";
import type { Cycle } from "../../src/engine/types";
import type { SetupVariant } from "../../src/setups/schema";
import { dictionaryLabel } from "../../src/dictionary/labels";

describe("dictionary production integration", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8] as DictionaryPc[])("loads the public cycle %i without review-server endpoints", async cycle => {
    const entries = await loadDictionary(cycle);
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map(entry => entry.key)).size).toBe(entries.length);
    expect(entries.every(entry => entry.forms.length > 0)).toBe(true);
    expect(entries.every(entry => entry.dataCycle === cycle)).toBe(true);
    if (cycle === 3) expect(entries.flatMap(entry => entry.forms)
      .some(form => form.nextPcGPercent !== undefined && form.nextPcTPercent !== undefined)).toBe(true);
    const labels: string[] = [];
    function collect(value: unknown) {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (["title", "displayName", "formLabel", "condition", "note", "observation"].includes(key) && typeof child === "string") labels.push(child);
        else if (key === "conditions" && Array.isArray(child)) labels.push(...child);
        else if (typeof child === "object") collect(child);
      }
    }
    collect(entries);
    expect(labels.filter(label => /[가-힣]/.test(dictionaryLabel(label)))).toEqual([]);
    if (cycle === 5 || cycle === 3 || cycle === 8) expect(entries.some(entry => entry.kind === "OQB" && entry.branches.length)).toBe(true);
  });
  it.each([[1, "TOILJSZ"], [4, "JOSTZIL"], [5, "TOILJSZ"]] as const)("retains production matches with no UI count cap: %i/%s", async (cycle, queue) => {
    const query = dictionaryQuery(cycle, queue);
    const candidates = querySetups(query);
    const normal = querySetups({ ...query, maxCandidates: undefined, includeAllForms: undefined, includePendingOqb: undefined });
    const dictionary = searchedEntries(await loadDictionary(cycle), candidates);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of normal) expect(candidates.some(found => found.setup.id === candidate.setup.id)).toBe(true);
    expect(dictionary.length).toBeGreaterThan(0);
    expect(dictionary.flatMap(entry => entry.forms).every(form => candidates.some(candidate => candidate.setup.id === form.id))).toBe(true);
  });
  it("keeps seven-piece OQB searches pending and attaches the authoritative continuation diagrams", async () => {
    for (const [cycle, queue, ruleId] of [
      [5, "ILZTIOL", "ilij5-advanced-oqb-tiz-olj"],
      [8, "TTJZLOI", "cycle8-tx-tjz-l-oqb"],
    ] as const) {
      const candidates = querySetups(dictionaryQuery(cycle, queue));
      const candidate = candidates.find(candidate => candidate.policy?.ruleId === ruleId);
      expect(candidate, queue).toBeDefined();
      expect(candidate!.policy?.branchId).toBe("precondition");
      const entries = searchedEntries(await loadDictionary(cycle), candidates);
      const entry = entries.find(entry => entry.planId === ruleId);
      expect(entry?.kind).toBe("OQB");
      expect(entry?.branches.some(branch => branch.forms.length > 0)).toBe(true);
    }
  });
  it("uses one review-style PCO + Heart parent containing every matching physical form", async () => {
    const entries = await loadDictionary(2);
    const hearts = entries.filter(entry => entry.forms[0]?.family === "pco-heart");
    expect(hearts.length).toBeGreaterThan(1);
    const groups = groupDictionaryEntries(hearts);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe("PCO + Heart");
    expect(groups[0]!.formCount).toBe(hearts.reduce((count, entry) => count + entry.forms.length, 0));
  });
  it("keeps runtime PC# 8 matches out of the PC# 1 dictionary", async () => {
    const candidates = querySetups(dictionaryQuery(8, "TTJZLOI"));
    const one = searchedEntries(await loadDictionary(1), candidates);
    const eight = searchedEntries(await loadDictionary(8), candidates);
    expect(one.every(entry => entry.dataCycle === 1)).toBe(true);
    expect(eight.length).toBeGreaterThan(0);
    expect(eight.every(entry => entry.dataCycle === 8)).toBe(true);
    expect(one.some(entry => entry.planId === "cycle8-tx-tjz-l-oqb")).toBe(false);
  });
  it("keeps physical alternatives in synchronous and Worker search without changing normal grouping", async () => {
    const make = (id: string, x: number): SetupVariant => ({ id, cycle: 1, family: "test", recommendationGroup: "same", displayName: id,
      pieceSignature: ["O"], placements: [{ id, piece: "O", cells: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x, y: 1 }, { x: x + 1, y: 1 }] }], difficulty: 1, reviewStatus: "reviewed" });
    const catalog = [make("left", 0), make("right", 8)];
    const query = dictionaryQuery(1, "TOILJSZ");
    expect(queryCatalog(catalog, { ...query, includeAllForms: false })).toHaveLength(1);
    expect(queryCatalog(catalog, query)).toHaveLength(2);
    expect(await queryCatalogCooperative(catalog, query, { onNode() {} })).toHaveLength(2);
  });
});
