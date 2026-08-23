# sfinder-wasm

A browser-native Rust/WASM engine for Tetris Perfect Clear analysis, with
compatibility for selected `knewjade/solution-finder` behavior. It is designed
to run in the browser or directly from JavaScript.

**Author:** Qnia ([@Qnia28](https://github.com/Qnia28))

The project is self-contained apart from the `tetris-fumen` JavaScript
dependency. It does not require `sfinder.jar` or the earlier Python wrappers at
runtime.

## Features

PC Worker:

- `chance` — PC success rate and failed queues
- `saves` — save-condition success rate
- `minimals` — exact minimum-cover solution set for a save condition
- `fourth` — fourth-PC save distribution
- `fifth` — fifth-PC per-piece minimal analysis
- `per-save-minimals` — save-grouped solutions; one concrete queue uses a ranked Top-K fast path, matrices use exact minimum cover

Batch Worker:

- `cover`
- `coverpercent`
- `congruent`
- `congruentcover`

The first-order PC features support 2- through 6-line targets. The established
2-4 line path keeps the legal-board/oracle-accelerated solver; 5-6 lines use a
generic compatibility pipeline. `fourth` and `fifth` remain 4-line-only compound
analyses.

## Runtime layout

```text
src/
├─ pc.worker.mjs
├─ batch.worker.mjs
├─ worker-client.mjs
├─ worker-runtime.mjs
├─ batch-worker-runtime.mjs
└─ feature modules

wasm/
├─ pc_wasm.wasm
├─ batch_wasm.wasm
└─ legal_boards_4.lgb

rust/
├─ pc-core
├─ pc-wasm
├─ batch-wasm
└─ legal-gen
```

The PC and batch engines use separate Workers so cover/setup workloads do not
share mutable search state with the real-time PC solver.

## Runtime optimizations

The shipped 4-line legal-board asset uses the `LGB2` format. Stage 7 uses a
16-bit prefix index with packed 24-bit suffixes, while the much smaller late
stages keep compact packed lookup tables. `LGB2` also carries a stage-8
two-piece viability oracle and exact stage-9 finishing placements; the loader
remains compatible with legacy `LGB1` packs.

Save expressions are compiled once to a 128-entry truth table over the seven
piece save mask. On 5-6 line broad patterns, chance and full path enumeration
share a piece-multiset placement DAG across concrete queues and project the
reachable piece orders through a prefix-sharing queue/Hold trie. Small queue
sets stay on the scalar path to avoid batch setup overhead. `WasmPcSolver`
also exposes `enumeratePcMany()` for callers that need the full per-queue path
matrix rather than only chance/minimal summaries.

The 5-6 line cover fallback likewise uses a structural operation DAG and a
prefix-sharing queue/Hold projector. Coverpercent reuses the pattern-level PC
existence path for broad solve patterns. These are internal optimizations and
do not change the public Worker request format.

## Installation

```bash
npm install
```

The shipped WASM files can be used directly. Rust is needed only when rebuilding
WASM or regenerating the 4-line legal-board pack.

## Build and test

```bash
npm run build:wasm
npm run test:rust
npm test
npm run test:batch
```

Regenerate the legal-board asset with:

```bash
npm run generate:legal
```

The Rust workspace itself has no external crate dependency.

## Browser Worker usage

PC Worker:

```js
import {
  SolverWorkerClient,
  viteWorkerFactory,
} from './src/worker-client.mjs';

const client = new SolverWorkerClient(viteWorkerFactory);

const result = await client.request('chance', {
  sourceFumen: 'v115@...',
  pattern: '*p7',
  clear: 4,
  useHold: true,
});
```

Batch Worker:

```js
import {createBatchWorkerClient} from './src/batch-worker-client.mjs';

const batch = createBatchWorkerClient();

const result = await batch.request('cover', {
  sourceFumen: 'v115@...',
  pattern: '*p7',
  clear: 4,
  mode: 'normal',
  mirror: 'no',
  useHold: true,
});
```

Individual requests can be cancelled with an `AbortSignal`:

```js
const controller = new AbortController();
const pending = client.request('chance', input, {signal: controller.signal});
controller.abort();
```

`cancel()` cancels all work owned by that client. `dispose()` terminates the
client permanently.

## Direct runtime usage

PC functions can be invoked without constructing a Worker:

```js
import {runWorkerRequest} from './src/worker-runtime.mjs';

const result = await runWorkerRequest({
  kind: 'chance',
  input: {
    sourceFumen: 'v115@...',
    pattern: '*p7',
    clear: 4,
  },
});
```

Batch requests use `runBatchWorkerRequest()` from
`src/batch-worker-runtime.mjs`.

## Pattern syntax

Supported SFinder-style forms include:

```text
TOILJSZ
*p7
[JSZO]!
[LJISZ]p4
[^TIL]!
I[JS]![TO]!,*p2
TI,[JOS]!,*p2;TO,[IJS]!,*p2
```

Comma-separated and concatenated forms are accepted. Semicolon-separated
branches are distinct analysis cases; if two branches expand to the same
concrete queue, both cases are retained.

Malformed patterns such as `*BAD`, `[TT]!`, or `[TI]p3` raise
`PatternSyntaxError` instead of being silently reinterpreted.

## Per-save minimals

`per-save-minimals` analyzes the Fumen exactly as supplied. `targetLines` is the
number of rows that must be filled in the current state, not a historical setup
piece count.

For one concrete queue, the rebuilt WASM core uses a structural-state DAG and
keeps at most `candidateLimit` candidate geometries per save piece (default 16).
Candidates are ranked first by the number of distinct playable piece-placement
orders under that concrete queue + Hold, then by a deterministic stable geometry
key. This path does not run the matrix minimum-cover solver.

For pattern matrices, all distinct solution coverage remains exact. The primary
minimum-cover search runs in Rust/WASM with bitsets, MRV branching and bounds;
`src/min-cover.mjs` remains as an independent JavaScript fallback for mocks and
older WASM binaries. Equal-size minimum covers are ranked by their per-case
playable-order counts, improving the worst-covered case first.

```text
remainingCells = targetLines * 10 - occupiedCells
piecesNeeded = remainingCells / 4
expectedQueueLength = piecesNeeded + 1
```

`targetLines` must be from 2 through 6. The geometry must leave a positive multiple of
four cells, and every expanded queue must contain exactly one more piece than
the PC itself needs. See `docs/PER_SAVE_MINIMALS.md`.

## Batch semantics

Cover uses exact locked placement reachability with Jstris 180 physics. For
2-4 lines its operation-order search, mode checks, and queue/Hold coverage run
inside `batch_wasm.wasm`. For 5-6 line compatibility targets, the generic JS
layer builds a shared structural operation DAG while exact lock tests remain in
WASM, then projects orders over a shared queue/Hold trie. Setup/congruent uses
TETRIO 180 physics with MRV cell selection for geometric tiling search. See
`docs/BATCH_ENGINE.md` for the current batch-engine contract and cover modes.

## Fifth union semantics

`fifth` supports semicolon-union patterns. Branches remain distinct analysis
cases even when they expand to the same concrete queue. Save analysis uses each
branch's own final-bag metadata, and the `See X` denominator is the actual number
of branch cases whose final bag draw contains `X`; it is not estimated from a
global `2/7` formula. PC enumeration is still cached by concrete queue string.

## License

**sfinder-wasm** is distributed under the **GNU General Public License, version 3
only (`GPL-3.0-only`)**. See `LICENSE` for the full GPLv3 text.

Copyright (C) 2026 Qnia (@Qnia28).

This repository does not grant a project-specific linking or combination
exception. A recipient who receives this GPL-licensed copy receives it under the
GPLv3 terms. The copyright holder may separately license their original
contributions under different terms by a separate agreement; such a separate
license is not granted by this repository.

Third-party components and notices retain their own licenses and are documented
in `THIRD_PARTY_NOTICES.md`. In particular, the MIT-licensed notices carried for
`solution-finder` and `tetris-fumen` remain in `third_party/`. The current
minimum-cover implementation is independent: production uses
`rust/pc-core/src/min_cover.rs`, with `src/min-cover.mjs` retained as a
deterministic JavaScript fallback.
