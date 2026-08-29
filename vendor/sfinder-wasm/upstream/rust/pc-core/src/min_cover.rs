use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MinimumCoverResult {
    pub selected: Vec<u32>,
    pub quality: Vec<u32>,
    pub searched_states: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrimaryKernelResult {
    pub cases: Vec<Vec<u32>>,
    pub solution_ids: Vec<u32>,
    pub forced: Vec<u32>,
}

#[inline]
fn words_subset_u64(a: &[u64], b: &[u64]) -> bool {
    a.iter().zip(b).all(|(a, b)| a & !b == 0)
}

/// Exact primary-cardinality kernelization. Secondary quality is intentionally
/// ignored, so callers must restore the original candidate universe before any
/// human-quality optimization.
pub fn exact_primary_cardinality_kernel(
    raw_cases: &[Vec<u32>],
    solution_count: usize,
) -> Option<PrimaryKernelResult> {
    if raw_cases.is_empty() {
        return Some(PrimaryKernelResult {
            cases: Vec::new(),
            solution_ids: (0..solution_count as u32).collect(),
            forced: Vec::new(),
        });
    }
    if solution_count == 0 {
        return None;
    }

    let mut active_cases: Vec<(usize, Vec<u32>)> = Vec::with_capacity(raw_cases.len());
    for (original, row) in raw_cases.iter().enumerate() {
        let mut ids = row.clone();
        ids.sort_unstable();
        ids.dedup();
        if ids.is_empty() || ids.iter().any(|&id| id as usize >= solution_count) {
            return None;
        }
        active_cases.push((original, ids));
    }
    let mut active_solutions = vec![true; solution_count];
    let mut forced = Vec::<u32>::new();
    let mut forced_flag = vec![false; solution_count];

    loop {
        let mut changed = false;
        let mut next_cases = Vec::with_capacity(active_cases.len());
        for (original, row) in active_cases.into_iter() {
            if row.iter().any(|&id| forced_flag[id as usize]) {
                changed = true;
                continue;
            }
            let ids: Vec<u32> = row
                .into_iter()
                .filter(|&id| active_solutions[id as usize])
                .collect();
            if ids.is_empty() {
                return None;
            }
            next_cases.push((original, ids));
        }
        active_cases = next_cases;
        if active_cases.is_empty() {
            break;
        }

        let mut singleton_ids = Vec::new();
        for (_, row) in &active_cases {
            if row.len() == 1 {
                let id = row[0] as usize;
                if active_solutions[id] && !forced_flag[id] {
                    forced_flag[id] = true;
                    singleton_ids.push(id as u32);
                }
            }
        }
        if !singleton_ids.is_empty() {
            singleton_ids.sort_unstable();
            singleton_ids.dedup();
            for id in singleton_ids {
                active_solutions[id as usize] = false;
                forced.push(id);
            }
            continue;
        }

        // Case dominance: retain only inclusion-minimal candidate sets. Rows are
        // processed from smallest to largest, so the first kept subset proves a
        // later row redundant.
        let solution_words = solution_count.div_ceil(64);
        let mut masks = vec![vec![0u64; solution_words]; active_cases.len()];
        for (case, (_, row)) in active_cases.iter().enumerate() {
            for &id in row {
                set_bit(&mut masks[case], id as usize);
            }
        }
        let mut order: Vec<usize> = (0..active_cases.len()).collect();
        order.sort_unstable_by_key(|&case| (active_cases[case].1.len(), active_cases[case].0));
        let mut keep = vec![false; active_cases.len()];
        let mut kept = Vec::<usize>::new();
        for case in order {
            let dominated = kept
                .iter()
                .copied()
                .any(|prior| words_subset_u64(&masks[prior], &masks[case]));
            if dominated {
                changed = true;
            } else {
                keep[case] = true;
                kept.push(case);
            }
        }
        if changed {
            active_cases = active_cases
                .into_iter()
                .enumerate()
                .filter_map(|(index, entry)| keep[index].then_some(entry))
                .collect();
        }

        // Candidate dominance on the remaining primary cases.
        let case_words = active_cases.len().div_ceil(64);
        let mut coverage = vec![vec![0u64; case_words]; solution_count];
        for (case, (_, row)) in active_cases.iter().enumerate() {
            for &id in row {
                if active_solutions[id as usize] {
                    set_bit(&mut coverage[id as usize], case);
                }
            }
        }
        let active_ids: Vec<usize> = (0..solution_count)
            .filter(|&id| active_solutions[id] && coverage[id].iter().any(|&word| word != 0))
            .collect();
        let mut remove = vec![false; solution_count];
        for &a in &active_ids {
            if remove[a] {
                continue;
            }
            for &b in &active_ids {
                if a == b || remove[b] {
                    continue;
                }
                if words_subset_u64(&coverage[a], &coverage[b])
                    && (coverage[a] != coverage[b] || a > b)
                {
                    remove[a] = true;
                    break;
                }
            }
        }
        for id in 0..solution_count {
            if active_solutions[id] && coverage[id].iter().all(|&word| word == 0) {
                remove[id] = true;
            }
        }
        if remove.iter().any(|&value| value) {
            for id in 0..solution_count {
                if remove[id] {
                    active_solutions[id] = false;
                }
            }
            changed = true;
        }

        if !changed {
            break;
        }
    }

    forced.sort_unstable();
    forced.dedup();
    let solution_ids: Vec<u32> = (0..solution_count)
        .filter(|&id| active_solutions[id])
        .map(|id| id as u32)
        .collect();
    let mut remap = vec![usize::MAX; solution_count];
    for (local, &original) in solution_ids.iter().enumerate() {
        remap[original as usize] = local;
    }
    let mut cases = Vec::with_capacity(active_cases.len());
    for (_, row) in active_cases {
        let ids: Vec<u32> = row
            .into_iter()
            .filter(|&id| active_solutions[id as usize])
            .map(|id| remap[id as usize] as u32)
            .collect();
        if ids.is_empty() {
            return None;
        }
        cases.push(ids);
    }
    Some(PrimaryKernelResult {
        cases,
        solution_ids,
        forced,
    })
}

#[inline]
fn subset_sorted(a: &[(u32, u32)], b: &[(u32, u32)]) -> bool {
    // Candidate IDs are sorted and unique. Quality is ignored for cardinality.
    if a.len() > b.len() {
        return false;
    }
    let mut j = 0usize;
    for &(id, _) in a {
        while j < b.len() && b[j].0 < id {
            j += 1;
        }
        if j == b.len() || b[j].0 != id {
            return false;
        }
    }
    true
}

#[inline]
fn bit_is_set(words: &[u64], index: usize) -> bool {
    words[index >> 6] & (1u64 << (index & 63)) != 0
}

#[inline]
fn set_bit(words: &mut [u64], index: usize) {
    words[index >> 6] |= 1u64 << (index & 63);
}

#[inline]
fn or_into(dst: &mut [u64], src: &[u64]) {
    for (d, s) in dst.iter_mut().zip(src) {
        *d |= *s;
    }
}

#[inline]
fn is_full(covered: &[u64], full: &[u64]) -> bool {
    covered.iter().zip(full).all(|(a, b)| a == b)
}

#[inline]
fn uncovered_count(covered: &[u64], full: &[u64]) -> u32 {
    covered
        .iter()
        .zip(full)
        .map(|(a, b)| (b & !a).count_ones())
        .sum()
}

#[inline]
fn gain(coverage: &[u64], covered: &[u64], full: &[u64]) -> u32 {
    coverage
        .iter()
        .zip(covered)
        .zip(full)
        .map(|((s, c), f)| (s & (f & !c)).count_ones())
        .sum()
}

fn lower_bound(covered: &[u64], full: &[u64], solution_coverage: &[Vec<u64>]) -> usize {
    let remaining = uncovered_count(covered, full) as usize;
    if remaining == 0 {
        return 0;
    }
    let max_gain = solution_coverage
        .iter()
        .map(|s| gain(s, covered, full) as usize)
        .max()
        .unwrap_or(0);
    if max_gain == 0 {
        usize::MAX
    } else {
        remaining.div_ceil(max_gain)
    }
}

fn choose_case(covered: &[u64], full: &[u64], case_candidates: &[Vec<u32>]) -> Option<usize> {
    let mut best = None;
    let mut best_count = usize::MAX;
    for (case, candidates) in case_candidates.iter().enumerate() {
        if bit_is_set(full, case) && !bit_is_set(covered, case) {
            let count = candidates.len();
            if count < best_count {
                best = Some(case);
                best_count = count;
                if count <= 1 {
                    break;
                }
            }
        }
    }
    best
}

fn greedy_cover(full: &[u64], solution_coverage: &[Vec<u64>]) -> Option<Vec<u32>> {
    let mut covered = vec![0u64; full.len()];
    let mut selected = Vec::new();
    while !is_full(&covered, full) {
        let mut best = None;
        let mut best_gain = 0u32;
        for (solution, coverage) in solution_coverage.iter().enumerate() {
            let current_gain = gain(coverage, &covered, full);
            if current_gain > best_gain {
                best = Some(solution);
                best_gain = current_gain;
            }
        }
        let solution = best?;
        if best_gain == 0 {
            return None;
        }
        selected.push(solution as u32);
        or_into(&mut covered, &solution_coverage[solution]);
    }
    Some(selected)
}

struct CardinalitySearch<'a> {
    full: &'a [u64],
    case_candidates: &'a [Vec<u32>],
    solution_coverage: &'a [Vec<u64>],
    best_count: usize,
    best_selected: Vec<u32>,
    best_depth_by_covered: HashMap<Vec<u64>, usize>,
    searched_states: u64,
}

