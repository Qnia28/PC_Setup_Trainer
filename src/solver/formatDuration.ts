export function formatCalculationDuration(elapsedMs: number): string {
  const roundedMs = Math.max(0, Math.round(elapsedMs));
  return roundedMs >= 10_000 ? `${(roundedMs / 1_000).toFixed(1)} s` : `${roundedMs} ms`;
}
