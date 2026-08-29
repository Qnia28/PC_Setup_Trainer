# Third-Party Notices and Acknowledgements

This file distinguishes software whose license notices are carried with this
repository from projects that were used only as behavioral, historical, or
architectural references.

## Project license

`sfinder-wasm` is authored by **Qnia (@Qnia28)** and is distributed under
the GNU General Public License, version 3 only (`GPL-3.0-only`). The full
project license is provided in `LICENSE`.

Third-party material identified below remains under its respective upstream
license. Inclusion of permissively licensed material does not change the GPLv3
license applied to Qnia's original sfinder-wasm code.

## Licensed software and adapted code

### knewjade/solution-finder

This project reimplements selected Perfect Clear analysis behavior and pattern
semantics compatible with `knewjade/solution-finder` and used solution-finder
as a compatibility reference during development.

- Project: https://github.com/knewjade/solution-finder
- Copyright (c) 2020 knewjade
- License: MIT
- License text: `third_party/solution-finder.LICENSE`

The Rust/WASM solver in this repository is not a vendored copy of the Java
solution-finder source. The upstream notice is retained because solution-finder
is the principal behavioral and compatibility reference for the project.

### knewjade/tetris-fumen

This project depends on `tetris-fumen` for Fumen encoding and decoding.

- Project: https://github.com/knewjade/tetris-fumen
- Copyright (c) 2019
- License: MIT
- License text: `third_party/tetris-fumen.LICENSE`


### highs-js / HiGHS

Hard global `minimals` requests can lazy-load the browser build of HiGHS through
`highs-js` to prove the primary minimum-cardinality set-cover objective. The
shipped runtime assets are `src/vendor/highs.mjs` and `wasm/highs.wasm`. Smaller
minimum-cover problems continue to use the native Rust/WASM solver.

- highs-js project: https://github.com/lovasoa/highs-js
- highs-js version: 1.15.1
- highs-js license: MIT
- highs-js license text: `third_party/highs-js.LICENSE`
- HiGHS project: https://github.com/ERGO-Code/HiGHS
- HiGHS version: 1.15.1
- HiGHS license: MIT
- HiGHS license text: `third_party/HiGHS.LICENSE`

The hard-matrix integration uses HiGHS only for the exact primary cardinality
proof. Human-quality selection is performed by sfinder-wasm code after the
cardinality optimum is known. The release also carries the upstream HiGHS
1.15.1 source archive at `third_party/source/HiGHS-1.15.1.zip` for provenance
and source-availability convenience.

## Acknowledgements and references

### eight04/sfinder-strict-minimal

Earlier development versions used `eight04/sfinder-strict-minimal` as a direct
reference for graph reduction/minimal-set behavior. The current release no
longer contains that adaptation: `src/minimal.mjs` was removed. Small and
medium minimum-cover problems are implemented independently in
`rust/pc-core/src/min_cover.rs` using bitsets, MRV branching, bounds, and
deterministic human-quality tie-breaking. `src/min-cover.mjs` is an independent
JavaScript fallback. Hard global `minimals` may use the separately licensed
HiGHS backend for the exact primary-cardinality proof.

- Project: https://github.com/eight04/sfinder-strict-minimal
- Upstream license: MIT

The projects below are not vendored, linked, or distributed as source
components of this repository. Their license texts are therefore not presented
as licenses governing this project.

### Marfung37/PC-Saves-Get

The save-analysis semantics and save-expression behavior were informed by
`Marfung37/PC-Saves-Get` (`sfinder-saves.py` and related modules). The current
JavaScript implementation is independently structured and this repository does
not include PC-Saves-Get Python source.

- Project: https://github.com/Marfung37/PC-Saves-Get
- No explicit software license was present in the repository when reviewed.

### cringemoment/sfinder-man

Earlier command workflows and wrapper behavior were informed in part by
`cringemoment/sfinder-man`, a Discord-bot project built around solution-finder.
No sfinder-man Python source is included in this repository.

- Project: https://github.com/cringemoment/sfinder-man
- No explicit software license was present in the repository when reviewed.

### wirelyre/tetra-tools

The high-performance 4-line PC solver design was informed in part by techniques
demonstrated in `wirelyre/tetra-tools`, particularly vectorized placement
search and legal-board pruning. The implementation in this repository uses its
own data structures, search code, WASM interface, and legal-board generator.
No tetra-tools source code or crate is included or linked.

- Project: https://github.com/wirelyre/tetra-tools
- Upstream license: GPL-3.0-or-later

The GPL license of tetra-tools is listed here only to identify the upstream
reference accurately; tetra-tools is not a distributed dependency of this
repository.