impl CardinalitySearch<'_> {
    fn run(&mut self, covered: Vec<u64>, selected: &mut Vec<u32>) {
        self.searched_states += 1;
        let depth = selected.len();
        if is_full(&covered, self.full) {
            if depth < self.best_count {
                self.best_count = depth;
                self.best_selected = selected.clone();
                self.best_selected.sort_unstable();
            }
            return;
        }
        if depth >= self.best_count {
            return;
        }
        if let Some(&previous) = self.best_depth_by_covered.get(&covered)
            && previous <= depth
        {
            return;
        }
        self.best_depth_by_covered.insert(covered.clone(), depth);
        let bound = lower_bound(&covered, self.full, self.solution_coverage);
        if bound == usize::MAX || depth.saturating_add(bound) >= self.best_count {
            return;
        }
        let Some(case) = choose_case(&covered, self.full, self.case_candidates) else {
            return;
        };
        let mut branches: Vec<(u32, u32)> = self.case_candidates[case]
            .iter()
            .copied()
            .map(|solution| {
                let g = gain(
                    &self.solution_coverage[solution as usize],
                    &covered,
                    self.full,
                );
                (solution, g)
            })
            .collect();
        branches.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        for (solution, _) in branches {
            let mut next = covered.clone();
            or_into(&mut next, &self.solution_coverage[solution as usize]);
            selected.push(solution);
            self.run(next, selected);
            selected.pop();
        }
    }
}

fn quality_vector(
    raw_cases: &[Vec<(u32, u32)>],
    selected: &[u32],
    solution_count: usize,
) -> Vec<u32> {
    let mut chosen = vec![false; solution_count];
    for &solution in selected {
        chosen[solution as usize] = true;
    }
    let mut scores = Vec::with_capacity(raw_cases.len());
    for case in raw_cases {
        let mut best = 0u32;
        for &(solution, quality) in case {
            if chosen[solution as usize] {
                best = best.max(quality);
            }
        }
        scores.push(best);
    }
    scores.sort_unstable();
    scores
}

#[inline]
fn quality_better(candidate: &[u32], current: Option<&[u32]>) -> bool {
    let Some(current) = current else {
        return true;
    };
    for (a, b) in candidate.iter().zip(current) {
        if a != b {
            return a > b;
        }
    }
    false
}

struct BestSetSearch<'a> {
    full: &'a [u64],
    case_candidates: &'a [Vec<u32>],
    solution_coverage: &'a [Vec<u64>],
    raw_cases: &'a [Vec<(u32, u32)>],
    solution_count: usize,
    best_count: usize,
    completed: HashSet<Vec<u32>>,
    best_selected: Option<Vec<u32>>,
    best_quality: Option<Vec<u32>>,
    searched_states: u64,
    state_budget: Option<u64>,
    budget_exceeded: bool,
}

impl BestSetSearch<'_> {
    fn consider(&mut self, selected: &[u32]) {
        let mut stable = selected.to_vec();
        stable.sort_unstable();
        if !self.completed.insert(stable.clone()) {
            return;
        }
        let quality = quality_vector(self.raw_cases, &stable, self.solution_count);
        let replace = quality_better(&quality, self.best_quality.as_deref())
            || (self.best_quality.as_deref() == Some(quality.as_slice())
                && self
                    .best_selected
                    .as_deref()
                    .is_none_or(|current| stable.as_slice() < current));
        if replace {
            self.best_selected = Some(stable);
            self.best_quality = Some(quality);
        }
    }

    fn run(&mut self, covered: Vec<u64>, selected: &mut Vec<u32>) {
        if self.budget_exceeded {
            return;
        }
        if self
            .state_budget
            .is_some_and(|budget| self.searched_states >= budget)
        {
            self.budget_exceeded = true;
            return;
        }
        self.searched_states += 1;
        if is_full(&covered, self.full) {
            if selected.len() == self.best_count {
                self.consider(selected);
            }
            return;
        }
        if selected.len() >= self.best_count {
            return;
        }
        let bound = lower_bound(&covered, self.full, self.solution_coverage);
        if bound == usize::MAX || selected.len().saturating_add(bound) > self.best_count {
            return;
        }
        let Some(case) = choose_case(&covered, self.full, self.case_candidates) else {
            return;
        };
        let mut branches: Vec<(u32, u32)> = self.case_candidates[case]
            .iter()
            .copied()
            .map(|solution| {
                let g = gain(
                    &self.solution_coverage[solution as usize],
                    &covered,
                    self.full,
                );
                (solution, g)
            })
            .collect();
        branches.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        for (solution, _) in branches {
            if selected.contains(&solution) {
                continue;
            }
            let mut next = covered.clone();
            or_into(&mut next, &self.solution_coverage[solution as usize]);
            selected.push(solution);
            self.run(next, selected);
            selected.pop();
        }
    }
}

/// Exact minimum-cardinality set cover without secondary quality enumeration.
///
/// This is intended for callers that only require an exact K and one
/// deterministic K-cover seed. Quality values in `raw_cases` are ignored.
pub fn exact_minimum_cardinality_cover(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
) -> Option<MinimumCoverResult> {
    if raw_cases.is_empty() {
        return Some(MinimumCoverResult {
            selected: Vec::new(),
            quality: Vec::new(),
            searched_states: 0,
        });
    }
    if solution_count == 0 || raw_cases.iter().any(Vec::is_empty) {
        return None;
    }

    let mut normalized = Vec::with_capacity(raw_cases.len());
    for case in raw_cases {
        let mut ids: Vec<(u32, u32)> = case.iter().map(|&(solution, _)| (solution, 0)).collect();
        ids.sort_unstable_by_key(|x| x.0);
        ids.dedup_by_key(|x| x.0);
        if ids
            .iter()
            .any(|&(solution, _)| solution as usize >= solution_count)
            || ids.is_empty()
        {
            return None;
        }
        normalized.push(ids);
    }

    let mut active = vec![true; normalized.len()];
    let mut order: Vec<usize> = (0..normalized.len()).collect();
    order.sort_unstable_by_key(|&i| (normalized[i].len(), i));
    for ai in 0..order.len() {
        let a = order[ai];
        if !active[a] {
            continue;
        }
        for &b in &order[ai + 1..] {
            if active[b] && subset_sorted(&normalized[a], &normalized[b]) {
                active[b] = false;
            }
        }
    }

    let active_original: Vec<usize> = (0..normalized.len()).filter(|&i| active[i]).collect();
    let active_count = active_original.len();
    let words = active_count.div_ceil(64);
    let mut full = vec![u64::MAX; words];
    if let Some(last) = full.last_mut() {
        let rem = active_count & 63;
        if rem != 0 {
            *last = (1u64 << rem) - 1;
        }
    }
    let mut case_candidates = Vec::with_capacity(active_count);
    let mut solution_coverage = vec![vec![0u64; words]; solution_count];
    for (active_case, &original_case) in active_original.iter().enumerate() {
        let ids: Vec<u32> = normalized[original_case].iter().map(|x| x.0).collect();
        for &solution in &ids {
            set_bit(&mut solution_coverage[solution as usize], active_case);
        }
        case_candidates.push(ids);
    }

    let greedy = greedy_cover(&full, &solution_coverage)?;
    let mut greedy_stable = greedy.clone();
    greedy_stable.sort_unstable();
    let mut search = CardinalitySearch {
        full: &full,
        case_candidates: &case_candidates,
        solution_coverage: &solution_coverage,
        best_count: greedy.len(),
        best_selected: greedy_stable,
        best_depth_by_covered: HashMap::new(),
        searched_states: 0,
    };
    search.run(vec![0u64; words], &mut Vec::new());
    Some(MinimumCoverResult {
        selected: search.best_selected,
        quality: Vec::new(),
        searched_states: search.searched_states,
    })
}

