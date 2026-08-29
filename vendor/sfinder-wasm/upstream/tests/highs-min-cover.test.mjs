import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solveCardinalityKernel,
  refineMinimumCoverQuality,
  minimumCoverAsync,
  normalizeUseHiGHS,
  resolveUseHiGHS,
  prepareCoverageMatrix,
  isHardMinimumCover,
  isHardPrimaryKernel,
  primaryKernelStats,
  normalizeExactHumanQuality,
  kernelizeCardinality,
} from '../src/highs-min-cover.mjs';
import { createWasmSolver } from '../src/wasm-backend.mjs';

test('HiGHS cardinality backend solves an exact binary set-cover model', async () => {
  const rows = [
    [0, 2],
    [0, 1],
    [1, 2],
  ];
  const result = await solveCardinalityKernel(rows, 3);
  assert.equal(result.count, 2);
  const selected = new Set(result.selected);
  for (const row of rows) assert.ok(row.some((id) => selected.has(id)));
});


test('Rust/WASM primary kernelization matches JavaScript exact reductions', async () => {
  const solver = await createWasmSolver(4);
  try {
    const rows = [
      [0, 1, 2],
      [0, 1],
      [1, 2, 3],
      [3],
      [0, 1],
      [2, 4],
      [2, 4, 5],
    ];
    const js = kernelizeCardinality(rows, 6);
    const rust = solver.primaryKernelize(rows, 6);
    assert.deepEqual(rust.cases, js.cases);
    assert.deepEqual(rust.solutionIds, js.solutionIds);
    assert.deepEqual(rust.forced, js.forced);
    assert.equal(rust.entryCount, js.cases.reduce((sum, row) => sum + row.length, 0));
  } finally { solver.close(); }
});

test('hard-cover quality refinement preserves coverage/cardinality and improves lexicographic quality', () => {
  const prepared = {
    keys: ['a', 'b', 'c', 'd'],
    maxQuality: 4,
    cases: [
      [[0, 1], [2, 4]],
      [[0, 4], [3, 4]],
      [[1, 1], [2, 4]],
      [[1, 4], [3, 4]],
    ],
  };
  const initial = [0, 1];
  const refined = refineMinimumCoverQuality(prepared, initial);
  assert.equal(refined.selected.length, 2);
  assert.deepEqual(refined.selected, [2, 3]);
  assert.deepEqual(refined.qualityVector, [4, 4, 4, 4]);
});


test('UseHiGHS accepts True/False/Auto and Auto uses exact primary-kernel hardness', () => {
  assert.equal(normalizeUseHiGHS(true), true);
  assert.equal(normalizeUseHiGHS(false), false);
  assert.equal(normalizeUseHiGHS('True'), true);
  assert.equal(normalizeUseHiGHS('False'), false);
  assert.equal(normalizeUseHiGHS('Auto'), 'auto');

  const fakeKernel = (caseCount, solutionCount, entryCount) => {
    const cases = Array.from({ length: caseCount }, () => []);
    for (let i = 0; i < entryCount; i += 1) cases[i % caseCount]?.push(i % solutionCount);
    return {
      cases,
      solutionIds: Array.from({ length: solutionCount }, (_, i) => i),
      forced: [],
    };
  };
  const dummy = { cases: [], keys: [], entryCount: 0 };

  // Primary-only measurements: these representative kernels finish quickly in Rust.
  assert.equal(isHardPrimaryKernel(fakeKernel(10, 8, 20)), false);      // pcinfo-019 full
  assert.equal(isHardPrimaryKernel(fakeKernel(232, 94, 2428)), false);  // pcinfo-022 full
  assert.equal(isHardPrimaryKernel(fakeKernel(456, 95, 5028)), false);  // pcinfo-024-like

  // BOX-derived primary kernels exceeded the Rust cardinality-only timeout.
  assert.equal(isHardPrimaryKernel(fakeKernel(239, 113, 2435)), true);
  assert.equal(isHardPrimaryKernel(fakeKernel(712, 141, 7483)), true);
  assert.equal(isHardPrimaryKernel(fakeKernel(749, 110, 10056)), true);

  const fullySolved = fakeKernel(0, 0, 0);
  assert.equal(resolveUseHiGHS(dummy, 'Auto', fullySolved), false);
  assert.equal(resolveUseHiGHS(dummy, 'Auto', fakeKernel(10, 8, 20)), false);
  assert.equal(resolveUseHiGHS(dummy, 'Auto', fakeKernel(239, 113, 2435)), true);
  assert.deepEqual(primaryKernelStats(fakeKernel(2, 3, 5)), { cases: 2, solutions: 3, entries: 5, forced: 0 });
});

