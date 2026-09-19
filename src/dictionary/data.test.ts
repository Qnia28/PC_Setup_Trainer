import { describe, expect, it } from "vitest";
import { dictionarySources, projectDictionarySource } from "./data";
import type { SetupVariant } from "../setups/schema";

const shape = (id: string): SetupVariant => ({ id, cycle: 3, family: "test", displayName: id, pieceSignature: ["O"],
  placements: [{ id: "o", piece: "O", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }],
  difficulty: 1, reviewStatus: "reviewed" });
describe("read-only dictionary data", () => {
  it("respects inherited runtime/condition-compiler gates", () => {
    const sources = dictionarySources({ cycles: { 1: { runtimeEnabled: true, setups: "one.json", qb: { runtimeEnabled: false, setups: "hidden.json" } },
      5: { runtimeEnabled: true, classFiles: { a: { setups: "a.json" }, b: { conditionCompilerReady: false, setups: "b.json" } } },
      6: { runtimeEnabled: false, classFiles: { a: { runtimeEnabled: true, setups: "six.json" } } } } });
    expect(sources.map(source => source.setups)).toEqual(["one.json", "a.json"]);
  });
  it("projects explicit staged outcomes including terminal/default without dumping policy", () => {
    const policy = { metrics: [], selectionRules: [{ id: "plan", candidateSetupIds: ["pre"], preconditionSetupIds: ["pre"],
      observation: { kind: "next-bag-prefix", length: 2 },
      branches: [{ id: "yes", when: { operator: "prefixIn", values: ["IO"] }, preferSetupIds: ["next"], continuationSetupIds: ["next"] }],
      default: { preferSetupIds: ["pre"], stagedAction: "solve-from-precondition" }, privateDebug: "secret" }] };
    const entries = projectDictionarySource({ setups: "synthetic.json", cycle: 3, qb: false }, [shape("pre"), { ...shape("next"), geometryKind: "solution-shadow" }], policy);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "OQB", planId: "plan" });
    expect(entries[0]?.branches.map(branch => [branch.forms.length, branch.note])).toEqual([[1, undefined], [0, "Solve PC from this field"]]);
    expect(JSON.stringify(entries)).not.toContain("privateDebug");
  });
  it("does not manufacture continuation links from similar geometry", () => {
    const entries = projectDictionarySource({ setups: "test.json", cycle: 3, qb: false }, [shape("a"), shape("b")], {});
    expect(entries).toHaveLength(2); expect(entries.every(entry => entry.branches.length === 0)).toBe(true);
  });
  it("keeps Good Save separate from PC% and excludes drafts", () => {
    const entries = projectDictionarySource({ setups: "test.json", cycle: 7, qb: true }, [shape("a"), { ...shape("b"), reviewStatus: "draft" }], {
      entries: [{ candidateSetupIds: ["a"], previousBagPieces: ["T", "I", "I"], nextBagPrefixPieces: ["O", "I"], goodSavePercent: 63.57 }],
    });
    expect(entries).toHaveLength(1); expect(entries[0]?.goodSavePercent).toBe(63.57); expect(entries[0]?.forms[0]?.solveRate).toBeUndefined();
  });
  it("uses the source-direction metric and accepts non-structured ranking metadata", () => {
    const entries = projectDictionarySource({ setups: "test.json", cycle: 8, qb: false }, [shape("a")], {
      rankingHints: { note: "not a structured policy array" }, selectionRules: [],
      metrics: [{ setupId: "a", direction: "T>L", values: { solveRate: 80 } }, { setupId: "a", direction: "T>J", values: { solveRate: 90 } }],
      runtimePolicy: { entries: [{ setupId: "a", sourceClass: "T>L" }] },
    });
    expect(entries[0]?.forms[0]?.solveRate).toBe(80);
  });
  it("projects PC# 3 Good and T rates from the promoted policy", () => {
    const entries = projectDictionarySource({ setups: "test.json", cycle: 3, qb: false }, [shape("a")], {
      metrics: [{ setupId: "a", values: { solveRate: 100, nextPcGPercent: 96.25, nextPcTPercent: 91.5 } }],
      selectionRules: [],
    });
    expect(entries[0]?.forms[0]).toMatchObject({ solveRate: 100, nextPcGPercent: 96.25, nextPcTPercent: 91.5 });
  });
});