/// Exact minimum set cover with a secondary maximin-style quality objective.
///
/// `raw_cases[case]` contains `(solution_id, quality)` pairs. Candidate IDs must
/// be in `0..solution_count`. The primary objective is minimum cardinality.
/// Among equal-cardinality covers, each case receives the best quality offered
/// by the selected solutions; these per-case scores are sorted ascending and
/// maximized lexicographically, so the worst-covered case improves first.
pub fn exact_minimum_cover(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
) -> Option<MinimumCoverResult> {
    if raw_cases.is_empty() {
        return Some(MinimumCoverResult {
            selected: Vec::new(),
            quality: Vec::new(),
            searched_states: 0,
        });
    }
    if solution_count == 0 || raw_cases.iter().any(Vec::is_empty) {
        return None;
    }

    let mut normalized = Vec::with_capacity(raw_cases.len());
    for case in raw_cases {
        let mut rows = case.clone();
        rows.sort_unstable_by_key(|x| x.0);
        let mut deduped: Vec<(u32, u32)> = Vec::with_capacity(rows.len());
        for (solution, quality) in rows {
            if solution as usize >= solution_count {
                return None;
            }
            if let Some(last) = deduped.last_mut()
                && last.0 == solution
            {
                last.1 = last.1.max(quality);
            } else {
                deduped.push((solution, quality));
            }
        }
        if deduped.is_empty() {
            return None;
        }
        normalized.push(deduped);
    }

    // A case whose candidate set is a superset of another case is redundant
    // for the primary cardinality search. It is retained in `normalized` for
    // the secondary per-case human-quality objective.
    let mut active = vec![true; normalized.len()];
    let mut order: Vec<usize> = (0..normalized.len()).collect();
    order.sort_unstable_by_key(|&i| (normalized[i].len(), i));
    for ai in 0..order.len() {
        let a = order[ai];
        if !active[a] {
            continue;
        }
        for &b in &order[ai + 1..] {
            if active[b] && subset_sorted(&normalized[a], &normalized[b]) {
                active[b] = false;
            }
        }
    }

    let active_original: Vec<usize> = (0..normalized.len()).filter(|&i| active[i]).collect();
    let active_count = active_original.len();
    let words = active_count.div_ceil(64);
    let mut full = vec![u64::MAX; words];
    if let Some(last) = full.last_mut() {
        let rem = active_count & 63;
        if rem != 0 {
            *last = (1u64 << rem) - 1;
        }
    }

    let mut case_candidates = Vec::with_capacity(active_count);
    let mut solution_coverage = vec![vec![0u64; words]; solution_count];
    for (active_case, &original_case) in active_original.iter().enumerate() {
        let ids: Vec<u32> = normalized[original_case].iter().map(|x| x.0).collect();
        for &solution in &ids {
            set_bit(&mut solution_coverage[solution as usize], active_case);
        }
        case_candidates.push(ids);
    }

    let greedy = greedy_cover(&full, &solution_coverage)?;
    let mut greedy_stable = greedy.clone();
    greedy_stable.sort_unstable();
    let mut cardinality = CardinalitySearch {
        full: &full,
        case_candidates: &case_candidates,
        solution_coverage: &solution_coverage,
        best_count: greedy.len(),
        best_selected: greedy_stable,
        best_depth_by_covered: HashMap::new(),
        searched_states: 0,
    };
    cardinality.run(vec![0u64; words], &mut Vec::new());

    let mut best_search = BestSetSearch {
        full: &full,
        case_candidates: &case_candidates,
        solution_coverage: &solution_coverage,
        raw_cases: &normalized,
        solution_count,
        best_count: cardinality.best_count,
        completed: HashSet::new(),
        best_selected: None,
        best_quality: None,
        searched_states: 0,
        state_budget: None,
        budget_exceeded: false,
    };
    best_search.run(vec![0u64; words], &mut Vec::new());

    let selected = best_search.best_selected.or_else(|| {
        if greedy.len() == cardinality.best_count {
            let mut fallback = greedy;
            fallback.sort_unstable();
            Some(fallback)
        } else {
            None
        }
    })?;
    let quality = best_search
        .best_quality
        .unwrap_or_else(|| quality_vector(&normalized, &selected, solution_count));

    Some(MinimumCoverResult {
        selected,
        quality,
        searched_states: cardinality.searched_states + best_search.searched_states,
    })
}

/// Optimize the legacy human-quality objective at an already-proven exact
/// cardinality using the same integrated BestSetSearch as `exact_minimum_cover`.
/// This deliberately skips the cardinality B&B; for ordinary workloads its
/// search tree therefore matches the canonical secondary search while starting
/// with K already known.
pub fn exact_quality_cover_at_count_integrated_bounded(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
    exact_count: usize,
    seed_selected: &[u32],
    state_budget: Option<u64>,
) -> Option<BoundedQualityResult> {
    if raw_cases.is_empty() {
        let result = MinimumCoverResult {
            selected: Vec::new(),
            quality: Vec::new(),
            searched_states: 0,
        };
        return (exact_count == 0).then_some(BoundedQualityResult::Exact(result));
    }
    if solution_count == 0 || exact_count == 0 || seed_selected.len() != exact_count {
        return None;
    }

    let normalized = normalize_quality_cases(raw_cases, solution_count)?;
    let mut seed = seed_selected.to_vec();
    seed.sort_unstable();
    seed.dedup();
    if seed.len() != exact_count || seed.iter().any(|&id| id as usize >= solution_count) {
        return None;
    }

    // Primary case dominance is safe here exactly as in the canonical solver:
    // redundant cases are dropped only from the coverage proof, while all raw
    // cases remain in `normalized` for the secondary quality vector.
    let mut active = vec![true; normalized.len()];
    let mut order: Vec<usize> = (0..normalized.len()).collect();
    order.sort_unstable_by_key(|&i| (normalized[i].len(), i));
    for ai in 0..order.len() {
        let a = order[ai];
        if !active[a] {
            continue;
        }
        for &b in &order[ai + 1..] {
            if active[b] && subset_sorted(&normalized[a], &normalized[b]) {
                active[b] = false;
            }
        }
    }

    let active_original: Vec<usize> = (0..normalized.len()).filter(|&i| active[i]).collect();
    let words = active_original.len().div_ceil(64);
    let mut full = vec![u64::MAX; words];
    if let Some(last) = full.last_mut() {
        let rem = active_original.len() & 63;
        if rem != 0 {
            *last = (1u64 << rem) - 1;
        }
    }
    let mut case_candidates = Vec::with_capacity(active_original.len());
    let mut solution_coverage = vec![vec![0u64; words]; solution_count];
    for (active_case, &original_case) in active_original.iter().enumerate() {
        let ids: Vec<u32> = normalized[original_case].iter().map(|x| x.0).collect();
        for &solution in &ids {
            set_bit(&mut solution_coverage[solution as usize], active_case);
        }
        case_candidates.push(ids);
    }

    // The supplied seed must prove that this K is feasible on the full primary
    // problem.  K optimality itself is the caller's responsibility (the primary
    // backend has already proven it).
    let mut seed_covered = vec![0u64; words];
    for &solution in &seed {
        or_into(&mut seed_covered, &solution_coverage[solution as usize]);
    }
    if !is_full(&seed_covered, &full) {
        return None;
    }

    let seed_quality = quality_vector(&normalized, &seed, solution_count);
    let mut completed = HashSet::new();
    completed.insert(seed.clone());
    let mut search = BestSetSearch {
        full: &full,
        case_candidates: &case_candidates,
        solution_coverage: &solution_coverage,
        raw_cases: &normalized,
        solution_count,
        best_count: exact_count,
        completed,
        best_selected: Some(seed.clone()),
        best_quality: Some(seed_quality.clone()),
        searched_states: 0,
        state_budget,
        budget_exceeded: false,
    };
    search.run(vec![0u64; words], &mut Vec::new());

    let selected = search.best_selected.unwrap_or(seed);
    let quality = search
        .best_quality
        .unwrap_or_else(|| quality_vector(&normalized, &selected, solution_count));
    let result = MinimumCoverResult {
        selected,
        quality,
        searched_states: search.searched_states,
    };
    Some(if search.budget_exceeded {
        BoundedQualityResult::BudgetExceeded(result)
    } else {
        BoundedQualityResult::Exact(result)
    })
}

pub fn exact_quality_cover_at_count_integrated(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
    exact_count: usize,
    seed_selected: &[u32],
) -> Option<MinimumCoverResult> {
    match exact_quality_cover_at_count_integrated_bounded(
        raw_cases,
        solution_count,
        exact_count,
        seed_selected,
        None,
    )? {
        BoundedQualityResult::Exact(result) => Some(result),
        BoundedQualityResult::BudgetExceeded(_) => unreachable!(),
    }
}

#[derive(Clone, Debug)]
struct QualityThresholdData {
    weights: Vec<u32>,
    group_candidates: Vec<Vec<u32>>,
    candidate_groups: Vec<Vec<u32>>,
    candidate_group_bits: Vec<Vec<u64>>,
    total_weight: u32,
}

