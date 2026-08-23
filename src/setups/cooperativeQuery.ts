import {
  queryCatalogCooperative,
  recommendationProgram,
  type StagedRecommendationResult,
  type SetupQuery,
} from "./query";
import type { CooperativeSearchControl } from "./reachability";
import type { SelectedRecommendationScope } from "./recommendationScope";

export type { RecommendationStage, StagedRecommendationResult } from "./query";

export type RecommendationStageReceiver = (result: StagedRecommendationResult) => void;

/**
 * Executes the same recommendation program as querySetups, replacing only the
 * catalog-search executor with the cooperative Worker implementation.
 */
export async function querySetupsStagedCooperative(
  query: SetupQuery,
  control: CooperativeSearchControl,
  receive: RecommendationStageReceiver,
  scope?: SelectedRecommendationScope,
): Promise<void> {
  const program = recommendationProgram(query, scope);
  let cursor = program.next();
  while (!cursor.done) {
    if (cursor.value.type === "stage") {
      receive(cursor.value.result);
      cursor = program.next([]);
      continue;
    }
    const search = cursor.value.search;
    const rawCandidates = await queryCatalogCooperative(
      search.catalog,
      search.query,
      control,
      search.policy,
      search.policyPrefix,
      search.policyCatalog,
      search.placeableNextCount,
      search.candidateLimit,
      search.scoreForSetup,
      search.setupCycle,
    );
    const candidates = search.source
      ? rawCandidates.map((candidate) => ({ ...candidate, recommendationSource: search.source }))
      : rawCandidates;
    cursor = program.next(candidates);
  }
}
