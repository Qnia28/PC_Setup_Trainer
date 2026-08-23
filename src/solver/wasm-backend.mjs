const PIECE_CODE = { I: 0, J: 1, L: 2, O: 3, S: 4, T: 5, Z: 6 };

function queueBits(queue) {
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
    const wasm = await bytesFor(new URL("../../vendor/sfinder-wasm/upstream/wasm/pc_wasm.wasm", import.meta.url));
    const legal = await bytesFor(new URL("../../vendor/sfinder-wasm/upstream/wasm/legal_boards_4.lgb", import.meta.url));
    const { instance } = await WebAssembly.instantiate(wasm, {});
    return { exports: instance.exports, legal };
  })();
  return assetsPromise;
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
    const queuePointer = this.e.wasm_alloc_u64(queues.length);
    const lengthPointer = this.e.wasm_alloc(queues.length);
    const outputPointer = this.e.wasm_alloc(queues.length);
    try {
      const queueBuffer = new BigUint64Array(this.e.memory.buffer, queuePointer, queues.length);
      const lengthBuffer = new Uint8Array(this.e.memory.buffer, lengthPointer, queues.length);
      for (let index = 0; index < queues.length; index += 1) {
        const queue = queues[index];
        if (queue.length > 21) throw new Error(`queue length ${queue.length} exceeds 21`);
        queueBuffer[index] = queueBits(queue);
        lengthBuffer[index] = queue.length;
      }
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
      this.e.wasm_dealloc_u64(queuePointer, queues.length);
      this.e.wasm_dealloc(lengthPointer, queues.length);
      this.e.wasm_dealloc(outputPointer, queues.length);
    }
  }

  canPcPatternMany(board, queues, useHold = true) {
    if (this.height <= 4 || !this.e.solver_can_pc_pattern_many) {
      return this.canPcMany(board, queues, useHold);
    }
    if (queues.length === 0) return [];
    const queuePointer = this.e.wasm_alloc_u64(queues.length);
    const lengthPointer = this.e.wasm_alloc(queues.length);
    const outputPointer = this.e.wasm_alloc(queues.length);
    try {
      const queueBuffer = new BigUint64Array(this.e.memory.buffer, queuePointer, queues.length);
      const lengthBuffer = new Uint8Array(this.e.memory.buffer, lengthPointer, queues.length);
      for (let index = 0; index < queues.length; index += 1) {
        const queue = queues[index];
        if (queue.length > 21) throw new Error(`queue length ${queue.length} exceeds 21`);
        queueBuffer[index] = queueBits(queue);
        lengthBuffer[index] = queue.length;
      }
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
      this.e.wasm_dealloc_u64(queuePointer, queues.length);
      this.e.wasm_dealloc(lengthPointer, queues.length);
      this.e.wasm_dealloc(outputPointer, queues.length);
    }
  }

  enumeratePc(board, queue, useHold = true) {
    const count = Number(this.e.solver_enumerate_pc(
      this.ptr,
      board,
      queueBits(queue),
      queue.length,
      useHold ? 1 : 0,
    ));
    const output = [];
    for (let index = 0; index < count; index += 1) {
      const masks = [];
      for (let piece = 0; piece < 7; piece += 1) {
        masks.push(this.e.solver_solution_mask(this.ptr, index, piece));
      }
      output.push({
        masks,
        key: masks.map((mask) => mask.toString(16)).join(":"),
        orderCount: Number(this.e.solver_solution_order_count?.(this.ptr, index) ?? 0),
      });
    }
    return output;
  }

  enumeratePcPattern(board, queues, useHold = true) {
    if (this.height <= 4 || !this.e.solver_enumerate_pc_pattern || !this.e.solver_pattern_coverage_offset) {
      return null;
    }
    if (queues.length === 0) return [];
    const queuePointer = this.e.wasm_alloc_u64(queues.length);
    const lengthPointer = this.e.wasm_alloc(queues.length);
    try {
      const queueBuffer = new BigUint64Array(this.e.memory.buffer, queuePointer, queues.length);
      const lengthBuffer = new Uint8Array(this.e.memory.buffer, lengthPointer, queues.length);
      for (let index = 0; index < queues.length; index += 1) {
        const queue = queues[index];
        if (queue.length > 21) throw new Error(`queue length ${queue.length} exceeds 21`);
        queueBuffer[index] = queueBits(queue);
        lengthBuffer[index] = queue.length;
      }
      const count = Number(this.e.solver_enumerate_pc_pattern(
        this.ptr,
        board,
        queuePointer,
        lengthPointer,
        queues.length,
        useHold ? 1 : 0,
      ));
      if (count === 0xffffffff) throw new Error("WASM pattern enumeration failed");
      const output = [];
      for (let index = 0; index < count; index += 1) {
        const masks = [];
        for (let piece = 0; piece < 7; piece += 1) {
          masks.push(this.e.solver_solution_mask(this.ptr, index, piece));
        }
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
        output.push({
          masks,
          key: masks.map((mask) => mask.toString(16)).join(":"),
          orderCount: Number(this.e.solver_solution_order_count?.(this.ptr, index) ?? 0),
          coverage,
        });
      }
      return output;
    } finally {
      this.e.wasm_dealloc_u64(queuePointer, queues.length);
      this.e.wasm_dealloc(lengthPointer, queues.length);
    }
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
        if (hit.caseIndex < output.length) {
          output[hit.caseIndex].push({
            masks: solution.masks,
            key: solution.key,
            orderCount: hit.orderCount,
          });
        }
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
    const output = [];
    for (let index = 0; index < count; index += 1) {
      const masks = [];
      for (let piece = 0; piece < 7; piece += 1) {
        masks.push(this.e.solver_solution_mask(this.ptr, index, piece));
      }
      output.push({
        saved: Number(this.e.solver_solution_saved_piece(this.ptr, index)),
        masks,
        key: masks.map((mask) => mask.toString(16)).join(":"),
        orderCount: Number(this.e.solver_solution_order_count(this.ptr, index)),
      });
    }
    return output;
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
    for (const entry of rawCases) entryCount += entry.row.length;
    const offsets = new Uint32Array(rawCases.length + 1);
    const ids = new Uint32Array(entryCount);
    const qualities = new Uint32Array(entryCount);
    let position = 0;
    for (let caseIndex = 0; caseIndex < rawCases.length; caseIndex += 1) {
      offsets[caseIndex] = position;
      const entry = rawCases[caseIndex];
      for (const key of entry.row) {
        ids[position] = keyIndex.get(key);
        const rawQuality = qualityFor ? Number(qualityFor(key, entry.caseId)) : 0;
        qualities[position] = Number.isFinite(rawQuality)
          ? Math.max(0, Math.min(0xffffffff, Math.floor(rawQuality)))
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
      const qualityLength = Number(this.e.solver_min_cover_quality_len(this.ptr));
      const qualityVector = [];
      for (let index = 0; index < qualityLength; index += 1) {
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

  close() {
    if (!this.ptr) return;
    this.e.solver_free(this.ptr);
    this.ptr = 0;
  }
}
