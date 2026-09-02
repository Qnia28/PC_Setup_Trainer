# sfinder-wasm vendor boundary

This directory isolates [`Qnia28/sfinder_wasm`](https://github.com/Qnia28/sfinder_wasm)
from QniaPC's application code so frequent solver updates remain bounded.

- `upstream/` is the curated Release 2.6 runtime/source snapshot imported from
  `D:\AI\sfinder-wasm_20260901-release2.6` on 2026-09-02, including its shared
  single-queue, broad-pattern, adaptive minimum-cover, and cover engines.
- QniaPC integration instructions, release notes, changelogs, validation reports,
  README files, and end-user guide drafts from the source workspace are not part
  of the vendored snapshot.
- Upstream source, tests, license, third-party notices and license texts, WASM
  modules, provenance source archive, and the four-line legal-board pack stay
  together under `upstream/`.
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
