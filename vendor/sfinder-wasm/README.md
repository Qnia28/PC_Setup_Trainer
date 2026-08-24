# sfinder-wasm vendor boundary

This directory isolates [`Qnia28/sfinder_wasm`](https://github.com/Qnia28/sfinder_wasm)
from QniaPC's application code so frequent solver updates remain bounded.

- `upstream/` is the complete 2L–6L-compatible snapshot imported from
  `D:\AI\sfinder-wasm_260824` on 2026-08-24, including its shared single-queue,
  broad-pattern, and cover engines.
- Upstream source, tests, documentation, license, acknowledgements, WASM modules,
  and the four-line legal-board pack stay together under `upstream/`.
- QniaPC's thin public-API adapters, persistent Worker lifecycle, 128 MiB recycle
  policy, and application request protocol live under `src/solver/`.
- Refresh this dependency by replacing `upstream/` as one unit, then reviewing
  the narrow `src/solver/` compatibility boundary.

Qnia, the copyright holder of the original sfinder-wasm contributions, has
separately authorized those contributions and the shipped binaries for use and
distribution inside QniaPC under the MIT License. This project-specific grant
does not change the public upstream repository's GPL-3.0-only license or any
third-party license identified in the retained notices.

Do not add QniaPC-specific behavior inside `upstream/`. This separation allows a
future upstream refresh to be reviewed as a bounded vendor diff.
