# Per-save minimals (2-6 line targets)

This feature is bag-independent. It analyzes the board exactly as supplied by the
input Fumen; it does not infer how many pieces were used before the current
state and does not automatically clear completed rows before deciding the
target height.

The caller supplies `targetLines` (`2` through `6`). `clear` remains a backwards-
compatible alias. If both are supplied they must be equal.

For the current input board:

```text
remainingCells = targetLines * 10 - occupiedCells
piecesNeeded = remainingCells / 4
expectedQueueLength = piecesNeeded + 1
```

A request is valid only when:

- the board fits within `targetLines`,
- `remainingCells > 0`,
- `remainingCells % 4 === 0`, and
- every expanded queue has exactly `expectedQueueLength` pieces.

This makes the save definition invariant: every PC solution uses exactly
`piecesNeeded` queue pieces and leaves exactly one unused/save piece.

Examples:

| Current board | targetLines | occupied | needed | input |
|---|---:|---:|---:|---:|
| empty 2L | 2 | 0 | 5 | see6 |
| 2 occupied cells in 3L | 3 | 2 | 7 | see8 |
| post-clear 4P example | 3 | 6 | 6 | see7 |
| same setup before its completed row clears | 4 | 16 | 6 | see7 |

The output solution pages use the same target height, so a `targetLines=3`
request produces solution fields confined to the bottom three rows.

The execution policy depends on the number of concrete cases.

For exactly one concrete queue (the qniapc Solve use case):

1. Build the structural PC DAG once. DAG state contains board/queue/Hold search
   state rather than accumulated seven-piece solution masks.
2. For each possible saved piece, collect at most `candidateLimit` distinct
   solution geometries (default `16`).
3. For those candidates only, count distinct playable piece-type placement
   orders that are actually reachable under the concrete queue + Hold.
4. Return the candidate with the largest order count; an internal stable
   geometry key breaks exact ties. No matrix minimum-cover calculation runs.

For multiple concrete cases (bag/pattern matrices):

- On the established 2-4 line fast path, enumerate each concrete case with the
  existing legal-board/oracle-accelerated solver.
- On 5-6 line compatibility targets, small case sets stay on concrete-queue
  enumeration to avoid batch setup overhead. Broad matrices use pattern-level
  enumeration instead: derive the few relevant piece multisets from the concrete
  queues, build one shared dynamic placement DAG per multiset state, then project
  each reachable solution/order onto all queues with the exact Hold trie. This
  preserves line-clear-dependent geometries that cannot be represented as a
  static tetromino tiling while avoiding one full geometry search per queue.

Then:

1. Compute the unused piece as `queue multiset - solution used-piece multiset`.
2. Build a bitset coverage matrix per save piece.
3. Run the independent exact minimum-cover solver in Rust/WASM
   (`rust/pc-core/src/min_cover.rs`). `src/min-cover.mjs` provides the same
   deterministic objective as a fallback when the WASM export is unavailable.
4. Minimum cardinality is always the primary objective. Among equal-cardinality
   covers, maximize the sorted per-case playable-order quality vector
   lexicographically (worst case first), then use a stable key as the final tie.

The star is conditional on PC success:

```text
P      = set of queues with any PC solution
S[p]   = set of queues with a PC solution that saves p
rate   = |S[p]| / |P|
star   = |P| > 0 and |S[p]| == |P|
```

Thus a 99% PC setup can have a 100% T-save rate when every PC-success queue can
save T.

## PC 0% contract

PC 0% is a valid empty analysis, not an error:

- `pcSuccess = 0`
- `pcRate = 0` for a non-empty input queue set
- every piece has `success = 0`
- every `saveRate = null`
- every `guaranteed = false`
- every `minimalCount = 0`
- comments use `Save X (N/A)`, never a star
- Fumen output has only the intro page

## Output order

Within each Save group, selected minimal solutions are emitted in descending coverage order.
Solutions with the same coverage count are ordered by solution key ascending for deterministic output.
This ordering is presentation-only: it does not alter exact minimum-cover selection or coverage.