impl QualityThresholdData {
    fn build(cases: &[Vec<(u32, u32)>], solution_count: usize, threshold: u32) -> Self {
        let mut grouped: HashMap<Vec<u32>, u32> = HashMap::new();
        for row in cases {
            let mut ids: Vec<u32> = row
                .iter()
                .filter_map(|&(id, quality)| (quality >= threshold).then_some(id))
                .collect();
            ids.sort_unstable();
            ids.dedup();
            *grouped.entry(ids).or_insert(0) += 1;
        }
        let mut entries: Vec<(Vec<u32>, u32)> = grouped.into_iter().collect();
        entries.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let group_count = entries.len();
        let group_words = group_count.div_ceil(64);
        let mut weights = Vec::with_capacity(group_count);
        let mut group_candidates = Vec::with_capacity(group_count);
        let mut candidate_groups = vec![Vec::new(); solution_count];
        let mut candidate_group_bits = vec![vec![0u64; group_words]; solution_count];
        let mut total_weight = 0u32;
        for (group, (ids, weight)) in entries.into_iter().enumerate() {
            weights.push(weight);
            total_weight += weight;
            for &id in &ids {
                candidate_groups[id as usize].push(group as u32);
                set_bit(&mut candidate_group_bits[id as usize], group);
            }
            group_candidates.push(ids);
        }
        Self {
            weights,
            group_candidates,
            candidate_groups,
            candidate_group_bits,
            total_weight,
        }
    }
}

#[derive(Clone, Debug)]
struct QualityThresholdState {
    cover_count: Vec<u16>,
    available_count: Vec<u16>,
    gains: Vec<u32>,
    good: u32,
    dead_bad: u32,
}

impl QualityThresholdState {
    fn new(data: &QualityThresholdData, solution_count: usize) -> Self {
        let mut gains = vec![0u32; solution_count];
        let mut available_count = Vec::with_capacity(data.weights.len());
        let mut dead_bad = 0u32;
        for (group, candidates) in data.group_candidates.iter().enumerate() {
            available_count.push(candidates.len() as u16);
            if candidates.is_empty() {
                dead_bad += data.weights[group];
            }
            let weight = data.weights[group];
            for &candidate in candidates {
                gains[candidate as usize] += weight;
            }
        }
        Self {
            cover_count: vec![0u16; data.weights.len()],
            available_count,
            gains,
            good: 0,
            dead_bad,
        }
    }

    fn disable_candidate(&mut self, data: &QualityThresholdData, solution: usize) {
        for &group in &data.candidate_groups[solution] {
            let group = group as usize;
            debug_assert!(self.available_count[group] > 0);
            if self.cover_count[group] == 0 && self.available_count[group] == 1 {
                self.dead_bad += data.weights[group];
            }
            self.available_count[group] -= 1;
        }
    }

    fn enable_candidate(&mut self, data: &QualityThresholdData, solution: usize) {
        for &group in &data.candidate_groups[solution] {
            let group = group as usize;
            if self.cover_count[group] == 0 && self.available_count[group] == 0 {
                self.dead_bad -= data.weights[group];
            }
            self.available_count[group] += 1;
        }
    }

    fn add(&mut self, data: &QualityThresholdData, solution: usize) {
        self.disable_candidate(data, solution);
        for &group in &data.candidate_groups[solution] {
            let group = group as usize;
            if self.cover_count[group] == 0 {
                let weight = data.weights[group];
                if self.available_count[group] == 0 {
                    self.dead_bad -= weight;
                }
                self.good += weight;
                for &candidate in &data.group_candidates[group] {
                    self.gains[candidate as usize] -= weight;
                }
            }
            self.cover_count[group] += 1;
        }
    }

    fn remove(&mut self, data: &QualityThresholdData, solution: usize) {
        for &group in &data.candidate_groups[solution] {
            let group = group as usize;
            self.cover_count[group] -= 1;
            if self.cover_count[group] == 0 {
                let weight = data.weights[group];
                self.good -= weight;
                for &candidate in &data.group_candidates[group] {
                    self.gains[candidate as usize] += weight;
                }
                if self.available_count[group] == 0 {
                    self.dead_bad += weight;
                }
            }
        }
        self.enable_candidate(data, solution);
    }
}

#[inline]
fn words_subset(a: &[u64], b: &[u64]) -> bool {
    a.iter().zip(b).all(|(a, b)| a & !b == 0)
}

fn normalize_quality_cases(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
) -> Option<Vec<Vec<(u32, u32)>>> {
    let mut normalized = Vec::with_capacity(raw_cases.len());
    for case in raw_cases {
        let mut rows = case.clone();
        rows.sort_unstable_by_key(|row| row.0);
        let mut deduped: Vec<(u32, u32)> = Vec::with_capacity(rows.len());
        for (solution, quality) in rows {
            if solution as usize >= solution_count {
                return None;
            }
            if let Some(last) = deduped.last_mut()
                && last.0 == solution
            {
                last.1 = last.1.max(quality);
            } else {
                deduped.push((solution, quality));
            }
        }
        if deduped.is_empty() {
            return None;
        }
        normalized.push(deduped);
    }
    Some(normalized)
}

fn full_primary_coverage(cases: &[Vec<(u32, u32)>], solution_count: usize) -> Vec<Vec<u64>> {
    let words = cases.len().div_ceil(64);
    let mut coverage = vec![vec![0u64; words]; solution_count];
    for (case, row) in cases.iter().enumerate() {
        for &(solution, _) in row {
            set_bit(&mut coverage[solution as usize], case);
        }
    }
    coverage
}

fn threshold_static_active_candidates(
    primary_coverage: &[Vec<u64>],
    threshold_data: &[QualityThresholdData],
    through: usize,
    stable_tie: bool,
) -> Vec<bool> {
    let solution_count = primary_coverage.len();
    let mut active = vec![true; solution_count];
    for a in 0..solution_count {
        if primary_coverage[a].iter().all(|&word| word == 0) {
            active[a] = false;
            continue;
        }
        for b in 0..solution_count {
            if a == b || !words_subset(&primary_coverage[a], &primary_coverage[b]) {
                continue;
            }
            let mut dominates = true;
            let mut strict = primary_coverage[a] != primary_coverage[b];
            for data in &threshold_data[..=through] {
                let a_bits = &data.candidate_group_bits[a];
                let b_bits = &data.candidate_group_bits[b];
                if !words_subset(a_bits, b_bits) {
                    dominates = false;
                    break;
                }
                strict |= a_bits != b_bits;
            }
            if dominates && ((!stable_tie && strict) || b < a) {
                active[a] = false;
                break;
            }
        }
    }
    active
}

type PrimaryKernel = (Vec<u64>, Vec<Vec<u32>>, Vec<Vec<u64>>);

fn kernelize_primary_for_candidates(
    cases: &[Vec<(u32, u32)>],
    solution_count: usize,
    active_candidate: &[bool],
) -> Option<PrimaryKernel> {
    let mut rows: Vec<Vec<u32>> = Vec::with_capacity(cases.len());
    for row in cases {
        let mut ids: Vec<u32> = row
            .iter()
            .filter_map(|&(id, _)| active_candidate[id as usize].then_some(id))
            .collect();
        ids.sort_unstable();
        ids.dedup();
        if ids.is_empty() {
            return None;
        }
        rows.push(ids);
    }

    let mut active_case = vec![true; rows.len()];
    let mut order: Vec<usize> = (0..rows.len()).collect();
    order.sort_unstable_by_key(|&case| (rows[case].len(), case));
    for ai in 0..order.len() {
        let a = order[ai];
        if !active_case[a] {
            continue;
        }
        for &b in &order[ai + 1..] {
            if active_case[b] && rows[a].iter().all(|id| rows[b].binary_search(id).is_ok()) {
                active_case[b] = false;
            }
        }
    }

    let kept: Vec<usize> = (0..rows.len()).filter(|&case| active_case[case]).collect();
    let words = kept.len().div_ceil(64);
    let mut full = vec![u64::MAX; words];
    if let Some(last) = full.last_mut() {
        let rem = kept.len() & 63;
        if rem != 0 {
            *last = (1u64 << rem) - 1;
        }
    }
    let mut case_candidates = Vec::with_capacity(kept.len());
    let mut solution_coverage = vec![vec![0u64; words]; solution_count];
    for (active_case_index, &case) in kept.iter().enumerate() {
        for &solution in &rows[case] {
            set_bit(&mut solution_coverage[solution as usize], active_case_index);
        }
        case_candidates.push(rows[case].clone());
    }
    Some((full, case_candidates, solution_coverage))
}

#[inline]
fn available_candidate(id: usize, selected: &[bool], excluded: &[bool]) -> bool {
    !selected[id] && !excluded[id]
}

