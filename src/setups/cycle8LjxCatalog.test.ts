import { describe, expect, it } from "vitest";
import {
  cycle8LjxCatalogForClass,
  cycle8LjxExactClass,
  cycle8LjxRuntimeBundle,
  cycle8LjxRuntimeEntryForSetup,
} from "./cycle8LjxCatalog";

describe("Cycle 8 L/J>X runtime catalog", () => {
  it("classifies only exact duplicate-L/J replacement classes", () => {
    expect(cycle8LjxExactClass("L", "O")).toBe("L>O");
    expect(cycle8LjxExactClass("J", "Z")).toBe("J>Z");
    expect(cycle8LjxExactClass("T", "O")).toBeNull();
    expect(cycle8LjxExactClass("L", "L")).toBeNull();
  });

  it("activates all 123 canonical source records and their declared mirrors", () => {
    expect(cycle8LjxRuntimeBundle()?.policy.runtimePolicy.entries).toHaveLength(123);
    expect(cycle8LjxCatalogForClass("L>O", "general-4p").length).toBeGreaterThan(0);
    expect(cycle8LjxCatalogForClass("J>O", "general-4p").length).toBeGreaterThan(0);
    expect(cycle8LjxCatalogForClass("L>Z", "general-3p")).toHaveLength(1);
    expect(cycle8LjxCatalogForClass("J>S", "general-3p")).toHaveLength(1);
  });

  it("does not copy an absent mirror-direction rate", () => {
    const mirrored = cycle8LjxCatalogForClass("J>T")
      .find((setup) => cycle8LjxRuntimeEntryForSetup(setup)?.setupId.endsWith("001-f000"));
    expect(mirrored?.solveRate).toBeUndefined();
    const explicit = cycle8LjxCatalogForClass("J>T")
      .find((setup) => cycle8LjxRuntimeEntryForSetup(setup)?.setupId.endsWith("002-f000"));
    expect(explicit?.solveRate).toBe(96.98);
  });
});
