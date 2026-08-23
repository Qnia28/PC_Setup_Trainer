use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MinimumCoverResult {
    pub selected: Vec<u32>,
    pub quality: Vec<u32>,
    pub searched_states: u64,
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
    best_depth_by_covered: HashMap<Vec<u64>, usize>,
    searched_states: u64,
}

impl CardinalitySearch<'_> {
    fn run(&mut self, covered: Vec<u64>, depth: usize) {
        self.searched_states += 1;
        if is_full(&covered, self.full) {
            self.best_count = self.best_count.min(depth);
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
            self.run(next, depth + 1);
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
    let mut cardinality = CardinalitySearch {
        full: &full,
        case_candidates: &case_candidates,
        solution_coverage: &solution_coverage,
        best_count: greedy.len(),
        best_depth_by_covered: HashMap::new(),
        searched_states: 0,
    };
    cardinality.run(vec![0u64; words], 0);

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
    fn redundant_case_does_not_change_cardinality() {
        let cases = vec![vec![(0, 1)], vec![(0, 1), (1, 10)], vec![(1, 10), (2, 10)]];
        let result = exact_minimum_cover(&cases, 3).unwrap();
        assert_eq!(result.selected.len(), 2);
        assert!(result.selected.contains(&0));
    }
}