fn choose_available_case(
    covered: &[u64],
    full: &[u64],
    case_candidates: &[Vec<u32>],
    selected: &[bool],
    excluded: &[bool],
) -> Option<(usize, usize)> {
    let mut best = None;
    let mut best_count = usize::MAX;
    for (case, candidates) in case_candidates.iter().enumerate() {
        if !bit_is_set(full, case) || bit_is_set(covered, case) {
            continue;
        }
        let count = candidates
            .iter()
            .filter(|&&id| available_candidate(id as usize, selected, excluded))
            .count();
        if count < best_count {
            best = Some(case);
            best_count = count;
            if count <= 1 {
                break;
            }
        }
    }
    best.map(|case| (case, best_count))
}

fn available_primary_lower_bound(
    covered: &[u64],
    full: &[u64],
    solution_coverage: &[Vec<u64>],
    selected: &[bool],
    excluded: &[bool],
) -> usize {
    let remaining = uncovered_count(covered, full) as usize;
    if remaining == 0 {
        return 0;
    }
    let mut max_gain = 0usize;
    for (solution, coverage) in solution_coverage.iter().enumerate() {
        if available_candidate(solution, selected, excluded) {
            max_gain = max_gain.max(gain(coverage, covered, full) as usize);
        }
    }
    if max_gain == 0 {
        usize::MAX
    } else {
        remaining.div_ceil(max_gain)
    }
}

fn top_available_gain_sum(
    gains: &[u32],
    selected: &[bool],
    excluded: &[bool],
    slots: usize,
) -> u32 {
    if slots == 0 {
        return 0;
    }
    if slots <= 64 {
        let mut top = [0u32; 64];
        for (id, &value) in gains.iter().enumerate() {
            if !available_candidate(id, selected, excluded) {
                continue;
            }
            if value <= top[slots - 1] {
                continue;
            }
            let mut at = slots - 1;
            while at > 0 && value > top[at - 1] {
                top[at] = top[at - 1];
                at -= 1;
            }
            top[at] = value;
        }
        top[..slots].iter().sum()
    } else {
        gains
            .iter()
            .enumerate()
            .filter(|(id, _)| available_candidate(*id, selected, excluded))
            .map(|(_, &gain)| gain)
            .sum()
    }
}

fn pair_overlap_weight(
    data: &QualityThresholdData,
    state: &QualityThresholdState,
    a: usize,
    b: usize,
) -> u32 {
    let (small, other) = if data.candidate_groups[a].len() <= data.candidate_groups[b].len() {
        (a, b)
    } else {
        (b, a)
    };
    let mut overlap = 0u32;
    for &group in &data.candidate_groups[small] {
        let group = group as usize;
        if state.cover_count[group] == 0 && bit_is_set(&data.candidate_group_bits[other], group) {
            overlap += data.weights[group];
        }
    }
    overlap
}

fn exact_pair_gain_bound(
    data: &QualityThresholdData,
    state: &QualityThresholdState,
    selected: &[bool],
    excluded: &[bool],
) -> u32 {
    let mut candidates: Vec<usize> = (0..state.gains.len())
        .filter(|&id| available_candidate(id, selected, excluded) && state.gains[id] > 0)
        .collect();
    candidates.sort_unstable_by(|&a, &b| state.gains[b].cmp(&state.gains[a]).then(a.cmp(&b)));
    if candidates.is_empty() {
        return 0;
    }
    if candidates.len() == 1 {
        return state.gains[candidates[0]];
    }
    let mut best = state.gains[candidates[0]];
    for i in 0..candidates.len() {
        let a = candidates[i];
        if state.gains[a].saturating_add(state.gains[candidates[0]]) <= best {
            break;
        }
        for &b in &candidates[i + 1..] {
            let sum = state.gains[a].saturating_add(state.gains[b]);
            if sum <= best {
                break;
            }
            best = best.max(sum.saturating_sub(pair_overlap_weight(data, state, a, b)));
        }
    }
    best
}

fn optimistic_quality_gain(
    data: &QualityThresholdData,
    state: &QualityThresholdState,
    selected: &[bool],
    excluded: &[bool],
    slots: usize,
) -> u32 {
    if slots == 0 {
        return 0;
    }
    let reachable_bad = data
        .total_weight
        .saturating_sub(state.good)
        .saturating_sub(state.dead_bad);
    let simple = top_available_gain_sum(&state.gains, selected, excluded, slots).min(reachable_bad);
    if slots == 1 {
        return simple;
    }
    if slots <= 4 {
        let pair = exact_pair_gain_bound(data, state, selected, excluded);
        let single = top_available_gain_sum(&state.gains, selected, excluded, 1);
        let pair_sum = (slots / 2) as u32 * pair + (slots % 2) as u32 * single;
        return simple.min(pair_sum.min(reachable_bad));
    }
    simple
}

struct DynamicDominanceContext<'a> {
    branches: &'a [u32],
    covered: &'a [u64],
    solution_coverage: &'a [Vec<u64>],
    threshold_data: &'a [QualityThresholdData],
    states: &'a [QualityThresholdState],
    selected: &'a [bool],
    excluded: &'a [bool],
    stable_tie: bool,
}

fn dynamic_branch_dominated(a: usize, context: &DynamicDominanceContext<'_>) -> bool {
    'candidate: for &b_raw in context.branches {
        let b = b_raw as usize;
        if b == a || !available_candidate(b, context.selected, context.excluded) {
            continue;
        }
        // During intermediate threshold proofs stable IDs are irrelevant, so
        // any strict dominator is safe. During the final threshold (where the
        // legacy stable-ID tie is resolved), only a lower-ID replacement is
        // allowed.
        if context.stable_tie && b >= a {
            continue;
        }
        let mut strict = false;
        for word in 0..context.covered.len() {
            let a_need = context.solution_coverage[a][word] & !context.covered[word];
            let b_need = context.solution_coverage[b][word] & !context.covered[word];
            if a_need & !b_need != 0 {
                continue 'candidate;
            }
            strict |= b_need & !a_need != 0;
        }
        for (data, state) in context.threshold_data.iter().zip(context.states) {
            for &group in &data.candidate_groups[a] {
                let group = group as usize;
                if state.cover_count[group] == 0
                    && !bit_is_set(&data.candidate_group_bits[b], group)
                {
                    continue 'candidate;
                }
            }
            if !strict {
                for &group in &data.candidate_groups[b] {
                    let group = group as usize;
                    if state.cover_count[group] == 0
                        && !bit_is_set(&data.candidate_group_bits[a], group)
                    {
                        strict = true;
                        break;
                    }
                }
            }
        }
        if strict || b < a {
            return true;
        }
    }
    false
}

fn threshold_count_for_selected(
    cases: &[Vec<(u32, u32)>],
    selected: &[u32],
    threshold: u32,
    solution_count: usize,
) -> u32 {
    let mut chosen = vec![false; solution_count];
    for &id in selected {
        chosen[id as usize] = true;
    }
    cases
        .iter()
        .filter(|case| {
            case.iter()
                .any(|&(id, q)| q >= threshold && chosen[id as usize])
        })
        .count() as u32
}

fn optimistic_lex_completion(
    selected_ids: &[u32],
    selected: &[bool],
    excluded: &[bool],
    exact_count: usize,
) -> Option<Vec<u32>> {
    let mut result = selected_ids.to_vec();
    for id in 0..selected.len() {
        if result.len() >= exact_count {
            break;
        }
        if available_candidate(id, selected, excluded) {
            result.push(id as u32);
        }
    }
    if result.len() != exact_count {
        return None;
    }
    result.sort_unstable();
    Some(result)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BoundedQualityResult {
    Exact(MinimumCoverResult),
    BudgetExceeded(MinimumCoverResult),
}

struct SequentialThresholdSearch<'a> {
    full: &'a [u64],
    case_candidates: &'a [Vec<u32>],
    solution_coverage: &'a [Vec<u64>],
    threshold_data: &'a [QualityThresholdData],
    prior_targets: &'a [u32],
    current_index: usize,
    exact_count: usize,
    stable_tie: bool,
    best_current: u32,
    best_selected: Vec<u32>,
    selected_flags: Vec<bool>,
    excluded: Vec<bool>,
    selected_ids: Vec<u32>,
    states: Vec<QualityThresholdState>,
    searched_states: u64,
    state_budget: Option<u64>,
    budget_exceeded: bool,
}

