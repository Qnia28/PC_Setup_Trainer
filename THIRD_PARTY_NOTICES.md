# Third-party notices

This document separates open-source software license notices from acknowledgements
for setup data, research documents, external tools, services, and compatibility
formats. Acknowledging a reference source does not imply that its contents are
openly licensed or that QniaPC received rights beyond those granted by the
source's stated terms.

## Open-source software and development tools

### sfinder-wasm

- Project: [sfinder_wasm](https://github.com/Qnia28/sfinder_wasm)
- Author: Qnia ([@Qnia28](https://github.com/Qnia28))
- Use in QniaPC: browser-native Rust/WASM Perfect Clear solver under
  `vendor/sfinder-wasm/upstream`; the current 2L–6L-compatible snapshot was
  imported from the author's `sfinder-wasm-6Lfix2` workspace on 2026-08-24.
- Upstream public license: GPL-3.0-only.
- Upstream license text: [GNU GPL version 3](https://github.com/Qnia28/sfinder_wasm/blob/main/LICENSE).
- QniaPC license grant: the copyright holder has separately authorized their
  original sfinder-wasm contributions and shipped binaries for inclusion and
  distribution in this project under the MIT License. That project-specific
  grant is independent of the upstream repository's GPL-3.0-only release.
- Third-party material listed by sfinder-wasm remains under its respective
  license; the bundled runtime uses no non-permissive third-party source.
- The full upstream public license and acknowledgements document are retained as
  `vendor/sfinder-wasm/upstream/LICENSE` and
  `vendor/sfinder-wasm/upstream/THIRD_PARTY_NOTICES.md`.

### React runtime packages

- Projects: [React](https://github.com/facebook/react), React DOM, and Scheduler
- Use in QniaPC: browser user interface and rendering runtime.
- Versions: React 18.3.1, React DOM 18.3.1, Scheduler 0.23.2.
- License: MIT License
- Copyright notice: Copyright (c) Facebook, Inc. and its affiliates.

### loose-envify and js-tokens

- Projects: [loose-envify](https://github.com/zertosh/loose-envify) and
  [js-tokens](https://github.com/lydell/js-tokens)
- Use in QniaPC: transitive production dependencies of the React packages.
- License: MIT License
- Copyright notices: Copyright (c) 2015 Andres Suarez; Copyright (c) 2014–2018
  Simon Lydell.

### LZ-String

- Project: [LZ-String](https://github.com/pieroxy/lz-string)
- Author: Pieroxy
- Use in QniaPC: `src/replay/jstrisLocal/lzString.ts` is a TypeScript
  adaptation of the URI-safe LZ-String decompression algorithm.
- License: MIT License
- Copyright notice: Copyright (c) 2013 pieroxy

### tetris-fumen

- Project: [tetris-fumen](https://github.com/knewjade/tetris-fumen)
- Author and maintainer: knewjade
- Use in QniaPC: runtime Fumen encoding and decoding dependency.
- License: MIT License
- Upstream copyright notice: Copyright (c) 2019

### gifenc

- Project: [gifenc](https://github.com/mattdesl/gifenc)
- Author: Matt DesLauriers
- Use in QniaPC: browser-side animated GIF encoding for Replay Viewer exports.
- Version: 1.0.3.
- License: MIT License
- Upstream copyright notice: Copyright (c) 2017 Matt DesLauriers

### solution-finder (SFinder)

- Project: [solution-finder](https://github.com/knewjade/solution-finder)
- Author and maintainer: knewjade
- Use in QniaPC: offline setup analysis and verification tool, and the main
  behavioral compatibility reference for the independently implemented
  sfinder-wasm browser runtime.
- License: MIT License
- Copyright notice: Copyright (c) 2020 knewjade
- The upstream project also identifies Apache Commons CLI as software distributed
  under the Apache License 2.0. See the upstream repository for that dependency's
  notices.

## sfinder-wasm upstream acknowledgements

The following acknowledgements are from the sfinder-wasm project.
Unless listed above as a bundled dependency, these projects are behavioral,
historical, or architectural references and their source is not distributed as
part of QniaPC.

### sfinder-strict-minimal

- Project: [sfinder-strict-minimal](https://github.com/eight04/sfinder-strict-minimal)
- Author: eight04
- Upstream license: MIT License
- Relationship: earlier sfinder-wasm versions used the project as a direct
  reference for graph reduction and minimal-set behavior. That adaptation was
  removed; the current minimum-cover implementations are independent.

### PC-Saves-Get

- Project: [PC-Saves-Get](https://github.com/Marfung37/PC-Saves-Get)
- Author: Marfung37
- Relationship: save-analysis semantics and save-expression behavior informed
  sfinder-wasm. Its Python source is not included.
- License: not declared by the upstream repository.

### sfinder-man

- Project: [sfinder-man](https://github.com/cringemoment/sfinder-man)
- Repository owner: cringemoment
- Relationship: earlier command workflows and wrapper behavior informed
  sfinder-wasm. Its Python source is not included.
- License: not declared by the upstream repository.

### tetra-tools solver design reference

- Project: [tetra-tools](https://github.com/wirelyre/tetra-tools)
- Author: wirelyre
- Relationship: high-performance four-line PC solver techniques, including
  vectorized placement search and legal-board pruning, informed sfinder-wasm.
  sfinder-wasm uses its own data structures, search code, WASM interface, and
  legal-board generator; tetra-tools code is neither bundled nor linked.
- Upstream license: GPL-3.0-or-later.

### MIT License text

The following license text applies to the React runtime packages, loose-envify,
js-tokens, LZ-String, tetris-fumen, gifenc, and solution-finder, together with each project's
copyright notice above.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Setup data and research references

The sources in this section were consulted when researching, transcribing,
normalizing, or validating setup geometry, queue conditions, continuations,
probabilities, terminology, and related metadata. These entries are references
and acknowledgements, not open-content license grants.

### PC INFO KOREA / Perfect Clear Info Korea

- Website: [Perfect Clear Info Korea](https://www.perfectclearinfokorea.com/)
- Organization: Korean Perfect Clear Association (KPCA)
- Site editing team: Bibii (까망고양이 비비), Holifyre
  (홀리파이어), Paback (파백), SingSing7538 (양플), ozsitjl (z), and algebruh.
- Use in QniaPC: primary reference for multiple cycle-based Perfect Clear setup
  catalogs, advanced setups, QB/OQB conditions, and associated explanations.

### NitenTeria and mww setup document

- Document: [Perfect Clear setup sheet](https://docs.qq.com/sheet/DRmxvWmt3SWxwS2tV)
- Authors: NitenTeria and mww
- Use in QniaPC: reference database for Perfect Clear setup research and
  cross-checking.

### Algebruh's 7th

- Document: `Algebruh's 7th`
- Author: algebruh
- Use in QniaPC: source and research reference for seventh-cycle Perfect Clear
  setups, including advanced seventh-cycle material.
- Public document URL: unavailable.
- License: not specified.

## External tools, services, and compatibility formats

The projects and services in this section are referenced or used externally.
Their code is not bundled into QniaPC unless stated elsewhere in this document.

### ezSFinder

- Project: [ezSFinder](https://github.com/cringemoment/ezsfinder)
- Repository owner and publisher: cringemoment
- Upstream README credits: torch, swng, marfung, eight08, and knewjade for the
  underlying code collected or used by the project.
- Use in QniaPC: external/offline SFinder helper scripts and setup-analysis
  workflow reference.
- License: not declared by the upstream repository.

### PC Solver / tetra-tools

- Service: [PC Solver](https://wirelyre.github.io/tetra-tools/pc-solver.html)
- Source project: [tetra-tools](https://github.com/wirelyre/tetra-tools)
- Author: wirelyre
- Use in QniaPC: externally linked Perfect Clear solver; its source is not
  bundled into QniaPC.
- Upstream license: GNU General Public License, version 3 or, at the user's option,
  any later version (GPL-3.0-or-later).
- Upstream copyright notice: Copyright 2021, `wirelyre`.

### Jstris

- Service: [Jstris](https://jstris.jezevec10.com/)
- Developer: Jezevec10
- Use in QniaPC: external replay source and compatibility format. The local
  importer implements the explicitly tested Jstris V3 PC Mode replay subset.
  Unsupported future versions fail closed.
- License: not declared for the Jstris service or replay format.
- No Jstris application code is bundled into QniaPC.
