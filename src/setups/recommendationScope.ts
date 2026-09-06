import type { Cycle, Piece } from "../engine/types";
import type { Cycle2AdvancedQbPolicy } from "./cycle2AdvancedQb";
import type { Cycle5AdvancedPolicyBundle } from "./cycle5AdvancedPolicy";
import type { Cycle7Advanced4pRuntimeBundle } from "./cycle7Advanced4pCatalog";
import type { Cycle7QbRuntimeBundle } from "./cycle7QbCatalog";
import type { Cycle7TwoPlusTwoPolicy } from "./cycle7TwoPlusTwoPolicy";
import type { StructuredSetupPolicy } from "./policy";
import type { SetupVariant } from "./schema";

export type RecommendationBundleKind =
  | "structured"
  | "cycle2-qb"
  | "cycle5-advanced"
  | "cycle7-qb"
  | "cycle7-2plus2-qb"
  | "cycle7-advanced-4p";

export interface RecommendationSourceIdentity {
  /** Stable UI/provider identity. It is never persisted into setup JSON. */
  bundleId: string;
  kind: RecommendationBundleKind;
}

interface SelectedRecommendationBundleBase {
  bundleId: string;
  cycle: Cycle;
  catalog: SetupVariant[];
}

export interface Cycle3ClassBinding {
  /** Class represented by source-basis geometry in the selected file. */
  source: Piece;
  /** Distinct class represented only by horizontally mirrored runtime variants. */
  mirror?: Piece;
}

export type SelectedRecommendationBundle =
  | (SelectedRecommendationBundleBase & {
      kind: "structured";
      /** Distinguishes Cycle 2's ordinary 4P and advanced 3P stages. */
      role?: "general" | "advanced-3p";
      /** Required by selected Cycle 3 catalogs so diagnostic scope cannot cross saved-piece classes. */
      cycle3ClassBinding?: Cycle3ClassBinding;
      policy?: StructuredSetupPolicy;
    })
  | (SelectedRecommendationBundleBase & {
      kind: "cycle2-qb";
      cycle: 2;
      policy: Cycle2AdvancedQbPolicy;
    })
  | (SelectedRecommendationBundleBase & {
      kind: "cycle5-advanced";
      cycle: 5;
      policy: Cycle5AdvancedPolicyBundle;
      /** Runtime projection from a source-basis class to its horizontal mirror class. */
      runtimeMirror?: boolean;
      /** Manifest/review/runtimeEligible gates apply; setup_test selection omits this. */
      productionGated?: boolean;
    })
  | (SelectedRecommendationBundleBase & {
      kind: "cycle7-qb";
      cycle: 7;
      policy: Cycle7QbRuntimeBundle["policy"];
    })
  | (SelectedRecommendationBundleBase & {
      kind: "cycle7-2plus2-qb";
      cycle: 7;
      policy: Cycle7TwoPlusTwoPolicy;
    })
  | (SelectedRecommendationBundleBase & {
      kind: "cycle7-advanced-4p";
      cycle: 7;
      policy: Cycle7Advanced4pRuntimeBundle["policy"];
    });

/**
 * Diagnostic source restriction for setup_test. When present, recommendation
 * orchestration may read only these catalog/policy pairs. Inactive/draft data
 * is intentionally allowed because selecting it is an explicit test action.
 */
export interface SelectedRecommendationScope {
  mode: "selected-bundles";
  bundles: SelectedRecommendationBundle[];
}

export function selectedBundlesForCycle(
  scope: SelectedRecommendationScope,
  cycle: Cycle,
): SelectedRecommendationBundle[] {
  return scope.bundles.filter((bundle) => bundle.cycle === cycle);
}

export function recommendationSourceForBundle(
  bundle: SelectedRecommendationBundle,
): RecommendationSourceIdentity {
  return { bundleId: bundle.bundleId, kind: bundle.kind };
}
