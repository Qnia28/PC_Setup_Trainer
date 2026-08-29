import Highs from "./vendor/highs.mjs";
import { minimumCover } from "./min-cover.mjs";

// Auto chooses only the *primary cardinality* backend.  Do not use the old
// legacy exact-search timings here: those mixed cardinality proof with exact
// secondary human-quality enumeration and badly misclassified matrices such as
// pcinfo-019.  The exact primary kernel is cheap enough to build first, removes
// duplicate/raw-size inflation, and exposes the structure that matters to the
// Rust cardinality-only search.
//
// The two guards are intentionally conservative and use primary-only data.
// Current full-matrix Rust cardinality-only measurements after kernelization:
//   pcinfo-019  10/8/20       ~8 ms
//   pcinfo-022  232/94/2428   ~44 ms
//   pcinfo-024  456/95/5028   ~38 ms
// BOX-derived sampled kernels such as 239/113/2435 and 712/141/7483 exceeded
// the Rust cardinality-only timeout and are routed to HiGHS. Secondary-quality
// timings are deliberately excluded from these guards.
const AUTO_PRIMARY_WIDE_MIN_CASES = 200;
const AUTO_PRIMARY_WIDE_MIN_SOLUTIONS = 112;
const AUTO_PRIMARY_WIDE_MIN_ENTRIES = 2200;
const AUTO_PRIMARY_LARGE_MIN_CASES = 650;
const AUTO_PRIMARY_LARGE_MIN_SOLUTIONS = 105;
const AUTO_PRIMARY_LARGE_MIN_ENTRIES = 6000;

// Release 2.1: ordinary fixed-K quality uses canonical-style integrated
// BestSetSearch with a deterministic state budget. Fast falls back to 2x2 on
// budget exhaustion; True falls back to the sequential-threshold exact prover.
export const FAST_EXACT_STATE_BUDGET = 100000;

let highsPromise;