impl SequentialThresholdSearch<'_> {
    fn add_solution(&mut self, solution: usize) {
        self.selected_flags[solution] = true;
        self.selected_ids.push(solution as u32);
        for (data, state) in self.threshold_data.iter().zip(&mut self.states) {
            state.add(data, solution);
        }
    }

    fn remove_solution(&mut self, solution: usize) {
        for (data, state) in self.threshold_data.iter().zip(&mut self.states) {
            state.remove(data, solution);
        }
        self.selected_ids.pop();
        self.selected_flags[solution] = false;
    }

    fn exclude_solution(&mut self, solution: usize) {
        debug_assert!(!self.excluded[solution]);
        self.excluded[solution] = true;
        for (data, state) in self.threshold_data.iter().zip(&mut self.states) {
            state.disable_candidate(data, solution);
        }
    }

    fn include_solution(&mut self, solution: usize) {
        debug_assert!(self.excluded[solution]);
        for (data, state) in self.threshold_data.iter().zip(&mut self.states) {
            state.enable_candidate(data, solution);
        }
        self.excluded[solution] = false;
    }

    fn prior_possible(&self, slots: usize) -> bool {
        for index in 0..self.current_index {
            let upper = self.states[index]
                .good
                .saturating_add(optimistic_quality_gain(
                    &self.threshold_data[index],
                    &self.states[index],
                    &self.selected_flags,
                    &self.excluded,
                    slots,
                ));
            if upper < self.prior_targets[index] {
                return false;
            }
        }
        true
    }

    fn current_upper(&self, slots: usize) -> u32 {
        self.states[self.current_index]
            .good
            .saturating_add(optimistic_quality_gain(
                &self.threshold_data[self.current_index],
                &self.states[self.current_index],
                &self.selected_flags,
                &self.excluded,
                slots,
            ))
    }

    fn run(&mut self, covered: Vec<u64>) {
        if self.budget_exceeded {
            return;
        }
        if let Some(limit) = self.state_budget
            && self.searched_states >= limit
        {
            self.budget_exceeded = true;
            return;
        }
        self.searched_states += 1;
        #[cfg(not(target_arch = "wasm32"))]
        if self.searched_states.is_multiple_of(1_000_000)
            && std::env::var_os("SFINDER_QUALITY_TRACE").is_some()
        {
            eprintln!(
                "quality-bnb states={} depth={} current={} best={}",
                self.searched_states,
                self.selected_ids.len(),
                self.states[self.current_index].good,
                self.best_current
            );
        }
        let depth = self.selected_ids.len();
        if depth > self.exact_count {
            return;
        }
        let slots = self.exact_count - depth;
        if !self.prior_possible(slots) {
            return;
        }
        let upper = self.current_upper(slots);
        if upper < self.best_current || (!self.stable_tie && upper == self.best_current) {
            return;
        }
        if self.stable_tie && upper == self.best_current {
            let Some(optimistic) = optimistic_lex_completion(
                &self.selected_ids,
                &self.selected_flags,
                &self.excluded,
                self.exact_count,
            ) else {
                return;
            };
            if optimistic.as_slice() >= self.best_selected.as_slice() {
                return;
            }
        }

        if is_full(&covered, self.full) {
            if depth != self.exact_count {
                return;
            }
            for index in 0..self.current_index {
                if self.states[index].good != self.prior_targets[index] {
                    return;
                }
            }
            let current = self.states[self.current_index].good;
            let mut stable = self.selected_ids.clone();
            stable.sort_unstable();
            if current > self.best_current
                || (self.stable_tie
                    && current == self.best_current
                    && stable.as_slice() < self.best_selected.as_slice())
            {
                self.best_current = current;
                self.best_selected = stable;
            }
            return;
        }
        if slots == 0 {
            return;
        }

        let bound = available_primary_lower_bound(
            &covered,
            self.full,
            self.solution_coverage,
            &self.selected_flags,
            &self.excluded,
        );
        if bound == usize::MAX || bound > slots {
            return;
        }
        let Some((case, available)) = choose_available_case(
            &covered,
            self.full,
            self.case_candidates,
            &self.selected_flags,
            &self.excluded,
        ) else {
            return;
        };
        if available == 0 {
            return;
        }

        let mut branches: Vec<u32> = self.case_candidates[case]
            .iter()
            .copied()
            .filter(|&id| available_candidate(id as usize, &self.selected_flags, &self.excluded))
            .collect();
        branches.sort_unstable_by(|&a, &b| {
            self.states[self.current_index].gains[b as usize]
                .cmp(&self.states[self.current_index].gains[a as usize])
                .then_with(|| {
                    gain(&self.solution_coverage[b as usize], &covered, self.full).cmp(&gain(
                        &self.solution_coverage[a as usize],
                        &covered,
                        self.full,
                    ))
                })
                .then(a.cmp(&b))
        });

        let mut excluded_here = Vec::with_capacity(branches.len());
        for &solution in &branches {
            if self.budget_exceeded {
                break;
            }
            let id = solution as usize;
            if !available_candidate(id, &self.selected_flags, &self.excluded) {
                continue;
            }
            if dynamic_branch_dominated(
                id,
                &DynamicDominanceContext {
                    branches: &branches,
                    covered: &covered,
                    solution_coverage: self.solution_coverage,
                    threshold_data: self.threshold_data,
                    states: &self.states,
                    selected: &self.selected_flags,
                    excluded: &self.excluded,
                    stable_tie: self.stable_tie,
                },
            ) {
                self.exclude_solution(id);
                excluded_here.push(id);
                continue;
            }
            let mut next = covered.clone();
            or_into(&mut next, &self.solution_coverage[id]);
            self.add_solution(id);
            self.run(next);
            self.remove_solution(id);
            if self.budget_exceeded {
                break;
            }
            self.exclude_solution(id);
            excluded_here.push(id);
        }
        for id in excluded_here.into_iter().rev() {
            self.include_solution(id);
        }
    }
}

