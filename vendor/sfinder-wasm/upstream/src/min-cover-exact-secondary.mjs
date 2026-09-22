import { minimumCover } from "./min-cover.mjs";
const FAST_EXACT_STATE_BUDGET = 100000;

export function solveExactSecondary(coverage, options) {
    const { solver, qualityFor, primary, primaryKeys, primaryHard, requestedPrimary, requested, kernelStats,
      integratedProbe, deferThreshold } = options;
    const defer = probe => deferThreshold({ primary, primaryKeys, primaryHard, requestedPrimary,
      requested, kernelStats, integratedProbe: probe });

    // Ordinary fixed-K quality problems are much faster with the canonical
    // integrated BestSetSearch once K is already known. Bound that first
    // attempt so pathological quality structures can fall back to the
    // sequential-threshold exact prover without sacrificing exactness.
    if (!primaryHard) {
      const integrated = integratedProbe ?? solver?.minimumCoverAtCount?.(coverage, primary.count, {
        qualityFor, seedKeys: primaryKeys, stateBudget: FAST_EXACT_STATE_BUDGET, integrated: true,
      });
      if (integrated?.completed && Number.isFinite(integrated.count) && integrated.count === primary.count) {
        return {
          ...integrated,
          backend: primary.backend === "highs" ? "highs+rust" : primary.backend === "kernel" ? "kernel+rust" : "rust",
          cardinalityBackend: primary.backend,
          qualityBackend: "rust-quality-integrated",
          qualityExact: true,
          primaryRequested: requestedPrimary, primaryResolved: primary.backend,
          useHiGHSRequested: requested,
          useHiGHSResolved: primary.backend === "highs",
          minimumCoverKernelCases: kernelStats.cases,
          minimumCoverKernelSolutions: kernelStats.solutions,
          minimumCoverKernelEntries: kernelStats.entries,
          primarySearchedStates: primary.searchedStates ?? 0,
          qualitySearchedStates: integrated.searchedStates ?? 0,
          fastProbeBudget: null,
          fastProbeStates: null,
          fastFallback: false,
          qualityDecision: "integrated-exact",
        };
      }
      if (deferThreshold) return defer(integrated);
      const sequentialSeed = integrated?.keys?.length === primary.count ? integrated.keys : primaryKeys;
      const exact = solver?.minimumCoverAtCount?.(coverage, primary.count, {
        qualityFor, seedKeys: sequentialSeed, lockedPrefix: [],
      }) ?? minimumCover(coverage, { qualityFor, solver });
      if (!Number.isFinite(exact?.count) || exact.count !== primary.count) {
        throw new Error(`fixed-count exact quality search failed for K=${primary.count}`);
      }
      return {
        ...exact,
        backend: primary.backend === "highs" ? "highs+rust" : primary.backend === "kernel" ? "kernel+rust" : "rust",
        cardinalityBackend: primary.backend,
        qualityBackend: "rust-quality-threshold-fallback",
        qualityExact: true,
        primaryRequested: requestedPrimary, primaryResolved: primary.backend,
        useHiGHSRequested: requested,
        useHiGHSResolved: primary.backend === "highs",
        minimumCoverKernelCases: kernelStats.cases,
        minimumCoverKernelSolutions: kernelStats.solutions,
        minimumCoverKernelEntries: kernelStats.entries,
        primarySearchedStates: primary.searchedStates ?? 0,
        qualitySearchedStates: (integrated?.searchedStates ?? 0) + (exact.searchedStates ?? 0),
        fastProbeBudget: null,
        fastProbeStates: null,
        fastFallback: false,
        qualityDecision: "integrated-budget-to-threshold",
        integratedProbeStates: integrated?.searchedStates ?? 0,
      };
    }

    if (deferThreshold) return defer(undefined);
    const exact = solver?.minimumCoverAtCount?.(coverage, primary.count, {
      qualityFor, seedKeys: primaryKeys, lockedPrefix: [],
    }) ?? minimumCover(coverage, { qualityFor, solver });
    if (!Number.isFinite(exact?.count) || exact.count !== primary.count) {
      throw new Error(`fixed-count exact quality search failed for K=${primary.count}`);
    }
    return {
      ...exact,
      backend: primary.backend === "highs" ? "highs+rust" : primary.backend === "kernel" ? "kernel+rust" : "rust",
      cardinalityBackend: primary.backend,
      qualityBackend: "rust-quality-bnb",
      qualityExact: true,
      primaryRequested: requestedPrimary, primaryResolved: primary.backend,
      useHiGHSRequested: requested,
      useHiGHSResolved: primary.backend === "highs",
      minimumCoverKernelCases: kernelStats.cases,
      minimumCoverKernelSolutions: kernelStats.solutions,
      minimumCoverKernelEntries: kernelStats.entries,
      primarySearchedStates: primary.searchedStates ?? 0,
      qualitySearchedStates: exact.searchedStates ?? 0,
      fastProbeBudget: null,
      fastProbeStates: null,
      fastFallback: false,
      qualityDecision: "primary-hard-threshold-exact",
    };
 
}
