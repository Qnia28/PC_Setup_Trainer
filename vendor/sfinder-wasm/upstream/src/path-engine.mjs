export const PATTERN_BATCH_MIN_CASES = 24;

export function solveQueuesExistence({ board, queues, solver, useHold = true }) {
  return typeof solver.canPcMany === "function"
    ? solver.canPcMany(board, queues, useHold)
    : queues.map((queue) => solver.canPc(board, queue, useHold));
}

export function enumerateQueuesCached({ board, queues, solver, useHold = true }) {
  const cache = new Map();
  return queues.map((queue) => {
    let solutions = cache.get(queue);
    if (!solutions) {
      solutions = solver.enumeratePc(board, queue, useHold);
      cache.set(queue, solutions);
    }
    return solutions;
  });
}

export function canUsePatternPath({ cases, solver }) {
  return cases.length >= PATTERN_BATCH_MIN_CASES
    && solver.height >= 5
    && typeof solver.enumeratePcPattern === "function";
}

// Shared solver dispatch only. Feature-specific interpretation stays outside
// this layer so hot pattern loops do not pay a callback/object allocation per
// coverage hit.
export function enumerateCasePath({ board, cases, solver, useHold = true }) {
  if (canUsePatternPath({ cases, solver })) {
    const rows = solver.enumeratePcPattern(board, cases.map((entry) => entry.queue), useHold);
    if (Array.isArray(rows)) return { mode: "pattern", rows };
  }

  return {
    mode: "scalar",
    rows: enumerateQueuesCached({
      board,
      queues: cases.map((entry) => entry.queue),
      solver,
      useHold,
    }),
  };
}

// Convenience adapter for features where callback overhead is insignificant.
// Minimals and other broad-pattern hot paths may consume enumerateCasePath()
// directly instead.
export function visitCaseSolutions({
  board,
  cases,
  solver,
  useHold = true,
  visit = null,
  collectByKey = true,
  trackCaseSolutions = true,
}) {
  const caseHasSolution = trackCaseSolutions ? new Uint8Array(cases.length) : null;
  const byKey = collectByKey ? new Map() : null;
  const path = enumerateCasePath({ board, cases, solver, useHold });

  if (path.mode === "pattern") {
    for (const solution of path.rows) {
      if (byKey) byKey.set(solution.key, solution);
      for (const hit of solution.coverage) {
        const caseIndex = hit.caseIndex;
        const entry = cases[caseIndex];
        if (!entry) throw new Error(`invalid pattern coverage case ${caseIndex}`);
        if (caseHasSolution) caseHasSolution[caseIndex] = 1;
        if (visit) visit(entry, caseIndex, solution, Number(hit.orderCount ?? 0));
      }
    }
  } else {
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const entry = cases[caseIndex];
      const solutions = path.rows[caseIndex];
      if (caseHasSolution && solutions.length > 0) caseHasSolution[caseIndex] = 1;
      for (const solution of solutions) {
        if (byKey) byKey.set(solution.key, solution);
        if (visit) visit(entry, caseIndex, solution, Number(solution.orderCount ?? 0));
      }
    }
  }
  return { mode: path.mode, caseHasSolution, byKey };
}