/// Exact secondary human-quality optimization at a cardinality already proven
/// optimal by another exact primary solver (normally HiGHS).
///
/// The legacy quality objective is represented exactly by sequentially
/// maximizing the number of cases whose score reaches each increasing quality
/// threshold. The final threshold also resolves the original stable-ID tie.
fn fixed_quality_internal(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
    exact_count: usize,
    seed_selected: &[u32],
    locked_prefix: &[u32],
    state_budget: Option<u64>,
) -> Option<BoundedQualityResult> {
    if raw_cases.is_empty() {
        let result = MinimumCoverResult {
            selected: Vec::new(),
            quality: Vec::new(),
            searched_states: 0,
        };
        return (exact_count == 0).then_some(BoundedQualityResult::Exact(result));
    }
    if solution_count == 0 || exact_count == 0 || seed_selected.len() != exact_count {
        return None;
    }
    let normalized = normalize_quality_cases(raw_cases, solution_count)?;
    let mut seed = seed_selected.to_vec();
    seed.sort_unstable();
    seed.dedup();
    if seed.len() != exact_count || seed.iter().any(|&id| id as usize >= solution_count) {
        return None;
    }

    let primary_coverage = full_primary_coverage(&normalized, solution_count);
    let mut seed_primary = vec![0u64; normalized.len().div_ceil(64)];
    for &id in &seed {
        or_into(&mut seed_primary, &primary_coverage[id as usize]);
    }
    let mut all_primary = vec![u64::MAX; seed_primary.len()];
    if let Some(last) = all_primary.last_mut() {
        let rem = normalized.len() & 63;
        if rem != 0 {
            *last = (1u64 << rem) - 1;
        }
    }
    if !is_full(&seed_primary, &all_primary) {
        return None;
    }

    let mut levels: Vec<u32> = normalized
        .iter()
        .flat_map(|row| row.iter().map(|&(_, quality)| quality))
        .collect();
    levels.sort_unstable();
    levels.dedup();
    if levels.len() <= 1 {
        return Some(BoundedQualityResult::Exact(MinimumCoverResult {
            selected: seed.clone(),
            quality: quality_vector(&normalized, &seed, solution_count),
            searched_states: 0,
        }));
    }
    levels.remove(0);
    let threshold_data: Vec<QualityThresholdData> = levels
        .iter()
        .map(|&threshold| QualityThresholdData::build(&normalized, solution_count, threshold))
        .collect();

    if locked_prefix.len() > threshold_data.len() {
        return None;
    }
    for (index, &target) in locked_prefix.iter().enumerate() {
        if threshold_count_for_selected(&normalized, &seed, levels[index], solution_count) != target
        {
            return None;
        }
    }

    let mut best = seed;
    let mut targets = locked_prefix.to_vec();
    let mut searched_states = 0u64;

    for current_index in locked_prefix.len()..threshold_data.len() {
        let remaining_budget = state_budget.map(|limit| limit.saturating_sub(searched_states));
        if remaining_budget == Some(0) {
            return Some(BoundedQualityResult::BudgetExceeded(MinimumCoverResult {
                selected: best.clone(),
                quality: quality_vector(&normalized, &best, solution_count),
                searched_states,
            }));
        }
        let stable_tie = current_index + 1 == threshold_data.len();
        let active_candidate = threshold_static_active_candidates(
            &primary_coverage,
            &threshold_data,
            current_index,
            stable_tie,
        );
        let (full, mut case_candidates, solution_coverage) =
            kernelize_primary_for_candidates(&normalized, solution_count, &active_candidate)?;
        let incumbent =
            threshold_count_for_selected(&normalized, &best, levels[current_index], solution_count);
        let current_size: Vec<u32> = threshold_data[current_index]
            .candidate_groups
            .iter()
            .map(|groups| {
                groups
                    .iter()
                    .map(|&g| threshold_data[current_index].weights[g as usize])
                    .sum()
            })
            .collect();
        let best_flag: Vec<bool> = (0..solution_count)
            .map(|id| best.binary_search(&(id as u32)).is_ok())
            .collect();
        for candidates in &mut case_candidates {
            candidates.sort_unstable_by(|a, b| {
                best_flag[*b as usize]
                    .cmp(&best_flag[*a as usize])
                    .then(current_size[*b as usize].cmp(&current_size[*a as usize]))
                    .then(a.cmp(b))
            });
        }
        let mut states: Vec<QualityThresholdState> = threshold_data[..=current_index]
            .iter()
            .map(|data| QualityThresholdState::new(data, solution_count))
            .collect();
        for (solution, &active) in active_candidate.iter().enumerate().take(solution_count) {
            if !active {
                for (data, state) in threshold_data[..=current_index].iter().zip(&mut states) {
                    state.disable_candidate(data, solution);
                }
            }
        }
        let mut search = SequentialThresholdSearch {
            full: &full,
            case_candidates: &case_candidates,
            solution_coverage: &solution_coverage,
            threshold_data: &threshold_data[..=current_index],
            prior_targets: &targets,
            current_index,
            exact_count,
            stable_tie,
            best_current: incumbent,
            best_selected: best.clone(),
            selected_flags: vec![false; solution_count],
            excluded: active_candidate.iter().map(|&active| !active).collect(),
            selected_ids: Vec::with_capacity(exact_count),
            states,
            searched_states: 0,
            state_budget: remaining_budget,
            budget_exceeded: false,
        };
        search.run(vec![0u64; full.len()]);
        searched_states += search.searched_states;
        best = search.best_selected;
        if search.budget_exceeded {
            return Some(BoundedQualityResult::BudgetExceeded(MinimumCoverResult {
                selected: best.clone(),
                quality: quality_vector(&normalized, &best, solution_count),
                searched_states,
            }));
        }
        targets.push(search.best_current);
    }

    if !threshold_data.is_empty() && locked_prefix.len() == threshold_data.len() {
        let remaining_budget = state_budget.map(|limit| limit.saturating_sub(searched_states));
        if remaining_budget == Some(0) {
            return Some(BoundedQualityResult::BudgetExceeded(MinimumCoverResult {
                selected: best.clone(),
                quality: quality_vector(&normalized, &best, solution_count),
                searched_states,
            }));
        }
        let last = threshold_data.len() - 1;
        let active_candidate =
            threshold_static_active_candidates(&primary_coverage, &threshold_data, last, true);
        let (full, mut case_candidates, solution_coverage) =
            kernelize_primary_for_candidates(&normalized, solution_count, &active_candidate)?;
        let best_flag: Vec<bool> = (0..solution_count)
            .map(|id| best.binary_search(&(id as u32)).is_ok())
            .collect();
        for candidates in &mut case_candidates {
            candidates.sort_unstable_by(|a, b| {
                best_flag[*b as usize]
                    .cmp(&best_flag[*a as usize])
                    .then(a.cmp(b))
            });
        }
        let mut states: Vec<QualityThresholdState> = threshold_data
            .iter()
            .map(|data| QualityThresholdState::new(data, solution_count))
            .collect();
        for (solution, &active) in active_candidate.iter().enumerate().take(solution_count) {
            if !active {
                for (data, state) in threshold_data.iter().zip(&mut states) {
                    state.disable_candidate(data, solution);
                }
            }
        }
        let mut search = SequentialThresholdSearch {
            full: &full,
            case_candidates: &case_candidates,
            solution_coverage: &solution_coverage,
            threshold_data: &threshold_data,
            prior_targets: &locked_prefix[..last],
            current_index: last,
            exact_count,
            stable_tie: true,
            best_current: locked_prefix[last],
            best_selected: best.clone(),
            selected_flags: vec![false; solution_count],
            excluded: active_candidate.iter().map(|&active| !active).collect(),
            selected_ids: Vec::with_capacity(exact_count),
            states,
            searched_states: 0,
            state_budget: remaining_budget,
            budget_exceeded: false,
        };
        search.run(vec![0u64; full.len()]);
        searched_states += search.searched_states;
        best = search.best_selected;
        if search.budget_exceeded {
            return Some(BoundedQualityResult::BudgetExceeded(MinimumCoverResult {
                selected: best.clone(),
                quality: quality_vector(&normalized, &best, solution_count),
                searched_states,
            }));
        }
        if search.best_current != locked_prefix[last] {
            return None;
        }
    }

    let quality = quality_vector(&normalized, &best, solution_count);
    Some(BoundedQualityResult::Exact(MinimumCoverResult {
        selected: best,
        quality,
        searched_states,
    }))
}

pub fn exact_quality_cover_at_count_bounded(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
    exact_count: usize,
    seed_selected: &[u32],
    state_budget: Option<u64>,
) -> Option<BoundedQualityResult> {
    fixed_quality_internal(
        raw_cases,
        solution_count,
        exact_count,
        seed_selected,
        &[],
        state_budget,
    )
}

pub fn exact_quality_cover_at_count(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
    exact_count: usize,
    seed_selected: &[u32],
) -> Option<MinimumCoverResult> {
    match fixed_quality_internal(
        raw_cases,
        solution_count,
        exact_count,
        seed_selected,
        &[],
        None,
    )? {
        BoundedQualityResult::Exact(result) => Some(result),
        BoundedQualityResult::BudgetExceeded(_) => unreachable!(),
    }
}

