import { preferredSolution } from "./human-ranking.mjs";
import { PIECE_CODE } from "./piece-order.mjs";
const DEFAULT_SOLUTION_WORD_STRIDE = 9;

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

let assetsPromise;

export async function loadWasmAssets() {
  assetsPromise ??= (async () => {
    const wasm = await bytesFor(new URL("../wasm/pc_wasm.wasm", import.meta.url));
    const legal = await bytesFor(new URL("../wasm/legal_boards_4.lgb", import.meta.url));
    const { instance } = await WebAssembly.instantiate(wasm, {});
    return { exports: instance.exports, legal };
  })();
  return assetsPromise;
}

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
      const stride = Number(this.e.solver_solution_word_stride?.() ?? DEFAULT_SOLUTION_WORD_STRIDE);
      if (stride < 9) throw new Error(`invalid solution word stride ${stride}`);
      const words = count * stride;
      const pointer = this.e.wasm_alloc_u64(words);
      try {
        const copied = Number(this.e.solver_copy_solution_words(this.ptr, pointer, words));
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
          output.push({
            masks,
            key: solutionKey(masks),
            orderCount: Number(buffer[base + 7]),
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
      output.push({
        masks,
        key: solutionKey(masks),
        orderCount: Number(this.e.solver_solution_order_count?.(this.ptr, index) ?? 0),
        saved: Number(this.e.solver_solution_saved_piece?.(this.ptr, index) ?? 7),
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
    const count = Number(this.e.solver_enumerate_pc(
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
    const count = Number(this.e.solver_best_pc(
      this.ptr,
      board,
      queueBits(queue),
      queue.length,
      useHold ? 1 : 0,
    ));
    return this._readSolutions(count)[0] ?? null;
  }

  enumeratePcPattern(board, queues, useHold = true) {
    if (this.height <= 4 || !this.e.solver_enumerate_pc_pattern || !this.e.solver_pattern_coverage_offset) {
      return null;
    }
    if (queues.length === 0) return [];
    return this._withPackedQueues(queues, (queuePointer, lengthPointer) => {
      const count = Number(this.e.solver_enumerate_pc_pattern(
        this.ptr,
        board,
        queuePointer,
        lengthPointer,
        queues.length,
        useHold ? 1 : 0,
      ));
      if (count === 0xffffffff) throw new Error("WASM pattern enumeration failed");
      const solutions = this._readSolutions(count);
      return solutions.map((solution, index) => {
        const start = Number(this.e.solver_pattern_coverage_offset(this.ptr, index));
        const end = Number(this.e.solver_pattern_coverage_offset(this.ptr, index + 1));
        if (start === 0xffffffff || end === 0xffffffff || end < start) {
          throw new Error("invalid WASM pattern coverage offsets");
        }
        const coverage = [];
        for (let coverageIndex = start; coverageIndex < end; coverageIndex += 1) {
          coverage.push({
            caseIndex: Number(this.e.solver_pattern_coverage_case(this.ptr, coverageIndex)),
            orderCount: Number(this.e.solver_pattern_coverage_order_count(this.ptr, coverageIndex)),
          });
        }
        return { ...solution, coverage };
      });
    });
  }

  enumeratePcMany(board, queues, useHold = true) {
    if (this.height <= 4 || queues.length < 24 || typeof this.enumeratePcPattern !== "function") {
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
    const count = Number(this.e.solver_per_save_best(
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

  minimumCover(coverage, { qualityFor = null } = {}) {
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
        const raw = qualityFor ? Number(qualityFor(key, row.caseId)) : 0;
        qualities[position] = Number.isFinite(raw)
          ? Math.max(0, Math.min(0xffffffff, Math.floor(raw)))
          : 0;
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
      const count = Number(this.e.solver_min_cover(
        this.ptr,
        offsetPointer,
        rawCases.length,
        idPointer,
        qualityPointer,
        entryCount,
        keys.length,
      ));
      if (count === 0xffffffff) {
        return {
          count: Infinity,
          keys: [],
          qualityVector: [],
          searchedStates: Number(this.e.solver_min_cover_searched_states?.(this.ptr) ?? 0n),
        };
      }
      const selected = [];
      for (let index = 0; index < count; index += 1) {
        const id = Number(this.e.solver_min_cover_selected(this.ptr, index));
        if (id >= keys.length) throw new Error("invalid WASM minimum-cover result");
        selected.push(keys[id]);
      }
      const qualityCount = Number(this.e.solver_min_cover_quality_len(this.ptr));
      const qualityVector = [];
      for (let index = 0; index < qualityCount; index += 1) {
        qualityVector.push(Number(this.e.solver_min_cover_quality(this.ptr, index)));
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

  legalCount(stage) { return Number(this.e.solver_legal_count(this.ptr, stage)); }
  legalPackVersion() { return Number(this.e.solver_legal_pack_version?.(this.ptr) ?? 0); }
  legalMemoryBytes() { return Number(this.e.solver_legal_memory_bytes?.(this.ptr) ?? 0); }
  stage8OracleEntries() { return Number(this.e.solver_stage8_oracle_entries?.(this.ptr) ?? 0); }
  stage9OracleEntries() { return Number(this.e.solver_stage9_oracle_entries?.(this.ptr) ?? 0); }

  stats() {
    return {
      nodes: Number(this.e.solver_nodes(this.ptr)),
      cacheHits: Number(this.e.solver_cache_hits(this.ptr)),
      cacheMisses: Number(this.e.solver_cache_misses(this.ptr)),
      legalRejects: Number(this.e.solver_legal_rejects(this.ptr)),
      cacheEntries: Number(this.e.solver_cache_entries?.(this.ptr) ?? 0),
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
