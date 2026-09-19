import { describe, expect, it } from "vitest";
import { parseDictionarySearch } from "./searchInput";

describe("queue and class input", () => {
  it.each([[2, "TIOS", 4], [5, "to", 2], [6, "TOILSZ", 6], [3, "j", 1], [4, "TOLSZ", 5]] as const)(
    "accepts PC# %i class %s", (pc, input, count) => {
      const parsed = parseDictionarySearch(pc, input);
      expect(parsed.kind).toBe("class");
      if (parsed.kind === "class") expect(parsed.pieces).toHaveLength(count);
    });
  it.each([[4, "IJ", "TOLSZ"], [6, "I", "TOLJSZ"]] as const)("supports equivalent missing-piece syntax for PC# %i", (pc, missing, pool) => {
    const no = parseDictionarySearch(pc, ` no ${missing.toLowerCase()} `);
    expect(parseDictionarySearch(pc, `- ${missing}`)).toEqual(no);
    expect(no.kind).toBe("class");
    const direct = parseDictionarySearch(pc, pool);
    if (no.kind === "class" && direct.kind === "class") expect(no.pieces).toEqual(direct.pieces);
  });
  it("keeps seven-piece input ordered, including duplicates", () => {
    expect(parseDictionarySearch(5, " t t j z l o i ")).toEqual({ kind: "queue", value: "TTJZLOI" });
  });
  it.each(["", "NO", "-", "NO X", "-II", "TIIO", "NO IJ/NO SZ", "TIO", "TOILJSZZ"])("rejects invalid PC# 2 expression %s", input => {
    expect(() => parseDictionarySearch(2, input)).toThrow();
  });
  it("validates class size against the selected PC number", () => {
    expect(() => parseDictionarySearch(4, "NO I")).toThrow("5 distinct");
    expect(() => parseDictionarySearch(6, "-IJ")).toThrow("6 distinct");
    expect(() => parseDictionarySearch(8, "TO")).toThrow("7-piece queue");
  });
});
