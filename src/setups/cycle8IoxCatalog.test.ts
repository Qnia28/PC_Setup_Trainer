import { describe, expect, it } from "vitest";
import {
  cycle8IoxCatalogForClass,
  cycle8IoxExactClass,
  cycle8IoxExactClassForSetup,
  cycle8IoxRuntimeBundle,
  cycle8IoxRuntimeEntryForSetup,
  cycle8IoxTwoLinePcPlanForSetup,
} from "./cycle8IoxCatalog";

describe("Cycle 8 I>X and O>X runtime catalogs", () => {
  it("activates every reviewed source record under its exact replacement class", () => {
    expect(cycle8IoxRuntimeBundle("I")?.policy.runtimePolicy.entries).toHaveLength(77);
    expect(cycle8IoxRuntimeBundle("O")?.policy.runtimePolicy.entries).toHaveLength(62);
    expect(cycle8IoxExactClass("I", "Z")).toBe("I>Z");
    expect(cycle8IoxExactClass("O", "J")).toBe("O>J");
    expect(cycle8IoxExactClass("T", "J")).toBeNull();
  });

  it("maps exact-class mirrors without inventing missing direction metrics", () => {
    const iSource = cycle8IoxCatalogForClass("I>L").find((setup) =>
      cycle8IoxRuntimeEntryForSetup(setup)?.setupId.endsWith("033-f000"));
    const iMirror = cycle8IoxCatalogForClass("I>J").find((setup) =>
      cycle8IoxRuntimeEntryForSetup(setup)?.setupId.endsWith("033-f000"));
    expect(cycle8IoxExactClassForSetup(iSource!)).toBe("I>L");
    expect(cycle8IoxExactClassForSetup(iMirror!)).toBe("I>J");
    expect(iSource?.solveRate).toBeDefined();
    expect(iMirror?.solveRate).toBeDefined();

    const noPublishedMirrorRate = cycle8IoxCatalogForClass("O>J")[0];
    expect(noPublishedMirrorRate.solveRate).toBeUndefined();
  });

  it("uses the one explicit within-class mirror rate and leaves the others undefined", () => {
    const item13 = cycle8IoxCatalogForClass("I>T").filter((setup) =>
      cycle8IoxRuntimeEntryForSetup(setup)?.setupId.endsWith("013-f000"));
    expect(item13.some(({ solveRate }) => solveRate === 56.43)).toBe(true);
    const item12 = cycle8IoxCatalogForClass("I>T").filter((setup) =>
      cycle8IoxRuntimeEntryForSetup(setup)?.setupId.endsWith("012-f000"));
    expect(item12.some(({ solveRate }) => solveRate === undefined)).toBe(true);
  });

  it("keeps 2L separate from solve rate and mirrors its next-cycle class", () => {
    const source = cycle8IoxCatalogForClass("O>S").find(({ displayName }) => displayName === "2L")!;
    const mirrored = cycle8IoxCatalogForClass("O>Z").find(({ displayName }) => displayName === "2L")!;
    expect(source.placements).toHaveLength(5);
    expect(source.solveRate).toBeUndefined();
    expect(mirrored.solveRate).toBeUndefined();
    expect(cycle8IoxTwoLinePcPlanForSetup(source, "O>S")?.direction.nextClass).toBe("TZ");
    expect(cycle8IoxTwoLinePcPlanForSetup(mirrored, "O>Z")?.direction.nextClass).toBe("TS");
  });
});
