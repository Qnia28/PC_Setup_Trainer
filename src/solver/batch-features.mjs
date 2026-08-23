import { decoder, encoder } from "tetris-fumen";
import { expandPattern, expandPatternCases, queuesForFinder } from "../../vendor/sfinder-wasm/upstream/src/pattern.mjs";
import { coloredOperationSets, fieldMasks, aggregateMasks } from "../../vendor/sfinder-wasm/upstream/src/batch-geometry.mjs";
import { coverTargets } from "../../vendor/sfinder-wasm/upstream/src/batch-cover.mjs";
import { findCongruentSolutions } from "../../vendor/sfinder-wasm/upstream/src/batch-setup.mjs";
import { solutionPage } from "../../vendor/sfinder-wasm/upstream/src/fumen.mjs";
import { loadBatchWasm, BatchReachability } from "./batch-wasm-backend.mjs";

const MASK_ORDER = "IJLOSTZ";

function booleanMirror(value) {
  return value === true || String(value).toLowerCase() === "yes";
}

function masksArray(operations) {
  const masks = aggregateMasks(operations);
  return [...MASK_ORDER].map((piece) => masks[piece] ?? 0n);
}

function solutionFromOperations(operations, comment = "") {
  const masks = masksArray(operations);
  return { masks, key: masks.map((mask) => mask.toString(16)).join(":"), comment };
}

function decodedTargets(sourceFumen, height) {
  const pages = decoder.decode(sourceFumen);
  if (!pages.length) throw new Error("input Fumen has no pages");
  const targets = [];
  for (const page of pages) {
    const { base, operationSets } = coloredOperationSets(page, height, { assembleOperation: true });
    for (const operations of operationSets) targets.push({ base, operations, sourcePage: page });
  }
  return targets;
}

async function batchReachability(height, physics) {
  const exports = await loadBatchWasm();
  return new BatchReachability(exports, height, physics);
}

export async function warmBatchSolver() {
  const exports = await loadBatchWasm();
  return { ready: true, memoryBytes: exports.memory?.buffer?.byteLength ?? 0 };
}

export async function calculateCover({
  sourceFumen,
  pattern,
  clear = 4,
  mode = "normal",
  mirror = "no",
  useHold = true,
}) {
  if (clear < 2 || clear > 6) throw new Error(`unsupported clear height ${clear}`);
  const finderPattern = queuesForFinder(pattern);
  const queues = expandPatternCases(finderPattern);
  const targets = decodedTargets(sourceFumen, clear);
  const reachability = await batchReachability(clear, "jstris");
  const result = coverTargets({
    targets,
    queues,
    height: clear,
    reachability,
    useHold,
    mirror: booleanMirror(mirror),
    mode,
  });
  return {
    pathPattern: finderPattern,
    analysisPattern: pattern,
    mode: result.mode,
    mirror: booleanMirror(mirror),
    covered: result.covered,
    total: result.total,
    failed: result.failed.length,
    failedQueues: result.failed,
    percent: result.total ? result.covered / result.total * 100 : 0,
    targets: result.targets,
  };
}

export async function calculateCongruent({
  sourceFumen,
  pattern,
  clear = 4,
  blueGarbage = false,
  useHold = true,
  _keepVariants = false,
}) {
  if (clear < 2 || clear > 6) throw new Error(`unsupported clear height ${clear}`);
  const pages = decoder.decode(sourceFumen);
  if (!pages.length) throw new Error("input Fumen has no pages");
  const finderPattern = queuesForFinder(pattern);
  const queues = expandPattern(finderPattern);
  const reachability = await batchReachability(clear, "tetrio");
  const output = [];
  for (const page of pages) {
    let { base, fill } = fieldMasks(page, clear);
    if (blueGarbage) {
      fill |= base;
      base = 0n;
    }
    const solutions = findCongruentSolutions({ base, fill, queues, height: clear, reachability, useHold });
    for (const solution of solutions) {
      if (_keepVariants) {
        output.push({ ...solution, base });
      } else {
        const { variants: _variants, ...publicSolution } = solution;
        output.push({ ...publicSolution, base });
      }
    }
  }
  if (!output.length) throw new Error("no congruent solutions");
  const fumen = encoder.encode(output.map((solution) => solutionPage(
    solution.base,
    solutionFromOperations(solution.operations),
    solution.comment,
    clear,
  )));
  return {
    pathPattern: finderPattern,
    analysisPattern: pattern,
    solutions: output,
    count: output.length,
    fumen,
  };
}

export async function calculateCongruentCover({
  sourceFumen,
  pattern,
  clear = 4,
  mode = "normal",
  mirror = "no",
  blueGarbage = false,
  useHold = true,
}) {
  const congruent = await calculateCongruent({
    sourceFumen,
    pattern,
    clear,
    blueGarbage,
    useHold,
    _keepVariants: true,
  });
  const queues = expandPatternCases(congruent.pathPattern);
  const reachability = await batchReachability(clear, "jstris");
  const targets = congruent.solutions.map((solution) => ({
    base: solution.base,
    operations: solution.operations,
    orders: solution.orders,
    variants: solution.variants,
    comment: solution.comment,
    key: solution.key,
  }));
  const result = coverTargets({
    targets,
    queues,
    height: clear,
    reachability,
    useHold,
    mirror: booleanMirror(mirror),
    mode,
  });
  const publicSolutions = congruent.solutions.map(({ variants: _variants, ...solution }) => solution);
  return {
    ...congruent,
    solutions: publicSolutions,
    mode: result.mode,
    mirror: booleanMirror(mirror),
    covered: result.covered,
    total: result.total,
    failed: result.failed.length,
    failedQueues: result.failed,
    percent: result.total ? result.covered / result.total * 100 : 0,
    coverTargets: result.targets,
  };
}
