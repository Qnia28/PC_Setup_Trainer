#![allow(clippy::missing_safety_doc)]
use pc_core::{PcSolver, Solution, decode_queue_array, min_cover::exact_minimum_cover};

pub struct WasmSolver {
    core: PcSolver,
    solutions: Vec<Solution>,
    solution_saves: Vec<u8>,
    pattern_offsets: Vec<u32>,
    pattern_case_ids: Vec<u32>,
    pattern_order_counts: Vec<u32>,
    min_cover_selected: Vec<u32>,
    min_cover_quality: Vec<u32>,
    min_cover_searched_states: u64,
}

const SOLUTION_WORD_STRIDE: usize = 9;

fn set_concrete_solutions(
    solver: &mut WasmSolver,
    queue: &[pc_core::Piece],
    solutions: Vec<Solution>,
) {
    solver.solutions = solutions;
    solver.solution_saves.clear();
    solver.solution_saves.reserve(solver.solutions.len());
    for solution in &solver.solutions {
        solver
            .solution_saves
            .push(PcSolver::saved_piece_for_solution(queue, solution));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn solver_new(height: u32) -> *mut WasmSolver {
    if !(2..=6).contains(&height) {
        return core::ptr::null_mut();
    }
    Box::into_raw(Box::new(WasmSolver {
        core: PcSolver::new(height as u8),
        solutions: Vec::new(),
        solution_saves: Vec::new(),
        pattern_offsets: Vec::new(),
        pattern_case_ids: Vec::new(),
        pattern_order_counts: Vec::new(),
        min_cover_selected: Vec::new(),
        min_cover_quality: Vec::new(),
        min_cover_searched_states: 0,
    }))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_free(ptr: *mut WasmSolver) {
    if !ptr.is_null() {
        drop(unsafe { Box::from_raw(ptr) })
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut b = vec![0u8; len].into_boxed_slice();
    let p = b.as_mut_ptr();
    core::mem::forget(b);
    p
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wasm_dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        let s = core::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(unsafe { Box::from_raw(s) })
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn wasm_alloc_u32(len: usize) -> *mut u32 {
    let mut b = vec![0u32; len].into_boxed_slice();
    let p = b.as_mut_ptr();
    core::mem::forget(b);
    p
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wasm_dealloc_u32(ptr: *mut u32, len: usize) {
    if !ptr.is_null() {
        let s = core::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(unsafe { Box::from_raw(s) })
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn wasm_alloc_u64(len: usize) -> *mut u64 {
    let mut b = vec![0u64; len].into_boxed_slice();
    let p = b.as_mut_ptr();
    core::mem::forget(b);
    p
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wasm_dealloc_u64(ptr: *mut u64, len: usize) {
    if !ptr.is_null() {
        let s = core::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(unsafe { Box::from_raw(s) })
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_load_legal_pack(
    ptr: *mut WasmSolver,
    data: *const u8,
    len: usize,
) -> u32 {
    if ptr.is_null() || data.is_null() {
        return 0;
    }
    let bytes = unsafe { core::slice::from_raw_parts(data, len) };
    unsafe { &mut *ptr }.core.load_legal_pack(bytes) as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_can_pc(
    ptr: *mut WasmSolver,
    board: u64,
    qbits: u64,
    qlen: u32,
    hold: u32,
) -> u32 {
    if ptr.is_null() || qlen > 21 {
        return 0;
    }
    let Some((q, qn)) = decode_queue_array(qbits, qlen as u8) else {
        return 0;
    };
    unsafe { &mut *ptr }.core.can_pc(board, &q[..qn], hold != 0) as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_can_pc_many(
    ptr: *mut WasmSolver,
    board: u64,
    qbits_ptr: *const u64,
    qlen_ptr: *const u8,
    count: u32,
    hold: u32,
    out_ptr: *mut u8,
) -> u32 {
    if ptr.is_null()
        || (count > 0 && (qbits_ptr.is_null() || qlen_ptr.is_null() || out_ptr.is_null()))
    {
        return 0;
    }
    let qbits = unsafe { core::slice::from_raw_parts(qbits_ptr, count as usize) };
    let qlens = unsafe { core::slice::from_raw_parts(qlen_ptr, count as usize) };
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, count as usize) };
    for i in 0..count as usize {
        if qlens[i] > 21 || decode_queue_array(qbits[i], qlens[i]).is_none() {
            return 0;
        }
    }
    unsafe { &mut *ptr }
        .core
        .can_pc_many_packed(board, qbits, qlens, hold != 0, out) as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_can_pc_pattern_many(
    ptr: *mut WasmSolver,
    board: u64,
    qbits_ptr: *const u64,
    qlen_ptr: *const u8,
    count: u32,
    hold: u32,
    out_ptr: *mut u8,
) -> u32 {
    if ptr.is_null()
        || (count > 0 && (qbits_ptr.is_null() || qlen_ptr.is_null() || out_ptr.is_null()))
    {
        return 0;
    }
    let qbits = unsafe { core::slice::from_raw_parts(qbits_ptr, count as usize) };
    let qlens = unsafe { core::slice::from_raw_parts(qlen_ptr, count as usize) };
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, count as usize) };
    for i in 0..count as usize {
        if qlens[i] > 21 || decode_queue_array(qbits[i], qlens[i]).is_none() {
            return 0;
        }
    }
    unsafe { &mut *ptr }
        .core
        .can_pc_pattern_many_packed(board, qbits, qlens, hold != 0, out) as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_enumerate_pc(
    ptr: *mut WasmSolver,
    board: u64,
    qbits: u64,
    qlen: u32,
    hold: u32,
) -> u32 {
    if ptr.is_null() || qlen > 21 {
        return 0;
    }
    let Some((q, qn)) = decode_queue_array(qbits, qlen as u8) else {
        return 0;
    };
    let s = unsafe { &mut *ptr };
    let solutions = s.core.enumerate_pc(board, &q[..qn], hold != 0);
    set_concrete_solutions(s, &q[..qn], solutions);
    s.solutions.len() as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_best_pc(
    ptr: *mut WasmSolver,
    board: u64,
    qbits: u64,
    qlen: u32,
    hold: u32,
) -> u32 {
    if ptr.is_null() || qlen > 21 {
        return 0;
    }
    let Some((q, qn)) = decode_queue_array(qbits, qlen as u8) else {
        return 0;
    };
    let s = unsafe { &mut *ptr };
    s.solutions.clear();
    s.solution_saves.clear();
    if let Some(solution) = s.core.best_pc(board, &q[..qn], hold != 0) {
        let saved = PcSolver::saved_piece_for_solution(&q[..qn], &solution);
        s.solutions.push(solution);
        s.solution_saves.push(saved);
        1
    } else {
        0
    }
}

// Pattern-level 5..=6-line compatibility enumeration. The Rust core shares
// geometry across all concrete queues and returns sparse per-solution case
// coverage plus the playable-order count used by human-quality tie breaking.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_enumerate_pc_pattern(
    ptr: *mut WasmSolver,
    board: u64,
    qbits_ptr: *const u64,
    qlen_ptr: *const u8,
    count: u32,
    hold: u32,
) -> u32 {
    if ptr.is_null() || (count > 0 && (qbits_ptr.is_null() || qlen_ptr.is_null())) {
        return u32::MAX;
    }
    let qbits = unsafe { core::slice::from_raw_parts(qbits_ptr, count as usize) };
    let qlens = unsafe { core::slice::from_raw_parts(qlen_ptr, count as usize) };
    for i in 0..count as usize {
        if qlens[i] > 21 || decode_queue_array(qbits[i], qlens[i]).is_none() {
            return u32::MAX;
        }
    }
    let s = unsafe { &mut *ptr };
    let Some(rows) = s
        .core
        .enumerate_pc_pattern_packed(board, qbits, qlens, hold != 0)
    else {
        return u32::MAX;
    };
    s.solutions.clear();
    s.solution_saves.clear();
    s.pattern_offsets.clear();
    s.pattern_case_ids.clear();
    s.pattern_order_counts.clear();
    s.pattern_offsets.reserve(rows.len() + 1);
    s.pattern_offsets.push(0);
    for row in rows {
        s.solutions.push(row.solution);
        s.solution_saves.push(7);
        for (case, order_count) in row.cases {
            s.pattern_case_ids.push(case);
            s.pattern_order_counts.push(order_count);
        }
        s.pattern_offsets.push(s.pattern_case_ids.len() as u32);
    }
    s.solutions.len() as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_pattern_coverage_offset(
    ptr: *mut WasmSolver,
    solution_index: u32,
) -> u32 {
    if ptr.is_null() {
        return u32::MAX;
    }
    unsafe { &*ptr }
        .pattern_offsets
        .get(solution_index as usize)
        .copied()
        .unwrap_or(u32::MAX)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_pattern_coverage_case(
    ptr: *mut WasmSolver,
    entry_index: u32,
) -> u32 {
    if ptr.is_null() {
        return u32::MAX;
    }
    unsafe { &*ptr }
        .pattern_case_ids
        .get(entry_index as usize)
        .copied()
        .unwrap_or(u32::MAX)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_pattern_coverage_order_count(
    ptr: *mut WasmSolver,
    entry_index: u32,
) -> u32 {
    if ptr.is_null() {
        return 0;
    }
    unsafe { &*ptr }
        .pattern_order_counts
        .get(entry_index as usize)
        .copied()
        .unwrap_or(0)
}

// Single-concrete-queue fast API for qniapc/per-save-minimals.  It returns
// only the best solution for each save piece, ranked by playable piece-order
// count and then by a deterministic compact-solution key.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_per_save_best(
    ptr: *mut WasmSolver,
    board: u64,
    qbits: u64,
    qlen: u32,
    hold: u32,
    candidate_limit: u32,
) -> u32 {
    if ptr.is_null() || qlen > 21 {
        return 0;
    }
    let Some((q, qn)) = decode_queue_array(qbits, qlen as u8) else {
        return 0;
    };
    let s = unsafe { &mut *ptr };
    let best = s
        .core
        .per_save_best(board, &q[..qn], hold != 0, candidate_limit.max(1) as usize);
    s.solutions.clear();
    s.solution_saves.clear();
    s.solutions.reserve(best.len());
    s.solution_saves.reserve(best.len());
    for (piece, solution) in best {
        s.solution_saves.push(piece as u8);
        s.solutions.push(solution);
    }
    s.solutions.len() as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_solution_word_stride() -> u32 {
    SOLUTION_WORD_STRIDE as u32
}

// Bulk solution export: seven piece masks, order count, saved-piece code.
// This replaces 8-9 JS->WASM getter calls per solution on hot UI paths.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_copy_solution_words(
    ptr: *mut WasmSolver,
    out_ptr: *mut u64,
    capacity_words: u32,
) -> u32 {
    if ptr.is_null() {
        return u32::MAX;
    }
    let s = unsafe { &*ptr };
    let required = s.solutions.len().saturating_mul(SOLUTION_WORD_STRIDE);
    if required > u32::MAX as usize {
        return u32::MAX;
    }
    if required == 0 {
        return 0;
    }
    if out_ptr.is_null() || (capacity_words as usize) < required {
        return required as u32;
    }
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, required) };
    for (index, solution) in s.solutions.iter().enumerate() {
        let base = index * SOLUTION_WORD_STRIDE;
        out[base..base + 7].copy_from_slice(&solution.masks);
        out[base + 7] = solution.order_count as u64;
        out[base + 8] = s.solution_saves.get(index).copied().unwrap_or(7) as u64;
    }
    required as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_solution_mask(ptr: *mut WasmSolver, index: u32, piece: u32) -> u64 {
    if ptr.is_null() || piece >= 7 {
        return 0;
    }
    unsafe { &*ptr }
        .solutions
        .get(index as usize)
        .map(|x| x.masks[piece as usize])
        .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_solution_order_count(ptr: *mut WasmSolver, index: u32) -> u32 {
    if ptr.is_null() {
        return 0;
    }
    unsafe { &*ptr }
        .solutions
        .get(index as usize)
        .map(|x| x.order_count)
        .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_solution_saved_piece(ptr: *mut WasmSolver, index: u32) -> u32 {
    if ptr.is_null() {
        return 7;
    }
    unsafe { &*ptr }
        .solution_saves
        .get(index as usize)
        .copied()
        .unwrap_or(7) as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_min_cover(
    ptr: *mut WasmSolver,
    offsets_ptr: *const u32,
    case_count: u32,
    ids_ptr: *const u32,
    quality_ptr: *const u32,
    entry_count: u32,
    solution_count: u32,
) -> u32 {
    if ptr.is_null() || offsets_ptr.is_null() || (entry_count > 0 && ids_ptr.is_null()) {
        return u32::MAX;
    }
    let offsets = unsafe { core::slice::from_raw_parts(offsets_ptr, case_count as usize + 1) };
    let ids = unsafe { core::slice::from_raw_parts(ids_ptr, entry_count as usize) };
    let qualities = if quality_ptr.is_null() {
        None
    } else {
        Some(unsafe { core::slice::from_raw_parts(quality_ptr, entry_count as usize) })
    };
    if offsets.first().copied() != Some(0)
        || offsets.last().copied() != Some(entry_count)
        || offsets.windows(2).any(|w| w[0] > w[1])
        || ids.iter().any(|&id| id >= solution_count)
    {
        return u32::MAX;
    }

    let mut cases = Vec::with_capacity(case_count as usize);
    for case in 0..case_count as usize {
        let start = offsets[case] as usize;
        let end = offsets[case + 1] as usize;
        let mut row = Vec::with_capacity(end - start);
        for index in start..end {
            row.push((ids[index], qualities.map_or(0, |q| q[index])));
        }
        cases.push(row);
    }

    let solver = unsafe { &mut *ptr };
    solver.min_cover_selected.clear();
    solver.min_cover_quality.clear();
    solver.min_cover_searched_states = 0;
    let Some(result) = exact_minimum_cover(&cases, solution_count as usize) else {
        return u32::MAX;
    };
    solver.min_cover_selected = result.selected;
    solver.min_cover_quality = result.quality;
    solver.min_cover_searched_states = result.searched_states;
    solver.min_cover_selected.len() as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_min_cover_selected(ptr: *mut WasmSolver, index: u32) -> u32 {
    if ptr.is_null() {
        return u32::MAX;
    }
    unsafe { &*ptr }
        .min_cover_selected
        .get(index as usize)
        .copied()
        .unwrap_or(u32::MAX)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_min_cover_quality_len(ptr: *mut WasmSolver) -> u32 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.min_cover_quality.len() as u32
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_min_cover_quality(ptr: *mut WasmSolver, index: u32) -> u32 {
    if ptr.is_null() {
        return 0;
    }
    unsafe { &*ptr }
        .min_cover_quality
        .get(index as usize)
        .copied()
        .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_min_cover_searched_states(ptr: *mut WasmSolver) -> u64 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.min_cover_searched_states
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_nodes(ptr: *mut WasmSolver) -> u64 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.core.nodes
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_cache_hits(ptr: *mut WasmSolver) -> u64 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.core.placement_cache_hits
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_cache_misses(ptr: *mut WasmSolver) -> u64 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.core.placement_cache_misses
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_legal_rejects(ptr: *mut WasmSolver) -> u64 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.core.legal_rejects
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_legal_count(ptr: *mut WasmSolver, stage: u32) -> u32 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.core.legal_count(stage as usize) as u32
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_legal_pack_version(ptr: *mut WasmSolver) -> u32 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.core.legal_pack_version() as u32
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_legal_memory_bytes(ptr: *mut WasmSolver) -> u32 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }
            .core
            .legal_memory_bytes()
            .min(u32::MAX as usize) as u32
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_stage8_oracle_entries(ptr: *mut WasmSolver) -> u32 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }
            .core
            .stage8_oracle_entries()
            .min(u32::MAX as usize) as u32
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_stage9_oracle_entries(ptr: *mut WasmSolver) -> u32 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }
            .core
            .stage9_oracle_entries()
            .min(u32::MAX as usize) as u32
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solver_cache_entries(ptr: *mut WasmSolver) -> u32 {
    if ptr.is_null() {
        0
    } else {
        unsafe { &*ptr }.core.placement_cache_entries() as u32
    }
}
