import manifest from "../../setups/catalog-manifest.json";
import catalog from "../../setups/QB/cycle-7-2plus2-qb-setups.json";
import policy from "../../setups/QB/cycle-7-2plus2-qb-policy.json";
import { cycle7TwoPlusTwoRuntimeReady, type Cycle7TwoPlusTwoBundle } from "./cycle7TwoPlusTwoPolicy";

const bundle = { catalog, policy } as unknown as Cycle7TwoPlusTwoBundle;

/** Exact physical variants are already materialized; never auto-expand mirrors/boxes here. */
export function cycle7TwoPlusTwoRuntimeBundle(): Cycle7TwoPlusTwoBundle | null {
  const cycle = manifest.cycles["7"] as unknown as {
    runtimeEnabled?: boolean;
    qb2plus2?: { runtimeEnabled?: boolean; conditionCompilerReady?: boolean; setupCount?: number; logicalSetupCount?: number };
  };
  return cycle.runtimeEnabled === true && cycle7TwoPlusTwoRuntimeReady(cycle.qb2plus2, bundle) ? bundle : null;
}
