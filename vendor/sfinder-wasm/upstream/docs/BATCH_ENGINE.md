# Batch engine

The batch engine handles operation-order-sensitive analysis separately from the
PC existence solver.

## Why it is separate

The PC engine can merge equivalent board states aggressively because it only
needs PC existence and solution enumeration. Cover analysis cannot merge states
only by board: two placement histories that reach the same board may have
different operation orders and therefore different queue/hold coverage.

For that reason batch analysis uses `batch_wasm.wasm` and keeps order-aware
state where required.

## Current cover search architecture

For 2-4 line targets, cover traversal runs as one Rust/WASM search instead of
a JavaScript recursive DFS that calls WASM once per placement. A target's
operations and analysis queues are staged once; Rust performs exact locked
reachability, line-clear/mode tracking, and queue/Hold coverage internally.
JavaScript only reconstructs the public variants/orders and case results.

For 5-6 line compatibility targets the fixed four-row batch engine is not used.
The generic fallback keeps exact lock/T-spin tests in WASM but builds a structural
DAG keyed by `(board, clearedRows, remainingOperationMask)`. Histories that reach
the same future state therefore share all later placement checks. Public traces
are reconstructed from DAG edges afterwards. Queue/Hold coverage is projected
with one prefix trie shared by all concrete pattern cases and cached placement
orders, rather than testing every `(queue, order)` pair independently.

The exact reverse-reachability graph uses compact integer state IDs, a fixed
visited bitset, a fixed stack, and precomputed SRS-origin cells/bounds rather
than a hash set of `(rotation, x, y)` states. T-spin classification is evaluated
during search only for spin-sensitive modes; other modes annotate only final
successful variants so the public trace remains compatible without paying the
spin cost on failed branches.

Within this solver, HOLD/ACTIVE/NEXT may be supplied as one linear visible queue.
For example, HOLD `T`, ACTIVE `L`, NEXT `IOZTJ` is analyzed as `TLIOZTJ`; the
queue/Hold automaton determines which placement orders are realizable. Duplicate
semicolon cases remain distinct by case ID even when their queue strings match.

## Reachability

Cover checks exact locked placements in the SRS rotation-origin coordinate
system. A target operation is accepted only when a matching state is legal,
grounded, and reachable with the selected movement rules.

- Cover uses Jstris 180 physics.
- Setup/congruent uses TETRIO 180 physics.

## Cover modes

Supported modes:

```text
normal
b2b
any / tsm
tss
tsd
tst
tetris
tetris-end
1l / 2l / 3l / 4l
1l-or-pc / 2l-or-pc / 3l-or-pc / 4l-or-pc
```

Cover also supports hold, `mirror=yes/no`, multi-page Fumen targets, and
semicolon-union queue patterns.

Different semicolon branches remain distinct analysis cases even when they
expand to the same concrete queue. Internally this identity is preserved with a
case ID; external failed-queue output remains queue strings.

## T-spin classification

T-spin classification validates the three-corner rule, a reachable predecessor
rotation, kick selection, and Mini/Regular conditions before accepting a target
for the requested spin mode.

## Fumen handling

For cover, a page operation is overlaid onto that page's field before target
operations are decomposed.

For congruent, colored cells are treated as fill cells. Gray/X cells remain base
garbage unless `blueGarbage` is enabled.
