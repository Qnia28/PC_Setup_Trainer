import { preferredSolution } from "./human-ranking.mjs";
import { PIECE_CODE } from "./piece-order.mjs";
import { assertQualityProvider, requirePositiveQuality } from "./quality-contract.mjs";
import { retryableLoader } from "./promise-utils.mjs";
const DEFAULT_SOLUTION_WORD_STRIDE = 9;
const U32_MAX = 0xffffffff;
function wasmU32(value) { return Number(value) >>> 0; }

function queueBits(queue) {
  if (queue.length > 21) throw new Error(`queue length ${queue.length} exceeds 21`);
  let bits = 0n;
  for (let index = 0; index < queue.length; index += 1) {
    const value = PIECE_CODE[queue[index]];
    if (value === undefined) throw new Error(`bad piece ${queue[index]}`);
    bits |= BigInt(value) << BigInt(index * 3);
  }
  return bits;
}

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

export const loadWasmAssets = retryableLoader(async () => {
  const wasm = await bytesFor(new URL("../wasm/pc_wasm.wasm", import.meta.url));
  const legal = await bytesFor(new URL("../wasm/legal_boards_4.lgb", import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, {});
  return { exports: instance.exports, legal };
});

function solutionKey(masks) {
  return masks.map((mask) => mask.toString(16)).join(":");
}

export class WasmPcSolver {
  constructor(exports, height, legalBytes = null) {
    this.e = exports;
    this.ptr = exports.solver_new(height);
    this.height = height;
    if (!this.ptr) throw new Error(`unsupported height ${height}`);
    if (height === 4 && legalBytes) this.loadLegal(legalBytes);
  }

  loadLegal(bytes) {
    const pointer = this.e.wasm_alloc(bytes.length);
    new Uint8Array(this.e.memory.buffer, pointer, bytes.length).set(bytes);
    try {
      if (!this.e.solver_load_legal_pack(this.ptr, pointer, bytes.length)) {
        throw new Error("invalid legal-board pack");
      }
    } finally {
      this.e.wasm_dealloc(pointer, bytes.length);
    }
  }

  _withPackedQueues(queues, callback) {
    if (queues.length === 0) return callback(0, 0);
    const queuePointer = this.e.wasm_alloc_u64(queues.length);
    const lengthPointer = this.e.wasm_alloc(queues.length);
    try {
      const queueBuffer = new BigUint64Array(this.e.memory.buffer, queuePointer, queues.length);
      const lengthBuffer = new Uint8Array(this.e.memory.buffer, lengthPointer, queues.length);
      for (let index = 0; index < queues.length; index += 1) {
        queueBuffer[index] = queueBits(queues[index]);
        lengthBuffer[index] = queues[index].length;
      }
      return callback(queuePointer, lengthPointer);
    } finally {
      this.e.wasm_dealloc_u64(queuePointer, queues.length);
      this.e.wasm_dealloc(lengthPointer, queues.length);
    }
  }

  _readSolutions(count) {
    if (count <= 0) return [];
    if (this.e.solver_copy_solution_words && this.e.wasm_alloc_u64 && this.e.wasm_dealloc_u64) {
      const stride = wasmU32(this.e.solver_solution_word_stride?.() ?? DEFAULT_SOLUTION_WORD_STRIDE);
      if (stride < 9) throw new Error(`invalid solution word stride ${stride}`);
      const words = count * stride;
      const pointer = this.e.wasm_alloc_u64(words);
      try {
        const copied = wasmU32(this.e.solver_copy_solution_words(this.ptr, pointer, words));
        if (copied !== words) throw new Error(`WASM solution bulk copy failed: ${copied}/${words}`);
        const buffer = new BigUint64Array(this.e.memory.buffer, pointer, words);
        const output = [];
        for (let index = 0; index < count; index += 1) {
          const base = index * stride;
          const masks = [
            buffer[base],
            buffer[base + 1],
            buffer[base + 2],
            buffer[base + 3],
            buffer[base + 4],
            buffer[base + 5],
            buffer[base + 6],
          ];
          const key = solutionKey(masks);
          output.push({
            masks,
            key,
            orderCount: requirePositiveQuality(Number(buffer[base + 7]), {
              key,
              label: "playableOrderCount",
            }),
            saved: Number(buffer[base + 8]),
          });
        }
        return output;
      } finally {
        this.e.wasm_dealloc_u64(pointer, words);
      }
    }

    const output = [];
    for (let index = 0; index < count; index += 1) {
      const masks = [];
      for (let piece = 0; piece < 7; piece += 1) {
        masks.push(this.e.solver_solution_mask(this.ptr, index, piece));
      }
      if (typeof this.e.solver_solution_order_count !== "function") {
        throw new Error("WASM solution export is missing solver_solution_order_count");
      }
      const key = solutionKey(masks);
      output.push({
        masks,
        key,
        orderCount: requirePositiveQuality(wasmU32(this.e.solver_solution_order_count(this.ptr, index)), {
          key,
          label: "playableOrderCount",
        }),
        saved: wasmU32(this.e.solver_solution_saved_piece?.(this.ptr, index) ?? 7),
      });
    }
    return output;
  }

  canPc(board, queue, useHold = true) {
    return Boolean(this.e.solver_can_pc(
      this.ptr,
      board,
      queueBits(queue),
      queue.length,
      useHold ? 1 : 0,
    ));
  }

  canPcMany(board, queues, useHold = true) {
    if (this.height >= 5 && queues.length >= 256 && this.e.solver_can_pc_pattern_many) {
      return this.canPcPatternMany(board, queues, useHold);
    }
    if (!this.e.solver_can_pc_many || !this.e.wasm_alloc_u64 || !this.e.wasm_dealloc_u64) {
      return queues.map((queue) => this.canPc(board, queue, useHold));
    }
    if (queues.length === 0) return [];
    return this._withPackedQueues(queues, (queuePointer, lengthPointer) => {
      const outputPointer = this.e.wasm_alloc(queues.length);
      try {
        if (!this.e.solver_can_pc_many(
          this.ptr,
          board,
          queuePointer,
          lengthPointer,
          queues.length,
          useHold ? 1 : 0,
          outputPointer,
        )) throw new Error("WASM canPcMany failed");
        return Array.from(
          new Uint8Array(this.e.memory.buffer, outputPointer, queues.length),
          (value) => value !== 0,
        );
      } finally {
        this.e.wasm_dealloc(outputPointer, queues.length);
      }
    });
  }

  canPcPatternMany(board, queues, useHold = true) {
    if (this.height <= 4 || !this.e.solver_can_pc_pattern_many) {
      return this.canPcMany(board, queues, useHold);
    }
    if (queues.length === 0) return [];
    return this._withPackedQueues(queues, (queuePointer, lengthPointer) => {
      const outputPointer = this.e.wasm_alloc(queues.length);
      try {
        if (!this.e.solver_can_pc_pattern_many(
          this.ptr,
          board,
          queuePointer,
          lengthPointer,
          queues.length,
          useHold ? 1 : 0,
          outputPointer,
        )) throw new Error("WASM canPcPatternMany failed");
        return Array.from(
          new Uint8Array(this.e.memory.buffer, outputPointer, queues.length),
          (value) => value !== 0,
        );
      } finally {
        this.e.wasm_dealloc(outputPointer, queues.length);
      }
    });
  }

  enumeratePc(board, queue, useHold = true) {
    const count = wasmU32(this.e.solver_enumerate_pc(
      this.ptr,
      board,
      queueBits(queue),
      queue.length,
      useHold ? 1 : 0,
    ));
    return this._readSolutions(count);
  }

  bestPc(board, queue, useHold = true) {
    if (!this.e.solver_best_pc) return preferredSolution(this.enumeratePc(board, queue, useHold));
    const count = wasmU32(this.e.solver_best_pc(
      this.ptr,
      board,
      queueBits(queue),
      queue.length,
      useHold ? 1 : 0,
    ));
    return this._readSolutions(count)[0] ?? null;
  }

  enumeratePcPattern(board, queues, useHold = true) {
    if (!this.e.solver_enumerate_pc_pattern || !this.e.solver_pattern_coverage_offset) {
      return null;
    }
    if (queues.length === 0) return [];
    return this._withPackedQueues(queues, (queuePointer, lengthPointer) => {
      const count = wasmU32(this.e.solver_enumerate_pc_pattern(
        this.ptr,
        board,
        queuePointer,
        lengthPointer,
        queues.length,
        useHold ? 1 : 0,
      ));
      if (count === U32_MAX) throw new Error("WASM pattern enumeration failed");
      const solutions = this._readSolutions(count);
      return solutions.map((solution, index) => {
        const start = wasmU32(this.e.solver_pattern_coverage_offset(this.ptr, index));
        const end = wasmU32(this.e.solver_pattern_coverage_offset(this.ptr, index + 1));
        if (start === U32_MAX || end === U32_MAX || end < start) {
          throw new Error("invalid WASM pattern coverage offsets");
        }
        const coverage = [];
        for (let coverageIndex = start; coverageIndex < end; coverageIndex += 1) {
          const caseIndex = wasmU32(this.e.solver_pattern_coverage_case(this.ptr, coverageIndex));
          coverage.push({
            caseIndex,
            orderCount: requirePositiveQuality(
              wasmU32(this.e.solver_pattern_coverage_order_count(this.ptr, coverageIndex)),
              { key: solution.key, caseId: caseIndex, label: "playableOrderCount" },
            ),
          });
        }
        return { ...solution, coverage };
      });
    });
  }

  enumeratePcMany(board, queues, useHold = true) {
    const threshold = this.height <= 4 ? 256 : 24;
    if (queues.length < threshold || typeof this.enumeratePcPattern !== "function") {
      return queues.map((queue) => this.enumeratePc(board, queue, useHold));
    }
    const rows = this.enumeratePcPattern(board, queues, useHold);
    if (!Array.isArray(rows)) return queues.map((queue) => this.enumeratePc(board, queue, useHold));
    const output = Array.from({ length: queues.length }, () => []);
    for (const solution of rows) {
      for (const hit of solution.coverage) {
        if (hit.caseIndex >= output.length) continue;
        output[hit.caseIndex].push({
          masks: solution.masks,
          key: solution.key,
          orderCount: hit.orderCount,
          saved: solution.saved,
        });
      }
    }
    for (const row of output) row.sort((left, right) => left.key.localeCompare(right.key));
    return output;
  }

  perSaveBest(board, queue, useHold = true, { candidateLimit = 16 } = {}) {
    if (!this.e.solver_per_save_best) return null;
    const limit = Math.max(1, Math.min(65535, Number(candidateLimit) || 16));
    const count = wasmU32(this.e.solver_per_save_best(
      this.ptr,
      board,
      queueBits(queue),
      queue.length,
      useHold ? 1 : 0,
      limit,
    ));
    return this._readSolutions(count).map((solution) => ({
      ...solution,
      saved: Number(solution.saved ?? 7),
    }));
  }

  primaryKernelize(rawCases, solutionCount) {
    if (!this.e.solver_primary_kernelize || !this.e.wasm_alloc_u32 || !this.e.wasm_dealloc_u32) return null;
    let entryCount = 0;
    for (const row of rawCases) entryCount += row.length;
    const offsets = new Uint32Array(rawCases.length + 1);
    const ids = new Uint32Array(entryCount);
    let position = 0;
    for (let caseIndex = 0; caseIndex < rawCases.length; caseIndex += 1) {
      offsets[caseIndex] = position;
      for (const id of rawCases[caseIndex]) ids[position++] = id;
    }
    offsets[rawCases.length] = position;
    const offsetPointer = this.e.wasm_alloc_u32(offsets.length);
    const idPointer = this.e.wasm_alloc_u32(ids.length);
    try {
      new Uint32Array(this.e.memory.buffer, offsetPointer, offsets.length).set(offsets);
      if (ids.length) new Uint32Array(this.e.memory.buffer, idPointer, ids.length).set(ids);
      const status = wasmU32(this.e.solver_primary_kernelize(
        this.ptr, offsetPointer, rawCases.length, idPointer, entryCount, Number(solutionCount),
      ));
      if (status === U32_MAX) throw new Error('Rust primary kernelization failed');
      const caseCount = wasmU32(this.e.solver_primary_kernel_case_count(this.ptr));
      const kernelEntryCount = wasmU32(this.e.solver_primary_kernel_entry_count(this.ptr));
      const kernelSolutionCount = wasmU32(this.e.solver_primary_kernel_solution_count(this.ptr));
      const forcedCount = wasmU32(this.e.solver_primary_kernel_forced_count(this.ptr));
      const memory = this.e.memory.buffer;
      const offsetsPtr = Number(this.e.solver_primary_kernel_offsets_ptr(this.ptr));
      const idsPtr = Number(this.e.solver_primary_kernel_ids_ptr(this.ptr));
      const solutionIdsPtr = Number(this.e.solver_primary_kernel_solution_ids_ptr(this.ptr));
      const forcedPtr = Number(this.e.solver_primary_kernel_forced_ptr(this.ptr));
      const kernelOffsets = caseCount
        ? new Uint32Array(memory, offsetsPtr, caseCount + 1).slice()
        : new Uint32Array([0]);
      const kernelIds = kernelEntryCount
        ? new Uint32Array(memory, idsPtr, kernelEntryCount).slice()
        : new Uint32Array(0);
      const solutionIds = kernelSolutionCount
        ? [...new Uint32Array(memory, solutionIdsPtr, kernelSolutionCount)]
        : [];
      const forced = forcedCount
        ? [...new Uint32Array(memory, forcedPtr, forcedCount)]
        : [];
      const cases = new Array(caseCount);
      for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
        cases[caseIndex] = [...kernelIds.subarray(kernelOffsets[caseIndex], kernelOffsets[caseIndex + 1])];
      }
      return { cases, solutionIds, forced, entryCount: kernelEntryCount, backend: 'rust-kernel' };
    } finally {
      this.e.wasm_dealloc_u32(offsetPointer, offsets.length);
      this.e.wasm_dealloc_u32(idPointer, ids.length);
    }
  }

  minimumCoverCardinalityIds(rawCases, solutionCount) {
    if (!this.e.solver_min_cover_cardinality || !this.e.wasm_alloc_u32 || !this.e.wasm_dealloc_u32) return null;
    if (!rawCases.length) return { count: 0, selectedIds: [], searchedStates: 0 };
    let entryCount = 0;
    for (const row of rawCases) entryCount += row.length;
    const offsets = new Uint32Array(rawCases.length + 1);
    const ids = new Uint32Array(entryCount);
    let position = 0;
    for (let caseIndex = 0; caseIndex < rawCases.length; caseIndex += 1) {
      offsets[caseIndex] = position;
      for (const id of rawCases[caseIndex]) ids[position++] = id;
    }
    offsets[rawCases.length] = position;
    const offsetPointer = this.e.wasm_alloc_u32(offsets.length);
    const idPointer = this.e.wasm_alloc_u32(ids.length);
    try {
      new Uint32Array(this.e.memory.buffer, offsetPointer, offsets.length).set(offsets);
      if (ids.length) new Uint32Array(this.e.memory.buffer, idPointer, ids.length).set(ids);
      const count = wasmU32(this.e.solver_min_cover_cardinality(
        this.ptr, offsetPointer, rawCases.length, idPointer, entryCount, Number(solutionCount),
      ));
      if (count === U32_MAX) {
        return { count: Infinity, selectedIds: [], searchedStates: Number(this.e.solver_min_cover_searched_states?.(this.ptr) ?? 0n) };
      }
      const selectedIds = [];
      for (let index = 0; index < count; index += 1) {
        const id = wasmU32(this.e.solver_min_cover_selected(this.ptr, index));
        if (id < 0 || id >= solutionCount) throw new Error('invalid WASM numeric cardinality-only result');
        selectedIds.push(id);
      }
      return { count, selectedIds, searchedStates: Number(this.e.solver_min_cover_searched_states(this.ptr)) };
    } finally {
      this.e.wasm_dealloc_u32(offsetPointer, offsets.length);
      this.e.wasm_dealloc_u32(idPointer, ids.length);
    }
  }

  minimumCoverCardinality(coverage) {
    if (!this.e.solver_min_cover_cardinality || !this.e.wasm_alloc_u32 || !this.e.wasm_dealloc_u32) return null;
    const rawCases = [];
    const keySet = new Set();
    for (const [caseId, solutions] of coverage) {
      if (!solutions?.size) continue;
      const row = [...solutions];
      for (const key of row) keySet.add(key);
      rawCases.push({ caseId, row });
    }
    if (rawCases.length === 0) return { count: 0, keys: [], qualityVector: [], searchedStates: 0 };
    const keys = [...keySet].sort();
    const keyIndex = new Map(keys.map((key, index) => [key, index]));
    let entryCount = 0;
    for (const row of rawCases) entryCount += row.row.length;
    const offsets = new Uint32Array(rawCases.length + 1);
    const ids = new Uint32Array(entryCount);
    let position = 0;
    for (let caseIndex = 0; caseIndex < rawCases.length; caseIndex += 1) {
      offsets[caseIndex] = position;
      for (const key of rawCases[caseIndex].row) ids[position++] = keyIndex.get(key);
    }
    offsets[rawCases.length] = position;
    const offsetPointer = this.e.wasm_alloc_u32(offsets.length);
    const idPointer = this.e.wasm_alloc_u32(ids.length);
    try {
      new Uint32Array(this.e.memory.buffer, offsetPointer, offsets.length).set(offsets);
      if (ids.length) new Uint32Array(this.e.memory.buffer, idPointer, ids.length).set(ids);
      const count = wasmU32(this.e.solver_min_cover_cardinality(
        this.ptr, offsetPointer, rawCases.length, idPointer, entryCount, keys.length,
      ));
      if (count === U32_MAX) return { count: Infinity, keys: [], qualityVector: [], searchedStates: Number(this.e.solver_min_cover_searched_states?.(this.ptr) ?? 0n) };
      const selected = [];
      for (let index = 0; index < count; index += 1) {
        const id = wasmU32(this.e.solver_min_cover_selected(this.ptr, index));
        if (id >= keys.length) throw new Error('invalid WASM cardinality-only minimum-cover result');
        selected.push(keys[id]);
      }
      return { count, keys: selected, qualityVector: [], searchedStates: Number(this.e.solver_min_cover_searched_states(this.ptr)) };
    } finally {
      this.e.wasm_dealloc_u32(offsetPointer, offsets.length);
      this.e.wasm_dealloc_u32(idPointer, ids.length);
    }
  }

  minimumCoverIds(rawCases, solutionCount) {
    if (!this.e.solver_min_cover || !this.e.wasm_alloc_u32 || !this.e.wasm_dealloc_u32) return null;
    const cases = rawCases.filter((row) => row?.length);
    if (cases.length === 0) return { count: 0, selectedIds: [], qualityVector: [], searchedStates: 0 };
    let entryCount = 0;
    for (const row of cases) entryCount += row.length;
    const offsets = new Uint32Array(cases.length + 1);
    const ids = new Uint32Array(entryCount);
    const qualities = new Uint32Array(entryCount);
    let position = 0;
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      offsets[caseIndex] = position;
      for (const entry of cases[caseIndex]) {
        const id = Number(entry[0]);
        if (!Number.isInteger(id) || id < 0 || id >= solutionCount) {
          throw new Error(`invalid numeric minimum-cover candidate ${entry[0]}`);
        }
        ids[position] = id;
        qualities[position] = requirePositiveQuality(entry[1], { key: id, caseId: caseIndex });
        position += 1;
      }
    }
    offsets[cases.length] = position;
    const offsetPointer = this.e.wasm_alloc_u32(offsets.length);
    const idPointer = this.e.wasm_alloc_u32(ids.length);
    const qualityPointer = this.e.wasm_alloc_u32(qualities.length);
    try {
      new Uint32Array(this.e.memory.buffer, offsetPointer, offsets.length).set(offsets);
      if (ids.length) new Uint32Array(this.e.memory.buffer, idPointer, ids.length).set(ids);
      if (qualities.length) new Uint32Array(this.e.memory.buffer, qualityPointer, qualities.length).set(qualities);
      const count = wasmU32(this.e.solver_min_cover(
        this.ptr, offsetPointer, cases.length, idPointer, qualityPointer, entryCount, solutionCount,
      ));
      if (count === U32_MAX) {
        return {
          count: Infinity, selectedIds: [], qualityVector: [],
          searchedStates: Number(this.e.solver_min_cover_searched_states?.(this.ptr) ?? 0n),
        };
      }
      const selectedIds = [];
      for (let index = 0; index < count; index += 1) {
        const id = wasmU32(this.e.solver_min_cover_selected(this.ptr, index));
        if (id >= solutionCount) throw new Error("invalid WASM numeric minimum-cover result");
        selectedIds.push(id);
      }
      const qualityCount = wasmU32(this.e.solver_min_cover_quality_len(this.ptr));
      const qualityVector = [];
      for (let index = 0; index < qualityCount; index += 1) {
        qualityVector.push(wasmU32(this.e.solver_min_cover_quality(this.ptr, index)));
      }
      return {
        count, selectedIds, qualityVector,
        searchedStates: Number(this.e.solver_min_cover_searched_states(this.ptr)),
      };
    } finally {
      this.e.wasm_dealloc_u32(offsetPointer, offsets.length);
      this.e.wasm_dealloc_u32(idPointer, ids.length);
      this.e.wasm_dealloc_u32(qualityPointer, qualities.length);
    }
  }

  minimumCover(coverage, { qualityFor = null } = {}) {
    assertQualityProvider(qualityFor);
    if (qualityFor === null) return this.minimumCoverCardinality(coverage);
    if (!this.e.solver_min_cover || !this.e.wasm_alloc_u32 || !this.e.wasm_dealloc_u32) return null;
    const rawCases = [];
    const keySet = new Set();
    for (const [caseId, solutions] of coverage) {
      if (!solutions?.size) continue;
      const row = [...solutions];
      for (const key of row) keySet.add(key);
      rawCases.push({ caseId, row });
    }
    if (rawCases.length === 0) return { count: 0, keys: [], qualityVector: [], searchedStates: 0 };

    const keys = [...keySet].sort();
    const keyIndex = new Map(keys.map((key, index) => [key, index]));
    let entryCount = 0;
    for (const row of rawCases) entryCount += row.row.length;
    const offsets = new Uint32Array(rawCases.length + 1);
    const ids = new Uint32Array(entryCount);
    const qualities = new Uint32Array(entryCount);
    let position = 0;
    for (let caseIndex = 0; caseIndex < rawCases.length; caseIndex += 1) {
      offsets[caseIndex] = position;
      const row = rawCases[caseIndex];
      for (const key of row.row) {
        ids[position] = keyIndex.get(key);
        qualities[position] = requirePositiveQuality(qualityFor(key, row.caseId), {
          key,
          caseId: row.caseId,
        });
        position += 1;
      }
    }
    offsets[rawCases.length] = position;

    const offsetPointer = this.e.wasm_alloc_u32(offsets.length);
    const idPointer = this.e.wasm_alloc_u32(ids.length);
    const qualityPointer = this.e.wasm_alloc_u32(qualities.length);
    try {
      new Uint32Array(this.e.memory.buffer, offsetPointer, offsets.length).set(offsets);
      if (ids.length) new Uint32Array(this.e.memory.buffer, idPointer, ids.length).set(ids);
      if (qualities.length) new Uint32Array(this.e.memory.buffer, qualityPointer, qualities.length).set(qualities);
      const count = wasmU32(this.e.solver_min_cover(
        this.ptr,
        offsetPointer,
        rawCases.length,
        idPointer,
        qualityPointer,
        entryCount,
        keys.length,
      ));
      if (count === U32_MAX) {
        return {
          count: Infinity,
          keys: [],
          qualityVector: [],
          searchedStates: Number(this.e.solver_min_cover_searched_states?.(this.ptr) ?? 0n),
        };
      }
      const selected = [];
      for (let index = 0; index < count; index += 1) {
        const id = wasmU32(this.e.solver_min_cover_selected(this.ptr, index));
        if (id >= keys.length) throw new Error("invalid WASM minimum-cover result");
        selected.push(keys[id]);
      }
      const qualityCount = wasmU32(this.e.solver_min_cover_quality_len(this.ptr));
      const qualityVector = [];
      for (let index = 0; index < qualityCount; index += 1) {
        qualityVector.push(wasmU32(this.e.solver_min_cover_quality(this.ptr, index)));
      }
      return {
        count,
        keys: selected,
        qualityVector,
        searchedStates: Number(this.e.solver_min_cover_searched_states(this.ptr)),
      };
    } finally {
      this.e.wasm_dealloc_u32(offsetPointer, offsets.length);
      this.e.wasm_dealloc_u32(idPointer, ids.length);
      this.e.wasm_dealloc_u32(qualityPointer, qualities.length);
    }
  }

  minimumCoverAtCount(coverage, exactCount, {
    qualityFor = null,
    seedKeys = [],
    lockedPrefix = [],
    stateBudget = null,
    integrated = false,
    dominance = false,
  } = {}) {
    assertQualityProvider(qualityFor);
    if (qualityFor === null) throw new Error("minimumCoverAtCount requires a positive human-quality provider");
    const bounded = stateBudget != null;
    if (integrated && lockedPrefix.length) throw new Error('integrated fixed-K search does not accept lockedPrefix');
    if (bounded && lockedPrefix.length) throw new Error('bounded fixed-K probe does not accept lockedPrefix');
    if (dominance && !integrated) throw new Error('candidate dominance preview requires integrated fixed-K search');
    const exactExport = this.e.solver_min_cover_at_count_locked;
    const boundedExport = integrated
      ? (dominance
        ? this.e.solver_min_cover_at_count_integrated_dominance_bounded
        : this.e.solver_min_cover_at_count_integrated_bounded)
      : this.e.solver_min_cover_at_count_bounded;
    if ((integrated || bounded ? !boundedExport : !exactExport) || !this.e.wasm_alloc_u32 || !this.e.wasm_dealloc_u32) return null;
    const rawCases = [];
    const keySet = new Set();
    for (const [caseId, solutions] of coverage) {
      if (!solutions?.size) continue;
      const row = [...solutions];
      for (const key of row) keySet.add(key);
      rawCases.push({ caseId, row });
    }
    if (rawCases.length === 0) {
      const completed = Number(exactCount) === 0;
      return completed
        ? { count: 0, keys: [], qualityVector: [], searchedStates: 0, completed: true }
        : { count: Infinity, keys: [], qualityVector: [], searchedStates: 0, completed: false, error: true };
    }
    const keys = [...keySet].sort();
    const keyIndex = new Map(keys.map((key, index) => [key, index]));
    const seedIds = Uint32Array.from(seedKeys.map((key) => {
      const id = keyIndex.get(key);
      if (id === undefined) throw new Error(`fixed-count seed key is not a candidate: ${key}`);
      return id;
    }));
    const locked = Uint32Array.from(lockedPrefix.map((value) => Math.max(0, Math.floor(Number(value) || 0))));
    let entryCount = 0;
    for (const row of rawCases) entryCount += row.row.length;
    const offsets = new Uint32Array(rawCases.length + 1);
    const ids = new Uint32Array(entryCount);
    const qualities = new Uint32Array(entryCount);
    let position = 0;
    for (let caseIndex = 0; caseIndex < rawCases.length; caseIndex += 1) {
      offsets[caseIndex] = position;
      const row = rawCases[caseIndex];
      for (const key of row.row) {
        ids[position] = keyIndex.get(key);
        qualities[position] = requirePositiveQuality(qualityFor(key, row.caseId), {
          key,
          caseId: row.caseId,
        });
        position += 1;
      }
    }
    offsets[rawCases.length] = position;
    const offsetPointer = this.e.wasm_alloc_u32(offsets.length);
    const idPointer = this.e.wasm_alloc_u32(ids.length);
    const qualityPointer = this.e.wasm_alloc_u32(qualities.length);
    const seedPointer = this.e.wasm_alloc_u32(seedIds.length);
    const lockedPointer = this.e.wasm_alloc_u32(locked.length);
    try {
      new Uint32Array(this.e.memory.buffer, offsetPointer, offsets.length).set(offsets);
      if (ids.length) new Uint32Array(this.e.memory.buffer, idPointer, ids.length).set(ids);
      if (qualities.length) new Uint32Array(this.e.memory.buffer, qualityPointer, qualities.length).set(qualities);
      if (seedIds.length) new Uint32Array(this.e.memory.buffer, seedPointer, seedIds.length).set(seedIds);
      if (locked.length) new Uint32Array(this.e.memory.buffer, lockedPointer, locked.length).set(locked);

      let status;
      if (integrated || bounded) {
        const budget = bounded
          ? Math.max(1, Math.min(0xfffffffd, Math.floor(Number(stateBudget) || 0)))
          : 0;
        status = wasmU32(boundedExport(
          this.ptr,
          offsetPointer,
          rawCases.length,
          idPointer,
          qualityPointer,
          entryCount,
          keys.length,
          Number(exactCount),
          seedPointer,
          seedIds.length,
          budget,
        ));
      } else {
        status = wasmU32(exactExport(
          this.ptr,
          offsetPointer,
          rawCases.length,
          idPointer,
          qualityPointer,
          entryCount,
          keys.length,
          Number(exactCount),
          seedPointer,
          seedIds.length,
          lockedPointer,
          locked.length,
        ));
      }
      const statusU32 = status >>> 0;
      if (statusU32 === U32_MAX) {
        return { count: Infinity, keys: [], qualityVector: [], searchedStates: Number(this.e.solver_min_cover_searched_states?.(this.ptr) ?? 0n), completed: false, error: true };
      }
      const completed = statusU32 !== 0xfffffffe;
      const selectedCount = completed ? statusU32 : Number(exactCount);
      const selected = [];
      for (let index = 0; index < selectedCount; index += 1) {
        const id = wasmU32(this.e.solver_min_cover_selected(this.ptr, index));
        if (id >= keys.length) throw new Error('invalid WASM fixed-count minimum-cover result');
        selected.push(keys[id]);
      }
      const qualityCount = wasmU32(this.e.solver_min_cover_quality_len(this.ptr));
      const qualityVector = [];
      for (let index = 0; index < qualityCount; index += 1) qualityVector.push(wasmU32(this.e.solver_min_cover_quality(this.ptr, index)));
      return {
        count: completed ? statusU32 : Number(exactCount),
        keys: selected,
        qualityVector,
        searchedStates: Number(this.e.solver_min_cover_searched_states(this.ptr)),
        completed,
      };
    } finally {
      this.e.wasm_dealloc_u32(offsetPointer, offsets.length);
      this.e.wasm_dealloc_u32(idPointer, ids.length);
      this.e.wasm_dealloc_u32(qualityPointer, qualities.length);
      this.e.wasm_dealloc_u32(seedPointer, seedIds.length);
      this.e.wasm_dealloc_u32(lockedPointer, locked.length);
    }
  }

  legalCount(stage) { return wasmU32(this.e.solver_legal_count(this.ptr, stage)); }
  legalPackVersion() { return wasmU32(this.e.solver_legal_pack_version?.(this.ptr) ?? 0); }
  legalMemoryBytes() { return wasmU32(this.e.solver_legal_memory_bytes?.(this.ptr) ?? 0); }
  stage8OracleEntries() { return wasmU32(this.e.solver_stage8_oracle_entries?.(this.ptr) ?? 0); }
  stage9OracleEntries() { return wasmU32(this.e.solver_stage9_oracle_entries?.(this.ptr) ?? 0); }

  stats() {
    return {
      nodes: Number(this.e.solver_nodes(this.ptr)),
      cacheHits: Number(this.e.solver_cache_hits(this.ptr)),
      cacheMisses: Number(this.e.solver_cache_misses(this.ptr)),
      legalRejects: Number(this.e.solver_legal_rejects(this.ptr)),
      cacheEntries: wasmU32(this.e.solver_cache_entries?.(this.ptr) ?? 0),
    };
  }

  close() {
    if (this.ptr) {
      this.e.solver_free(this.ptr);
      this.ptr = 0;
    }
  }
}

export async function createWasmSolver(height = 4, { legal = true } = {}) {
  const assets = await loadWasmAssets();
  return new WasmPcSolver(assets.exports, height, legal ? assets.legal : null);
}
