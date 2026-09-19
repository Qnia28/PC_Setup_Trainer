import { describe, expect, it } from "vitest";
import { loadDictionary } from "../../src/dictionary/data";
import { parseDictionarySearch } from "../../src/dictionary/searchInput";
import { searchDictionaryClass } from "../../src/dictionary/classSearch";
import { canonicalId, groupDictionaryEntries, type DictionaryPc } from "../../src/dictionary/model";
import { setupsForCycle4Class, setupsForCycle6Class } from "../../src/setups/catalog";
import { mirrorSetup } from "../../src/setups/mirror";

async function search(pc: DictionaryPc, value: string) {
  const input = parseDictionarySearch(pc, value);
  if (input.kind !== "class") throw new Error("Expected class input");
  return searchDictionaryClass(await loadDictionary(pc), input);
}
const formIds = (entries: Awaited<ReturnType<typeof search>>) => entries.flatMap(entry => entry.forms.map(form => form.id)).sort();

describe("dictionary class filtering", () => {
  it.each([[2, "TIOS"], [5, "TO"], [6, "TOILSZ"], [4, "NO IJ"], [6, "-I"]] as const)("finds PC# %i / %s without inventing queue order", async (pc, value) => {
    const entries = await search(pc, value);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.dataCycle === pc)).toBe(true);
    expect(groupDictionaryEntries(entries).length).toBeGreaterThan(0);
  });
  it("treats class permutations equally and retains QB conditions", async () => {
    const entries = await search(2, "TIOS");
    expect(formIds(await search(2, "SOIT"))).toEqual(formIds(entries));
    expect(entries.some(entry => entry.kind === "QB" && entry.conditions.length > 0)).toBe(true);
    expect(entries.flatMap(entry => entry.forms).every(form => form.pieceSignature.every(piece => "TIOS".includes(piece)))).toBe(true);
  });
  it("selects the exact mirrored No IJ class, not every shape lacking I/J", async () => {
    const entries = await search(4, "NO IJ");
    expect(formIds(await search(4, "-JI"))).toEqual(formIds(entries));
    expect(formIds(await search(4, "TOLSZ"))).toEqual(formIds(entries));
    const allowed = new Set(setupsForCycle4Class(["I", "J"]).map(form => form.id));
    expect(entries.flatMap(entry => entry.forms).every(form => allowed.has(form.id))).toBe(true);
    expect(formIds(await search(4, "NO IL"))).not.toEqual(formIds(entries));
  });
  it("matches No I to its six-piece pool and excludes inactive QB", async () => {
    const entries = await search(6, "NO I");
    expect(formIds(await search(6, "-I"))).toEqual(formIds(entries));
    expect(formIds(await search(6, "TOLJSZ"))).toEqual(formIds(entries));
    const allowed = new Set(setupsForCycle6Class("I").map(form => form.id));
    expect(entries.flatMap(entry => entry.forms).every(form => allowed.has(form.id))).toBe(true);
    expect(entries.every(entry => entry.kind === "General")).toBe(true);
  });
  it("uses PC# 5 class metadata and preserves unresolved QB conditions", async () => {
    const entries = await search(5, "TO");
    expect(formIds(await search(5, "OT"))).toEqual(formIds(entries));
    expect(entries.every(entry => entry.source === "cycle-5-to" || entry.source === "cycle-5-advanced-to")).toBe(true);
    expect(entries.some(entry => entry.kind === "QB" && entry.conditions.length > 0)).toBe(true);
  });
  it("mirrors PC# 5 class forms without changing stored continuations", async () => {
    const left = await search(5, "IL"), right = await search(5, "IJ");
    const oqb = left.find(entry => entry.kind === "OQB");
    expect(oqb).toBeDefined();
    const mirrored = right.find(entry => entry.key === oqb!.key)!;
    expect(mirrored.forms.map(form => form.id)).toEqual(oqb!.forms.map(form => mirrorSetup(form).id));
    expect(mirrored.branches).toEqual(oqb!.branches);
    expect(canonicalId(mirrored.referenceForm!)).toBe(canonicalId(oqb!.referenceForm!));
  });
});
