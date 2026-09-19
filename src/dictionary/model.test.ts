import { describe, expect, it } from "vitest";
import { bestsaveLabel, dictionaryQuery, groupDictionaryEntries, percent, searchedEntries, sortDictionaryGroupsByRates,
  type DictionaryEntry, type DictionaryGroup } from "./model";
import type { SetupVariant } from "../setups/schema";
import type { SetupCandidate } from "../setups/query";

const setup: SetupVariant = { id: "source", cycle: 5, family: "family", displayName: "Test", pieceSignature: ["O"],
  placements: [{ id: "o", piece: "O", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }], difficulty: 1, reviewStatus: "reviewed" };
describe("dictionary input and projection", () => {
  it("uses exactly H+A+five NEXT, permits bag-boundary duplicates and removes whitespace", () => {
    const query = dictionaryQuery(5, " t o i l j s t ");
    expect(query).toMatchObject({ cycle: 5, hold: "T", active: "O", next: ["I", "L", "J", "S", "T"], includeAllForms: true, maxCandidates: Number.MAX_SAFE_INTEGER });
    expect(query.board.flat().every(cell => cell === null)).toBe(true);
  });
  it.each(["", "TOILJS", "TOILJSZZ", "TOILJSX", "TOILJS*"])("rejects invalid queue %s", queue => {
    expect(() => dictionaryQuery(1, queue)).toThrow("7 pieces");
  });
  it("does not turn an unknown metric or Bestsave into zero/false", () => {
    expect(percent(undefined)).toBe("—"); expect(percent(0)).toBe("0%");
    expect(bestsaveLabel(undefined)).toBe("—"); expect(bestsaveLabel(null)).toBe("—");
    expect(bestsaveLabel(false)).toBe("No"); expect(bestsaveLabel(true)).toBe("Yes");
  });
  it("keeps plan identity for a shared OQB precondition, including a mirrored plan", () => {
    const entries: DictionaryEntry[] = ["a", "b"].map(planId => ({ key: planId, title: planId, source: "source", dataCycle: 5,
      kind: "OQB", forms: [setup], conditions: [], branches: [{ condition: planId, forms: [setup] }], planId }));
    const candidate: SetupCandidate = { setup: { ...setup, id: "source--mirror", solveRate: 75 }, score: [], reasons: [],
      plan: { steps: [], holds: 0 }, policy: { ruleId: "b--mirror", branchId: "precondition", preferred: true } };
    const result = searchedEntries(entries, [candidate]);
    expect(result).toHaveLength(1); expect(result[0]?.key).toBe("b");
    expect(result[0]?.branches[0]?.condition).toBe("b");
    expect(result[0]?.forms[0]?.solveRate).toBe(75);
    expect(result[0]?.referenceForm).toBe(setup);
    expect(searchedEntries(entries, [])).toEqual([]);
    expect(searchedEntries([], [candidate])).toEqual([]);
    expect(groupDictionaryEntries(entries)).toHaveLength(2);
  });
  it("groups composition forms without losing per-form metrics or merging PC numbers", () => {
    const entries: DictionaryEntry[] = ["TOIL", "TILS"].map((pieces, i) => ({ key: pieces, title: `PCO + Heart (${pieces})`,
      source: "source", dataCycle: 2, kind: "General", forms: [{ ...setup, id: pieces, cycle: 2, family: "pco-heart",
        displayName: `PCO + Heart (${pieces})`, solveRate: 90 + i }], conditions: [], branches: [] }));
    const groups = groupDictionaryEntries(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: "PCO + Heart", formCount: 2 });
    expect(groups[0]!.entries.flatMap(entry => entry.forms.map(form => form.solveRate))).toEqual([90, 91]);
    expect(groupDictionaryEntries([...entries, { ...entries[0]!, dataCycle: 8 }])).toHaveLength(2);
    expect(dictionaryQuery(8, "TTJZLOI").cycle).toBe(1);
  });
  it("sorts displayed cards by PC%, then Good%, then T%, with unknowns last", () => {
    const group = (key: string, solveRate?: number, nextPcGPercent?: number, nextPcTPercent?: number): DictionaryGroup => ({
      key, title: key, formCount: 1,
      entries: [{ key, title: key, source: "source", dataCycle: 3, kind: "General", conditions: [], branches: [],
        forms: [{ ...setup, id: key, cycle: 3, solveRate, nextPcGPercent, nextPcTPercent }] }],
    });
    const groups = [group("unknown", undefined, 100, 100), group("low-pc", 80, 100, 100),
      group("low-good", 90, 70, 99), group("low-t", 90, 80, 70), group("high-t", 90, 80, 90),
      group("same-rates", 90, 80, 90), group("high-pc", 100, 0, 0), group("unknown-good", 90, undefined, 100)];
    expect(sortDictionaryGroupsByRates(groups).map(({ key }) => key)).toEqual([
      "high-pc", "high-t", "same-rates", "low-t", "low-good", "unknown-good", "low-pc", "unknown",
    ]);
    expect(groups[0]?.key).toBe("unknown");
  });
});