pub fn exact_quality_cover_at_count_with_locked_prefix(
    raw_cases: &[Vec<(u32, u32)>],
    solution_count: usize,
    exact_count: usize,
    seed_selected: &[u32],
    locked_prefix: &[u32],
) -> Option<MinimumCoverResult> {
    match fixed_quality_internal(
        raw_cases,
        solution_count,
        exact_count,
        seed_selected,
        locked_prefix,
        None,
    )? {
        BoundedQualityResult::Exact(result) => Some(result),
        BoundedQualityResult::BudgetExceeded(_) => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_cardinality_and_quality() {
        // A: X/Y, B: Z/W. X+Z has a bad second case; X+W is preferred.
        let cases = vec![vec![(0, 100), (1, 30)], vec![(2, 1), (3, 30)]];
        let result = exact_minimum_cover(&cases, 4).unwrap();
        assert_eq!(result.selected.len(), 2);
        assert_eq!(result.quality, vec![30, 100]);
        assert_eq!(result.selected, vec![0, 3]);
    }

    #[test]
    fn fixed_count_quality_matches_legacy_exact_search() {
        let cases = vec![
            vec![(0, 9), (1, 5), (4, 7)],
            vec![(0, 2), (2, 8), (4, 4)],
            vec![(1, 7), (3, 8), (4, 6)],
            vec![(2, 5), (3, 9), (4, 3)],
        ];
        let legacy = exact_minimum_cover(&cases, 5).unwrap();
        let fixed =
            exact_quality_cover_at_count(&cases, 5, legacy.selected.len(), &legacy.selected)
                .unwrap();
        assert_eq!(fixed.selected, legacy.selected);
        assert_eq!(fixed.quality, legacy.quality);
    }

    #[test]
    fn primary_kernel_preserves_exact_cardinality_on_random_small_matrices() {
        let mut state = 0x3141_5926u32;
        let mut next = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            state
        };
        for sample in 0..120 {
            let solution_count = 2 + (next() as usize % 8);
            let case_count = 2 + (next() as usize % 9);
            let mut quality_cases = Vec::with_capacity(case_count);
            let mut primary_cases = Vec::with_capacity(case_count);
            for _ in 0..case_count {
                let mut row = Vec::new();
                for solution in 0..solution_count {
                    if next() % 100 < 45 {
                        row.push((solution as u32, 1 + next() % 10));
                    }
                }
                if row.is_empty() {
                    row.push(((next() as usize % solution_count) as u32, 1 + next() % 10));
                }
                primary_cases.push(row.iter().map(|&(id, _)| id).collect());
                quality_cases.push(row);
            }
            let exact = exact_minimum_cardinality_cover(&quality_cases, solution_count)
                .unwrap_or_else(|| panic!("original cardinality failed on sample {sample}"));
            let kernel = exact_primary_cardinality_kernel(&primary_cases, solution_count)
                .unwrap_or_else(|| panic!("kernelization failed on sample {sample}"));
            let residual: Vec<Vec<(u32, u32)>> = kernel
                .cases
                .iter()
                .map(|row| row.iter().map(|&id| (id, 0)).collect())
                .collect();
            let residual_k = exact_minimum_cardinality_cover(&residual, kernel.solution_ids.len())
                .unwrap_or_else(|| panic!("residual cardinality failed on sample {sample}"))
                .selected
                .len();
            assert_eq!(
                kernel.forced.len() + residual_k,
                exact.selected.len(),
                "K mismatch on sample {sample}"
            );
        }
    }

    #[test]
    fn cardinality_only_matches_exact_primary_on_random_small_matrices() {
        let mut state = 0x7a31_9d2bu32;
        let mut next = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            state
        };
        for _ in 0..100 {
            let solutions = 2 + (next() as usize % 7);
            let cases_len = 2 + (next() as usize % 8);
            let mut cases = Vec::with_capacity(cases_len);
            for _ in 0..cases_len {
                let mut row = Vec::new();
                for solution in 0..solutions {
                    if next() % 100 < 45 {
                        row.push((solution as u32, 1 + next() % 10));
                    }
                }
                if row.is_empty() {
                    row.push(((next() as usize % solutions) as u32, 1 + next() % 10));
                }
                cases.push(row);
            }
            let exact = exact_minimum_cover(&cases, solutions).unwrap();
            let cardinality = exact_minimum_cardinality_cover(&cases, solutions).unwrap();
            assert_eq!(cardinality.selected.len(), exact.selected.len());
            assert!(cardinality.quality.is_empty());
        }
    }

    #[test]
    fn redundant_case_does_not_change_cardinality() {
        let cases = vec![vec![(0, 1)], vec![(0, 1), (1, 10)], vec![(1, 10), (2, 10)]];
        let result = exact_minimum_cover(&cases, 3).unwrap();
        assert_eq!(result.selected.len(), 2);
        assert!(result.selected.contains(&0));
    }

    #[test]
    fn locked_prefix_matches_full_fixed_count_search() {
        let cases = vec![
            vec![(0, 9), (1, 5), (4, 7)],
            vec![(0, 2), (2, 8), (4, 4)],
            vec![(1, 7), (3, 8), (4, 6)],
            vec![(2, 5), (3, 9), (4, 3)],
        ];
        let legacy = exact_minimum_cover(&cases, 5).unwrap();
        let full = exact_quality_cover_at_count(&cases, 5, legacy.selected.len(), &legacy.selected)
            .unwrap();
        let mut levels: Vec<u32> = cases
            .iter()
            .flat_map(|row| row.iter().map(|&(_, q)| q))
            .collect();
        levels.sort_unstable();
        levels.dedup();
        levels.remove(0);
        let first = threshold_count_for_selected(&cases, &full.selected, levels[0], 5);
        let locked = exact_quality_cover_at_count_with_locked_prefix(
            &cases,
            5,
            full.selected.len(),
            &full.selected,
            &[first],
        )
        .unwrap();
        assert_eq!(locked.selected, full.selected);
        assert_eq!(locked.quality, full.quality);
    }

    #[test]
    fn fixed_count_quality_matches_legacy_on_random_small_matrices() {
        let mut state = 0x91e1_0da5u32;
        let mut next = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            state
        };
        for sample in 0..120 {
            let solution_count = 4 + (next() as usize % 5);
            let case_count = 3 + (next() as usize % 7);
            let mut cases = Vec::with_capacity(case_count);
            for _ in 0..case_count {
                let mut row = Vec::new();
                for solution in 0..solution_count {
                    if next() % 100 < 48 {
                        row.push((solution as u32, 1 + next() % 9));
                    }
                }
                if row.is_empty() {
                    row.push(((next() as usize % solution_count) as u32, 1 + next() % 9));
                }
                cases.push(row);
            }
            let Some(legacy) = exact_minimum_cover(&cases, solution_count) else {
                continue;
            };
            let fixed = exact_quality_cover_at_count(
                &cases,
                solution_count,
                legacy.selected.len(),
                &legacy.selected,
            )
            .unwrap_or_else(|| panic!("fixed solver failed on sample {sample}"));
            assert_eq!(
                fixed.selected, legacy.selected,
                "selected mismatch on sample {sample}"
            );
            assert_eq!(
                fixed.quality, legacy.quality,
                "quality mismatch on sample {sample}"
            );
        }
    }
    #[test]
    fn bounded_fixed_count_exact_completes_or_returns_valid_incumbent() {
        let cases = vec![
            vec![(0, 9), (1, 5), (4, 7)],
            vec![(0, 2), (2, 8), (4, 4)],
            vec![(1, 7), (3, 8), (4, 6)],
            vec![(2, 5), (3, 9), (4, 3)],
        ];
        let legacy = exact_minimum_cover(&cases, 5).unwrap();
        let exact = exact_quality_cover_at_count_bounded(
            &cases,
            5,
            legacy.selected.len(),
            &legacy.selected,
            Some(1_000_000),
        )
        .unwrap();
        match exact {
            BoundedQualityResult::Exact(result) => {
                assert_eq!(result.selected, legacy.selected);
                assert_eq!(result.quality, legacy.quality);
            }
            BoundedQualityResult::BudgetExceeded(_) => {
                panic!("large budget unexpectedly exhausted")
            }
        }

        let bounded = exact_quality_cover_at_count_bounded(
            &cases,
            5,
            legacy.selected.len(),
            &legacy.selected,
            Some(1),
        )
        .unwrap();
        match bounded {
            BoundedQualityResult::BudgetExceeded(result) => {
                assert_eq!(result.selected.len(), legacy.selected.len());
                let mut covered = vec![false; cases.len()];
                for (ci, row) in cases.iter().enumerate() {
                    covered[ci] = row.iter().any(|(id, _)| result.selected.contains(id));
                }
                assert!(covered.into_iter().all(|x| x));
            }
            BoundedQualityResult::Exact(_) => panic!("budget=1 unexpectedly completed"),
        }
    }

    #[test]
    fn integrated_fixed_count_matches_legacy_on_random_small_matrices() {
        let mut state = 0x4f91_c2adu32;
        let mut next = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            state
        };
        for sample in 0..100 {
            let solution_count = 4 + (next() as usize % 5);
            let case_count = 3 + (next() as usize % 7);
            let mut cases = Vec::with_capacity(case_count);
            for _ in 0..case_count {
                let mut row = Vec::new();
                for solution in 0..solution_count {
                    if next() % 100 < 48 {
                        row.push((solution as u32, 1 + next() % 9));
                    }
                }
                if row.is_empty() {
                    row.push(((next() as usize % solution_count) as u32, 1 + next() % 9));
                }
                cases.push(row);
            }
            let Some(legacy) = exact_minimum_cover(&cases, solution_count) else {
                continue;
            };
            let integrated = exact_quality_cover_at_count_integrated(
                &cases,
                solution_count,
                legacy.selected.len(),
                &legacy.selected,
            )
            .unwrap_or_else(|| panic!("integrated fixed-K failed on sample {sample}"));
            assert_eq!(
                integrated.selected, legacy.selected,
                "selected mismatch on sample {sample}"
            );
            assert_eq!(
                integrated.quality, legacy.quality,
                "quality mismatch on sample {sample}"
            );
        }
    }

    #[test]
    fn integrated_fixed_count_budget_returns_valid_incumbent() {
        let cases = vec![
            vec![(0, 9), (1, 5), (4, 7)],
            vec![(0, 2), (2, 8), (4, 4)],
            vec![(1, 7), (3, 8), (4, 6)],
            vec![(2, 5), (3, 9), (4, 3)],
        ];
        let legacy = exact_minimum_cover(&cases, 5).unwrap();
        let bounded = exact_quality_cover_at_count_integrated_bounded(
            &cases,
            5,
            legacy.selected.len(),
            &legacy.selected,
            Some(1),
        )
        .unwrap();
        match bounded {
            BoundedQualityResult::BudgetExceeded(result) => {
                assert_eq!(result.selected.len(), legacy.selected.len());
                let chosen: HashSet<u32> = result.selected.iter().copied().collect();
                assert!(
                    cases
                        .iter()
                        .all(|row| row.iter().any(|(id, _)| chosen.contains(id)))
                );
            }
            BoundedQualityResult::Exact(_) => panic!("budget=1 unexpectedly completed"),
        }
    }

    #[test]
    fn fully_locked_prefix_still_resolves_stable_id_tie() {
        // Candidate 1 strictly primary-dominates candidate 0, but when the
        // quality vector is already locked, [0,2] is the stable-ID winner.
        let cases = vec![
            vec![(0, 1), (1, 1)],
            vec![(1, 1), (2, 1)],
            vec![(2, 2), (3, 2)],
        ];
        let result =
            exact_quality_cover_at_count_with_locked_prefix(&cases, 4, 2, &[1, 2], &[1]).unwrap();
        assert_eq!(result.selected, vec![0, 2]);
        assert_eq!(result.quality, vec![1, 1, 2]);
    }
}
