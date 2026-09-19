import { describe, expect, it } from "vitest";
import { setupRateMetrics } from "./setupMetricDisplay";

describe("setup rate presentation", () => {
  it("shows PC, Good and T for PC# 3 using the policy values", () => {
    expect(setupRateMetrics({ cycle: 3, solveRate: 98.57,
      nextPcGPercent: 94.7985347985348, nextPcTPercent: 92.6007326007326 })).toEqual([
      { label: "PC", value: "98.57%" },
      { label: "Good", value: "94.8%" },
      { label: "T", value: "92.6%" },
    ]);
  });

  it("keeps unavailable rates unknown and other PC pages PC-only", () => {
    expect(setupRateMetrics({ cycle: 3 })).toEqual([
      { label: "PC", value: "—" },
      { label: "Good", value: "—" },
      { label: "T", value: "—" },
    ]);
    expect(setupRateMetrics({ cycle: 2, solveRate: 0 })).toEqual([{ label: "PC", value: "0%" }]);
  });
});
