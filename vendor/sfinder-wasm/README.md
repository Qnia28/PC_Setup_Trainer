# sfinder-wasm vendor boundary

This directory isolates [`Qnia28/sfinder_wasm`](https://github.com/Qnia28/sfinder_wasm)
from QniaPC's application code so frequent solver updates remain bounded.

- `upstream/` is the curated Release 3.0 runtime/source snapshot imported from
  `D:\AI\sfinder-wasm\release3.0-20260906` on 2026-09-06, including its shared
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

Release 3.0 project-owned code is Apache-2.0. LICENSE, NOTICE, third-party
licenses and the supplied Eigen sources are retained. Primary Auto uses Rust
or ORTools, with HiGHS for unsupported ORTools environments. Runtime errors
remain errors. ORTools uses a disposable nested Worker with two CP-SAT workers;
browser JSPI and COOP/COEP are required for that backend, but not the fallback.

Do not add QniaPC-specific behavior inside `upstream/`. This separation allows a
future upstream refresh to be reviewed as a bounded vendor diff.
