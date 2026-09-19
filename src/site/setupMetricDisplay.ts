import type { SetupVariant } from "../setups/schema";

export function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Number(value.toFixed(2))}%`;
}

export function setupRateMetrics(setup: Pick<SetupVariant, "cycle" | "solveRate" | "nextPcGPercent" | "nextPcTPercent">) {
  const metrics = [{ label: "PC", value: percent(setup.solveRate) }];
  if (setup.cycle === 3) {
    metrics.push(
      { label: "Good", value: percent(setup.nextPcGPercent) },
      { label: "T", value: percent(setup.nextPcTPercent) },
    );
  }
  return metrics;
}