async function bytesFor(url) {
  if (typeof process !== "undefined" && process.versions?.node) {
    const moduleName = "node:fs/promises";
    const { readFile } = await import(/* @vite-ignore */ moduleName);
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadHighs() {
  highsPromise ??= (async () => {
    const wasmBinary = await bytesFor(new URL("../wasm/highs.wasm", import.meta.url));
    return Highs({ wasmBinary, print: () => {}, printErr: () => {} });
  })();
  return highsPromise;
}

function variableLines(names, maxLength = 100) {
  const lines = [];
  let current = "";
  for (const name of names) {
    const next = current ? `${current} ${name}` : ` ${name}`;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = ` ${name}`;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

export function prepareCoverageMatrix(coverage, qualityFor = null) {
  const rawCases = [];
  const keySet = new Set();
  for (const [caseId, solutions] of coverage) {
    if (!solutions?.size) continue;
    const row = [...solutions];
    for (const key of row) keySet.add(key);
    rawCases.push({ caseId, row });
  }
  const keys = [...keySet].sort();
  const keyIndex = new Map(keys.map((key, index) => [key, index]));
  const cases = new Array(rawCases.length);
  const primaryCases = new Array(rawCases.length);
  let entryCount = 0;
  let maxQuality = 0;
  for (let caseIndex = 0; caseIndex < rawCases.length; caseIndex += 1) {
    const raw = rawCases[caseIndex];
    // `coverage` rows are Sets, so key IDs are already unique. Avoid rebuilding
    // every row through a Map + sort just to deduplicate it again.
    const entries = new Array(raw.row.length);
    const ids = new Array(raw.row.length);
    let position = 0;
    for (const key of raw.row) {
      const id = keyIndex.get(key);
      const value = qualityFor ? Number(qualityFor(key, raw.caseId)) : 0;
      const quality = Number.isFinite(value)
        ? Math.max(0, Math.min(0xffffffff, Math.floor(value)))
        : 0;
      ids[position] = id;
      entries[position] = [id, quality];
      position += 1;
      if (quality > maxQuality) maxQuality = quality;
    }
    entryCount += entries.length;
    cases[caseIndex] = entries;
    primaryCases[caseIndex] = ids;
  }
  return { keys, cases, primaryCases, entryCount, maxQuality };
}

export function primaryKernelStats(kernel) {
  return {
    cases: kernel?.cases?.length ?? 0,
    solutions: kernel?.solutionIds?.length ?? 0,
    entries: kernel?.entryCount ?? kernel?.cases?.reduce((sum, row) => sum + row.length, 0) ?? 0,
    forced: kernel?.forced?.length ?? 0,
  };
}

export function isHardPrimaryKernel(kernel) {
  const stats = primaryKernelStats(kernel);
  return (stats.cases >= AUTO_PRIMARY_WIDE_MIN_CASES
      && stats.solutions >= AUTO_PRIMARY_WIDE_MIN_SOLUTIONS
      && stats.entries >= AUTO_PRIMARY_WIDE_MIN_ENTRIES)
    || (stats.cases >= AUTO_PRIMARY_LARGE_MIN_CASES
      && stats.solutions >= AUTO_PRIMARY_LARGE_MIN_SOLUTIONS
      && stats.entries >= AUTO_PRIMARY_LARGE_MIN_ENTRIES);
}

// Kept as a compatibility/exported helper for callers that only have a raw
// prepared matrix. Production Auto always supplies the exact primary kernel.
export function isHardMinimumCover(prepared) {
  return isHardPrimaryKernel(kernelizeCardinality(prepared.primaryCases ?? prepared.cases.map((row) => row.map(([id]) => id)), prepared.keys.length));
}

export function buildCardinalityLp(rawCases, solutionCount) {
  const names = Array.from({ length: solutionCount }, (_, i) => `x${i}`);
  const parts = ["Minimize", ` obj: ${names.join(" + ")}`, "Subject To"];
  for (let ci = 0; ci < rawCases.length; ci += 1) {
    const ids = rawCases[ci];
    if (!ids.length) throw new Error(`uncoverable case ${ci}`);
    parts.push(` c${ci}: ${ids.map((id) => `x${id}`).join(" + ")} >= 1`);
  }
  parts.push("Binary", variableLines(names), "End", "");
  return parts.join("\n");
}

export async function solveCardinality(rawCases, solutionCount, options = {}) {
  if (rawCases.length === 0) return { count: 0, selected: [], result: null };
  const highs = await loadHighs();
  const lp = buildCardinalityLp(rawCases, solutionCount);
  const result = highs.solve(lp, {
    output_flag: false,
    random_seed: 0,
    mip_rel_gap: 0,
    ...options,
  });
  if (result.Status !== "Optimal") throw new Error(`HiGHS cardinality status: ${result.Status}`);
  const selected = [];
  for (let i = 0; i < solutionCount; i += 1) {
    if (Number(result.Columns[`x${i}`]?.Primal ?? 0) > 0.5) selected.push(i);
  }
  return { count: Math.round(result.ObjectiveValue), selected, result };
}

function subsetMask(a, b) {
  return (a & ~b) === 0n;
}

// Exact primary-objective reductions. Quality is intentionally ignored here;
// all original candidates are restored for the post-MIP human-quality pass.
export function kernelizeCardinality(rawCases, solutionCount) {
  let activeCases = rawCases.map((row, original) => ({
    original,
    ids: [...new Set(row)].sort((a, b) => a - b),
  }));
  let activeSolutions = new Set(Array.from({ length: solutionCount }, (_, i) => i));
  const forced = [];
  let changed = true;

  while (changed) {
    changed = false;
    const forcedSet = new Set(forced);
    const nextCases = [];
    for (const entry of activeCases) {
      if (entry.ids.some((id) => forcedSet.has(id))) {
        changed = true;
        continue;
      }
      const ids = entry.ids.filter((id) => activeSolutions.has(id));
      if (!ids.length) throw new Error(`cardinality kernel made case ${entry.original} uncoverable`);
      if (ids.length !== entry.ids.length) changed = true;
      nextCases.push({ original: entry.original, ids });
    }
    activeCases = nextCases;
    if (!activeCases.length) break;

    // Every singleton is mandatory. Force all currently visible singleton
    // candidates in one round instead of rescanning thousands of cases once per
    // forced solution.
    const singletonIds = new Set();
    for (const entry of activeCases) {
      if (entry.ids.length === 1) singletonIds.add(entry.ids[0]);
    }
    if (singletonIds.size) {
      for (const id of singletonIds) {
        if (activeSolutions.delete(id)) {
          forced.push(id);
          changed = true;
        }
      }
      continue;
    }

    const caseMasks = activeCases.map((entry) => {
      let mask = 0n;
      for (const id of entry.ids) mask |= 1n << BigInt(id);
      return mask;
    });
    const order = activeCases.map((_, i) => i).sort((a, b) =>
      activeCases[a].ids.length - activeCases[b].ids.length
      || activeCases[a].original - activeCases[b].original);
    const keep = new Uint8Array(activeCases.length);
    const kept = [];
    const exactMasks = new Set();
    let removedCase = false;
    // Rows are visited from smallest candidate set to largest. A row can be
    // discarded as soon as one already-kept row is a subset; there is no need
    // to compare every kept row against every later row.
    for (const index of order) {
      const mask = caseMasks[index];
      if (exactMasks.has(mask)) {
        removedCase = true;
        continue;
      }
      let dominated = false;
      for (const prior of kept) {
        if (activeCases[prior].ids.length > activeCases[index].ids.length) break;
        if (subsetMask(caseMasks[prior], mask)) {
          dominated = true;
          break;
        }
      }
      if (dominated) {
        removedCase = true;
        continue;
      }
      keep[index] = 1;
      kept.push(index);
      exactMasks.add(mask);
    }
    if (removedCase) {
      activeCases = activeCases.filter((_, i) => keep[i]);
      changed = true;
    }

    const coverage = new Map();
    for (const id of activeSolutions) coverage.set(id, 0n);
    for (let ci = 0; ci < activeCases.length; ci += 1) {
      const bit = 1n << BigInt(ci);
      for (const id of activeCases[ci].ids) {
        if (activeSolutions.has(id)) coverage.set(id, (coverage.get(id) ?? 0n) | bit);
      }
    }
    const ids = [...activeSolutions].filter((id) => coverage.get(id));
    const remove = new Set();
    for (let i = 0; i < ids.length; i += 1) {
      const a = ids[i];
      if (remove.has(a)) continue;
      const ca = coverage.get(a);
      for (let j = 0; j < ids.length; j += 1) {
        if (i === j) continue;
        const b = ids[j];
        if (remove.has(b)) continue;
        const cb = coverage.get(b);
        if (subsetMask(ca, cb) && (ca !== cb || a > b)) {
          remove.add(a);
          break;
        }
      }
    }
    for (const id of activeSolutions) if (!coverage.get(id)) remove.add(id);
    if (remove.size) {
      for (const id of remove) activeSolutions.delete(id);
      changed = true;
    }
  }

  const solutionIds = [...activeSolutions].sort((a, b) => a - b);
  const remap = new Map(solutionIds.map((id, i) => [id, i]));
  const cases = activeCases.map((entry) => entry.ids
    .filter((id) => activeSolutions.has(id))
    .map((id) => remap.get(id)));
  return {
    cases,
    solutionIds,
    forced: [...new Set(forced)].sort((a, b) => a - b),
  };
}

export async function solvePreparedCardinalityKernel(kernel, options = {}) {
  if (!kernel.cases.length) {
    return { count: kernel.forced.length, selected: kernel.forced, kernel, result: null, backend: "kernel" };
  }
  const solved = await solveCardinality(kernel.cases, kernel.solutionIds.length, options);
  const selected = [...kernel.forced, ...solved.selected.map((id) => kernel.solutionIds[id])]
    .sort((a, b) => a - b);
  return { count: selected.length, selected, kernel, result: solved.result, backend: "highs" };
}

export function solvePreparedRustCardinalityKernel(prepared, kernel, solver = null) {
  if (!kernel.cases.length) {
    return { count: kernel.forced.length, selected: kernel.forced, kernel, searchedStates: 0, backend: "kernel" };
  }

  // The primary kernel is already a compact numeric-ID matrix. Pass it directly
  // to WASM instead of rebuilding string-key Maps/Sets and then converting them
  // back to numeric CSR in the backend.
  const numeric = solver?.minimumCoverCardinalityIds?.(kernel.cases, kernel.solutionIds.length);
  if (numeric) {
    if (!Number.isFinite(numeric.count)) throw new Error("Rust cardinality-only kernel solve failed");
    const selected = [...kernel.forced];
    for (const localId of numeric.selectedIds) {
      const originalId = kernel.solutionIds[localId];
      if (originalId === undefined) throw new Error(`Rust kernel result contains an unknown candidate ID: ${localId}`);
      selected.push(originalId);
    }
    selected.sort((a, b) => a - b);
    return {
      count: selected.length,
      selected,
      kernel,
      searchedStates: numeric.searchedStates ?? 0,
      backend: "rust",
    };
  }

  // Compatibility fallback for non-WASM/custom solvers.
  const kernelKeys = kernel.solutionIds.map((id) => prepared.keys[id]);
  const coverage = new Map();
  for (let ci = 0; ci < kernel.cases.length; ci += 1) {
    coverage.set(ci, new Set(kernel.cases[ci].map((id) => kernelKeys[id])));
  }
  const solved = solver?.minimumCoverCardinality?.(coverage)
    ?? minimumCover(coverage, { qualityFor: null, solver });
  if (!Number.isFinite(solved.count)) throw new Error("Rust cardinality-only kernel solve failed");
  const remap = new Map(kernelKeys.map((key, id) => [key, kernel.solutionIds[id]]));
  const selected = [...kernel.forced];
  for (const key of solved.keys) {
    const id = remap.get(key);
    if (id === undefined) throw new Error(`Rust kernel result contains an unknown candidate: ${key}`);
    selected.push(id);
  }
  selected.sort((a, b) => a - b);
  return {
    count: selected.length,
    selected,
    kernel,
    searchedStates: solved.searchedStates ?? 0,
    backend: "rust",
  };
}

export async function solveCardinalityKernel(rawCases, solutionCount, options = {}) {
  return solvePreparedCardinalityKernel(kernelizeCardinality(rawCases, solutionCount), options);
}

function stableIdsLess(a, b) {
  if (!b) return true;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

function compareHistograms(a, b) {
  const n = Math.max(a.length, b.length);
  for (let q = 0; q < n; q += 1) {
    const av = a[q] ?? 0;
    const bv = b[q] ?? 0;
    if (av !== bv) return av < bv ? 1 : -1;
  }
  return 0;
}

function selectedQualityHistogram(selected, dense, caseCount, maxQuality) {
  const histogram = new Uint32Array(maxQuality + 1);
  for (let ci = 0; ci < caseCount; ci += 1) {
    let best = 0;
    for (const id of selected) best = Math.max(best, dense[id * caseCount + ci]);
    histogram[best] += 1;
  }
  return histogram;
}

function histogramVector(histogram) {
  const out = [];
  for (let q = 0; q < histogram.length; q += 1) {
    for (let n = histogram[q]; n > 0; n -= 1) out.push(q);
  }
  return out;
}

// Deterministic 2-for-2 local refinement. Cardinality and full coverage remain
// exact; this pass only chooses a more human-friendly member of the proven
// minimum-cardinality family. The pass is deliberately bounded to local moves
// so hard matrices never re-enter an exponential exact quality enumeration.
export function refineMinimumCoverQuality(prepared, initialSelected, { maxPasses = 16 } = {}) {
  const { cases, keys, maxQuality } = prepared;
  const solutionCount = keys.length;
  const caseCount = cases.length;
  if (initialSelected.length < 2 || !caseCount) {
    const selected = [...initialSelected].sort((a, b) => a - b);
    const dense = new Uint32Array(solutionCount * caseCount);
    for (let ci = 0; ci < caseCount; ci += 1) for (const [id, q] of cases[ci]) dense[id * caseCount + ci] = q;
    const histogram = selectedQualityHistogram(selected, dense, caseCount, maxQuality);
    return { selected, qualityVector: histogramVector(histogram), passes: 0 };
  }

  const dense = new Uint32Array(solutionCount * caseCount);
  const candidateCases = Array.from({ length: solutionCount }, () => []);
  for (let ci = 0; ci < caseCount; ci += 1) {
    for (const [id, q] of cases[ci]) {
      dense[id * caseCount + ci] = q;
      candidateCases[id].push(ci);
    }
  }

  let selected = [...initialSelected].sort((a, b) => a - b);
  let bestHistogram = selectedQualityHistogram(selected, dense, caseCount, maxQuality);
  let passes = 0;

  for (; passes < maxPasses; passes += 1) {
    const coverCount = new Uint16Array(caseCount);
    for (const id of selected) for (const ci of candidateCases[id]) coverCount[ci] += 1;
    let bestMove = null;
    let passHistogram = bestHistogram;
    let passSelected = selected;

    for (let ai = 0; ai < selected.length; ai += 1) {
      for (let bi = ai + 1; bi < selected.length; bi += 1) {
        const a = selected[ai];
        const b = selected[bi];
        const base = selected.filter((_, index) => index !== ai && index !== bi);
        const baseSet = new Uint8Array(solutionCount);
        for (const id of base) baseSet[id] = 1;

        const missing = [];
        for (let ci = 0; ci < caseCount; ci += 1) {
          const remaining = coverCount[ci]
            - (dense[a * caseCount + ci] > 0 ? 1 : 0)
            - (dense[b * caseCount + ci] > 0 ? 1 : 0);
          if (remaining === 0) missing.push(ci);
        }
        if (!missing.length) continue;

        const candidates = [];
        for (let id = 0; id < solutionCount; id += 1) {
          if (baseSet[id]) continue;
          let contributes = false;
          const offset = id * caseCount;
          for (const ci of missing) {
            if (dense[offset + ci] > 0) { contributes = true; break; }
          }
          if (contributes) candidates.push(id);
        }

        const baseQuality = new Uint32Array(caseCount);
        for (const id of base) {
          const offset = id * caseCount;
          for (let ci = 0; ci < caseCount; ci += 1) {
            if (dense[offset + ci] > baseQuality[ci]) baseQuality[ci] = dense[offset + ci];
          }
        }

        for (let xi = 0; xi < candidates.length; xi += 1) {
          const x = candidates[xi];
          const xo = x * caseCount;
          for (let yi = xi + 1; yi < candidates.length; yi += 1) {
            const y = candidates[yi];
            const yo = y * caseCount;
            let coversMissing = true;
            for (const ci of missing) {
              if (dense[xo + ci] === 0 && dense[yo + ci] === 0) { coversMissing = false; break; }
            }
            if (!coversMissing) continue;

            const histogram = new Uint32Array(maxQuality + 1);
            for (let ci = 0; ci < caseCount; ci += 1) {
              const q = Math.max(baseQuality[ci], dense[xo + ci], dense[yo + ci]);
              histogram[q] += 1;
            }
            const candidateSelected = [...base, x, y].sort((l, r) => l - r);
            const cmp = compareHistograms(histogram, passHistogram);
            if (cmp > 0 || (cmp === 0 && stableIdsLess(candidateSelected, passSelected))) {
              bestMove = [a, b, x, y];
              passHistogram = histogram;
              passSelected = candidateSelected;
            }
          }
        }
      }
    }

    if (!bestMove) break;
    selected = passSelected;
    bestHistogram = passHistogram;
  }

  return { selected, qualityVector: histogramVector(bestHistogram), passes };
}

export function normalizeUseHiGHS(value = "auto") {
  if (value === true || value === false || value === "auto") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    if (normalized === "auto") return "auto";
  }
  throw new Error(`invalid UseHiGHS value: ${String(value)}`);
}

export function normalizeExactHumanQuality(value = "fast") {
  if (value === true) return "true";
  if (value === false || value == null) return "fast";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "exact") return "true";
    if (normalized === "fast" || normalized === "false" || normalized === "auto") return "fast";
  }
  throw new Error(`invalid exactHumanQuality value: ${String(value)}`);
}

export function resolveUseHiGHS(prepared, requested = "auto", primaryKernel = null) {
  const normalized = normalizeUseHiGHS(requested);
  if (normalized !== "auto") return normalized;
  const kernel = primaryKernel ?? kernelizeCardinality(
    prepared.primaryCases ?? prepared.cases.map((row) => row.map(([id]) => id)),
    prepared.keys.length,
  );
  // A fully solved kernel needs neither Rust search nor HiGHS MIP.
  if (!kernel.cases.length) return false;
  return isHardPrimaryKernel(kernel);
}


function candidateCountUpTo(coverage, limit) {
  const keys = new Set();
  for (const solutions of coverage.values()) {
    for (const key of solutions ?? []) {
      keys.add(key);
      if (keys.size > limit) return keys.size;
    }
  }
  return keys.size;
}

export async function minimumCoverAdaptiveAsync(coverage, {
  qualityFor = null,
  solver = null,
  exactQuality = "true",
  useHiGHS = "auto",
  fastStateBudget = FAST_EXACT_STATE_BUDGET,
  tinyExactMaxCandidates = 48,
} = {}) {
  const qualityMode = normalizeExactHumanQuality(exactQuality);
  const requested = normalizeUseHiGHS(useHiGHS);
  const tinyLimit = Math.max(0, Math.floor(Number(tinyExactMaxCandidates) || 0));
  if (tinyLimit > 0 && candidateCountUpTo(coverage, tinyLimit) <= tinyLimit) {
    const legacy = minimumCover(coverage, { qualityFor, solver });
    return {
      ...legacy,
      backend: "rust-legacy",
      cardinalityBackend: "rust-legacy-integrated",
      qualityBackend: "rust-legacy-exact",
      qualityExact: true,
      useHiGHSRequested: requested,
      useHiGHSResolved: false,
      minimumCoverKernelCases: null,
      minimumCoverKernelSolutions: null,
      minimumCoverKernelEntries: null,
      primarySearchedStates: legacy.searchedStates ?? 0,
      qualitySearchedStates: legacy.searchedStates ?? 0,
      fastProbeBudget: qualityMode === "fast" ? fastStateBudget : null,
      fastProbeStates: 0,
      fastFallback: false,
      fastDecision: "tiny-legacy-exact",
      qualityDecision: "tiny-legacy-exact",
    };
  }
  return minimumCoverAsync(coverage, {
    qualityFor,
    solver,
    exactQuality: qualityMode,
    useHiGHS: requested,
    fastStateBudget,
  });
}

export async function minimumCoverAsync(coverage, {
  qualityFor = null,
  solver = null,
  exactQuality = "fast",
  useHiGHS = "auto",
  fastStateBudget = FAST_EXACT_STATE_BUDGET,
} = {}) {
  const qualityMode = normalizeExactHumanQuality(exactQuality);
  const prepared = prepareCoverageMatrix(coverage, qualityFor);
  const requested = normalizeUseHiGHS(useHiGHS);
  if (!prepared.cases.length) {
    return {
      count: 0, keys: [], qualityVector: [], searchedStates: 0,
      backend: "kernel", cardinalityBackend: "kernel",
      qualityBackend: qualityMode === "true" ? "rust-quality-bnb" : "fast-exact-probe",
      qualityExact: true, useHiGHSRequested: requested, useHiGHSResolved: false,
      fastProbeBudget: qualityMode === "fast" ? fastStateBudget : null,
      fastProbeStates: 0, fastFallback: false,
    };
  }

  const primaryCases = prepared.primaryCases ?? prepared.cases.map((row) => row.map(([id]) => id));
  const primaryKernel = solver?.primaryKernelize?.(primaryCases, prepared.keys.length)
    ?? kernelizeCardinality(primaryCases, prepared.keys.length);
  const primaryHard = isHardPrimaryKernel(primaryKernel);
  const resolved = resolveUseHiGHS(prepared, requested, primaryKernel);
  const kernelStats = primaryKernelStats(primaryKernel);
  const primary = resolved
    ? await solvePreparedCardinalityKernel(primaryKernel)
    : solvePreparedRustCardinalityKernel(prepared, primaryKernel, solver);
  const primaryKeys = primary.selected.map((id) => prepared.keys[id]);

  if (qualityMode === "true") {
    // Ordinary fixed-K quality problems are much faster with the canonical
    // integrated BestSetSearch once K is already known. Bound that first
    // attempt so pathological quality structures can fall back to the
    // sequential-threshold exact prover without sacrificing exactness.
    if (!primaryHard) {
      const integrated = solver?.minimumCoverAtCount?.(coverage, primary.count, {
        qualityFor, seedKeys: primaryKeys, stateBudget: FAST_EXACT_STATE_BUDGET, integrated: true,
      });
      if (integrated?.completed && Number.isFinite(integrated.count) && integrated.count === primary.count) {
        return {
          ...integrated,
          backend: primary.backend === "highs" ? "highs+rust" : primary.backend === "kernel" ? "kernel+rust" : "rust",
          cardinalityBackend: primary.backend,
          qualityBackend: "rust-quality-integrated",
          qualityExact: true,
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

  if (primaryHard) {
    const refined = refineMinimumCoverQuality(prepared, primary.selected);
    return {
      count: primary.count,
      keys: refined.selected.map((id) => prepared.keys[id]),
      qualityVector: refined.qualityVector,
      searchedStates: primary.searchedStates ?? 0,
      backend: primary.backend,
      cardinalityBackend: primary.backend,
      qualityBackend: "fast-2x2",
      qualityExact: false,
      useHiGHSRequested: requested,
      useHiGHSResolved: primary.backend === "highs",
      minimumCoverKernelCases: kernelStats.cases,
      minimumCoverKernelSolutions: kernelStats.solutions,
      minimumCoverKernelEntries: kernelStats.entries,
      primarySearchedStates: primary.searchedStates ?? 0,
      qualitySearchedStates: 0,
      fastProbeBudget: FAST_EXACT_STATE_BUDGET,
      fastProbeStates: 0,
      fastFallback: true,
      fastDecision: "primary-hard",
      qualityRefinementPasses: refined.passes,
    };
  }

  const budget = Math.max(1, Math.floor(Number(fastStateBudget) || FAST_EXACT_STATE_BUDGET));
  const probe = solver?.minimumCoverAtCount?.(coverage, primary.count, {
    qualityFor, seedKeys: primaryKeys, stateBudget: budget, integrated: true,
  });
  if (probe?.completed && Number.isFinite(probe.count) && probe.count === primary.count) {
    return {
      ...probe,
      backend: primary.backend === "highs" ? "highs+rust" : primary.backend === "kernel" ? "kernel+rust" : "rust",
      cardinalityBackend: primary.backend,
      qualityBackend: "fast-integrated-exact",
      qualityExact: true,
      useHiGHSRequested: requested,
      useHiGHSResolved: primary.backend === "highs",
      minimumCoverKernelCases: kernelStats.cases,
      minimumCoverKernelSolutions: kernelStats.solutions,
      minimumCoverKernelEntries: kernelStats.entries,
      primarySearchedStates: primary.searchedStates ?? 0,
      qualitySearchedStates: probe.searchedStates ?? 0,
      fastProbeBudget: budget,
      fastProbeStates: probe.searchedStates ?? 0,
      fastFallback: false,
      fastDecision: "integrated-exact",
    };
  }

  const fallbackKeys = probe?.keys?.length === primary.count ? probe.keys : primaryKeys;
  const idByKey = new Map(prepared.keys.map((key, id) => [key, id]));
  const fallbackIds = fallbackKeys.map((key) => idByKey.get(key));
  if (fallbackIds.some((id) => id === undefined)) {
    throw new Error("Fast fixed-K probe returned an unknown candidate");
  }
  const refined = refineMinimumCoverQuality(prepared, fallbackIds);
  return {
    count: primary.count,
    keys: refined.selected.map((id) => prepared.keys[id]),
    qualityVector: refined.qualityVector,
    searchedStates: (primary.searchedStates ?? 0) + (probe?.searchedStates ?? 0),
    backend: primary.backend,
    cardinalityBackend: primary.backend,
    qualityBackend: "fast-2x2",
    qualityExact: false,
    useHiGHSRequested: requested,
    useHiGHSResolved: primary.backend === "highs",
    minimumCoverKernelCases: kernelStats.cases,
    minimumCoverKernelSolutions: kernelStats.solutions,
    minimumCoverKernelEntries: kernelStats.entries,
    primarySearchedStates: primary.searchedStates ?? 0,
    qualitySearchedStates: probe?.searchedStates ?? 0,
    fastProbeBudget: budget,
    fastProbeStates: probe?.searchedStates ?? 0,
    fastFallback: true,
    fastDecision: "integrated-budget-exceeded",
    qualityRefinementPasses: refined.passes,
  };
}
