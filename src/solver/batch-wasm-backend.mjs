const PIECE_CODE = { I: 0, J: 1, L: 2, O: 3, S: 4, T: 5, Z: 6 };
const CODE_PIECE = ["I", "J", "L", "O", "S", "T", "Z"];
const MODE_CODE = {
  normal: 0,
  tetris: 1,
  "tetris-end": 2,
  "1l": 3,
  "1l-or-pc": 4,
  "2l": 5,
  "2l-or-pc": 6,
  "3l": 7,
  "3l-or-pc": 8,
  "4l": 9,
  "4l-or-pc": 10,
  tsm: 11,
  tss: 12,
  tsd: 13,
  tst: 14,
  b2b: 15,
};

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

let batchAssetsPromise;

export async function loadBatchWasm() {
  batchAssetsPromise ??= (async () => {
    const wasm = await bytesFor(new URL(
      "../../vendor/sfinder-wasm/upstream/wasm/batch_wasm.wasm",
      import.meta.url,
    ));
    const { instance } = await WebAssembly.instantiate(wasm, {});
    return instance.exports;
  })();
  return batchAssetsPromise;
}

function packQueue(queue) {
  if (queue.length > 21) throw new Error(`batch queue length ${queue.length} exceeds 21`);
  let bits = 0n;
  for (let index = 0; index < queue.length; index += 1) {
    const piece = PIECE_CODE[queue[index]];
    if (piece === undefined) throw new Error(`bad piece ${queue[index]}`);
    bits |= BigInt(piece) << BigInt(index * 3);
  }
  return bits;
}

export class BatchReachability {
  constructor(exports, height = 4, physics = "jstris") {
    this.e = exports;
    this.height = height;
    this.physics = physics === "tetrio" ? 1 : 0;
  }

  placeExact(board, piece, cells) {
    const pieceCode = PIECE_CODE[piece];
    if (pieceCode === undefined) throw new Error(`bad piece ${piece}`);
    const value = this.e.batch_place_exact(board, pieceCode, cells, this.height, this.physics);
    if (value === 0n) return null;
    return value & ((1n << 63n) - 1n);
  }

  tSpinKind(board, cells) {
    return Number(this.e.batch_tspin_kind(board, cells, this.height, this.physics));
  }

  run({ base = 0n, operations, queues = [], mode = "normal", useHold = true }) {
    if (this.height > 4) return null;
    if (!this.e.batch_engine_reset || operations.length > 10) return null;
    if (queues.some((entry) => (typeof entry === "string" ? entry : entry.queue).length > 21)) return null;
    const modeCode = MODE_CODE[mode];
    if (modeCode === undefined) throw new Error(`unsupported batch engine mode '${mode}'`);
    this.e.batch_engine_reset();
    for (const operation of operations) {
      const piece = PIECE_CODE[operation.piece];
      if (piece === undefined || this.e.batch_engine_add_operation(piece, operation.mask) !== 1) {
        throw new Error("batch engine rejected operation set");
      }
    }
    for (const entry of queues) {
      const queue = typeof entry === "string" ? entry : entry.queue;
      if (this.e.batch_engine_add_queue(packQueue(queue), queue.length) !== 1) {
        throw new Error("batch engine rejected queue");
      }
    }
    const count = Number(this.e.batch_engine_run(
      base,
      this.height,
      this.physics,
      modeCode,
      useHold ? 1 : 0,
    ));
    if (count === 0xffffffff) throw new Error("batch engine failed");
    const variants = [];
    for (let variantIndex = 0; variantIndex < count; variantIndex += 1) {
      const ids = this.e.batch_engine_variant_ids(variantIndex);
      const clears = Number(this.e.batch_engine_variant_clears(variantIndex));
      const spins = Number(this.e.batch_engine_variant_tspins(variantIndex));
      const pcMask = Number(this.e.batch_engine_variant_pc_mask(variantIndex));
      let order = "";
      const trace = [];
      for (let index = 0; index < operations.length; index += 1) {
        const id = Number((ids >> BigInt(index * 4)) & 15n);
        const operation = operations[id];
        const clearLines = (clears >>> (index * 3)) & 7;
        const tSpinKind = (spins >>> (index * 2)) & 3;
        order += operation.piece;
        trace.push({ id, piece: operation.piece, mask: operation.mask, clearLines, pcAfter: Boolean(pcMask & (1 << index)), tSpinKind });
      }
      variants.push({ order, trace });
    }
    const covered = queues.map((_, index) => this.e.batch_engine_case_covered(index) !== 0);
    return { variants, covered };
  }

  buildVariants({ base = 0n, operations, mode = "normal" }) {
    return this.run({ base, operations, mode })?.variants ?? null;
  }

  coverTarget({ base = 0n, operations, cases, mode = "normal", useHold = true }) {
    return this.run({ base, operations, queues: cases, mode, useHold });
  }

  congruent({ base = 0n, fill = 0n, queues = [], useHold = true, maxSolutions = 20000 }) {
    if (this.height > 4 || !this.e.batch_congruent_run) return null;
    this.e.batch_engine_reset();
    for (const queue of queues) {
      if (queue.length > 21) return null;
      if (this.e.batch_engine_add_queue(packQueue(queue), queue.length) !== 1) {
        throw new Error("batch engine rejected queue");
      }
    }
    const count = Number(this.e.batch_congruent_run(
      base,
      fill,
      this.height,
      this.physics,
      useHold ? 1 : 0,
      maxSolutions,
    ));
    if (count === 0xffffffff) throw new Error(`congruent tiling limit ${maxSolutions} reached`);
    const output = [];
    for (let solutionIndex = 0; solutionIndex < count; solutionIndex += 1) {
      const operationCount = Number(this.e.batch_congruent_operation_count(solutionIndex));
      const operations = [];
      for (let operationIndex = 0; operationIndex < operationCount; operationIndex += 1) {
        const piece = Number(this.e.batch_congruent_operation_piece(solutionIndex, operationIndex));
        operations.push({
          piece: CODE_PIECE[piece],
          mask: this.e.batch_congruent_operation_mask(solutionIndex, operationIndex),
        });
      }
      const orders = [];
      const orderCount = Number(this.e.batch_congruent_order_count(solutionIndex));
      for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
        const packed = this.e.batch_congruent_order(solutionIndex, orderIndex);
        let order = "";
        for (let index = 0; index < operationCount; index += 1) {
          order += CODE_PIECE[Number((packed >> BigInt(index * 3)) & 7n)];
        }
        orders.push(order);
      }
      output.push({ operations, orders });
    }
    return output;
  }
}