test('forced Rust keeps primary independent while True/Fast choose secondary strategy', async () => {
  const solver = await createWasmSolver(4);
  try {
    const coverage = new Map([
      ['A', new Set(['X', 'Y'])],
      ['B', new Set(['X', 'Z'])],
      ['C', new Set(['Y', 'Z'])],
    ]);
    const q = new Map([
      ['A|X',100],['A|Y',30],
      ['B|X',20],['B|Z',90],
      ['C|Y',80],['C|Z',10],
    ]);
    const qualityFor = (key, caseId) => q.get(`${caseId}|${key}`) ?? 0;

    const fast = await minimumCoverAsync(coverage, {
      qualityFor, solver, useHiGHS: false, exactQuality: 'Fast', fastStateBudget: 1000,
    });
    assert.equal(fast.count, 2);
    assert.equal(fast.cardinalityBackend, 'rust');
    assert.equal(fast.qualityBackend, 'fast-integrated-exact');
    assert.equal(fast.qualityExact, true);
    assert.equal(fast.fastFallback, false);

    const fallback = await minimumCoverAsync(coverage, {
      qualityFor, solver, useHiGHS: false, exactQuality: 'Fast', fastStateBudget: 1,
    });
    assert.equal(fallback.count, 2);
    assert.equal(fallback.cardinalityBackend, 'rust');
    assert.equal(fallback.qualityBackend, 'fast-2x2');
    assert.equal(fallback.qualityExact, false);
    assert.equal(fallback.fastFallback, true);

    const exact = await minimumCoverAsync(coverage, { qualityFor, solver, useHiGHS: false, exactQuality: true });
    const legacy = solver.minimumCover(coverage, { qualityFor });
    assert.equal(exact.cardinalityBackend, 'rust');
    assert.equal(exact.qualityBackend, 'rust-quality-integrated');
    assert.equal(exact.qualityExact, true);
    assert.equal(exact.fastFallback, false);
    assert.deepEqual(exact.keys, legacy.keys);
    assert.deepEqual(exact.qualityVector, legacy.qualityVector);
  } finally { solver.close(); }
});

test('exactHumanQuality accepts True/Fast and false aliases Fast', () => {
  assert.equal(normalizeExactHumanQuality(true), 'true');
  assert.equal(normalizeExactHumanQuality('True'), 'true');
  assert.equal(normalizeExactHumanQuality('Fast'), 'fast');
  assert.equal(normalizeExactHumanQuality(false), 'fast');
});

test('forced HiGHS separates primary backend from exact quality backend', async () => {
  const solver = await createWasmSolver(4);
  try {
    const coverage = new Map([
      ['A', new Set(['X', 'Y'])],
      ['B', new Set(['X', 'Z'])],
      ['C', new Set(['Y', 'Z'])],
    ]);
    const q = new Map([
      ['A|X',100],['A|Y',30],
      ['B|X',20],['B|Z',90],
      ['C|Y',80],['C|Z',10],
    ]);
    const qualityFor = (key, caseId) => q.get(`${caseId}|${key}`) ?? 0;
    const fast = await minimumCoverAsync(coverage, { qualityFor, solver, useHiGHS: true, exactQuality: 'Fast', fastStateBudget: 1 });
    assert.equal(fast.cardinalityBackend, 'highs');
    assert.equal(fast.useHiGHSResolved, true);
    assert.equal(fast.qualityBackend, 'fast-2x2');
    assert.equal(fast.qualityExact, false);
    const exact = await minimumCoverAsync(coverage, { qualityFor, solver, useHiGHS: true, exactQuality: true });
    assert.equal(exact.cardinalityBackend, 'highs');
    assert.equal(exact.useHiGHSResolved, true);
    assert.equal(exact.qualityBackend, 'rust-quality-integrated');
    assert.equal(exact.qualityExact, true);
    assert.equal(exact.count, 2);
    assert.equal(exact.qualityVector.length, 3);
  } finally { solver.close(); }
});


test('forced HiGHS does not load/claim HiGHS when exact kernelization already proves K', async () => {
  const solver = await createWasmSolver(4);
  try {
    const coverage = new Map([
      ['A', new Set(['X','Y'])],
      ['B', new Set(['Z','W'])],
    ]);
    const result = await minimumCoverAsync(coverage, { solver, useHiGHS: true, exactQuality: 'Fast' });
    assert.equal(result.count, 2);
    assert.equal(result.cardinalityBackend, 'kernel');
    assert.equal(result.backend, 'kernel+rust');
    assert.equal(result.useHiGHSRequested, true);
    assert.equal(result.useHiGHSResolved, false);
  } finally { solver.close(); }
});

test('Auto takes kernel-only exact path before loading HiGHS when reductions fully solve K', async () => {
  const solver = await createWasmSolver(4);
  try {
    const coverage = new Map([
      ['A', new Set(['X','Y'])],
      ['B', new Set(['Z','W'])],
    ]);
    const result = await minimumCoverAsync(coverage, { solver, useHiGHS: 'Auto', exactQuality: 'Fast' });
    assert.equal(result.count, 2);
    assert.equal(result.cardinalityBackend, 'kernel');
    assert.equal(result.backend, 'kernel+rust');
    assert.equal(result.useHiGHSRequested, 'auto');
    assert.equal(result.useHiGHSResolved, false);
  } finally { solver.close(); }
});
