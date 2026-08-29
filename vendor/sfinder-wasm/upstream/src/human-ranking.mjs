// Human-friendliness v1 is produced by the structural Rust enumerator:
// orderCount = number of distinct piece-type placement orders that actually
// reach this solution under the concrete queue + Hold rules.
//
// For matrix minimals the same geometry can have a different orderCount in
// different queue cases, so quality is indexed by (caseId, solutionKey).

export function comparePreferredSolutions(left, right) {
  const orderDifference = Number(right?.orderCount ?? 0) - Number(left?.orderCount ?? 0);
  if (orderDifference !== 0) return orderDifference;
  const leftKey = left?.key ?? "";
  const rightKey = right?.key ?? "";
  return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
}

export function preferredSolution(solutions) {
  let best = null;
  for (const solution of solutions) {
    if (best === null || comparePreferredSolutions(solution, best) < 0) best = solution;
  }
  return best;
}

export function recordOrderCount(index, caseId, solution) {
  let byKey = index.get(caseId);
  if (!byKey) {
    byKey = new Map();
    index.set(caseId, byKey);
  }
  const value = Number(solution?.orderCount ?? 0);
  const previous = byKey.get(solution.key) ?? 0;
  if (value > previous) byKey.set(solution.key, value);
}

export function makeOrderCountQuality(index) {
  let cachedCaseId;
  let cachedByKey;
  return (key, caseId) => {
    if (caseId !== cachedCaseId) {
      cachedCaseId = caseId;
      cachedByKey = index.get(caseId);
    }
    return cachedByKey?.get(key) ?? 0;
  };
}
