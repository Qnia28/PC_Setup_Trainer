export interface ThirdPartyLicence {
  name: string;
  sourceUrl: string;
  licence: string;
  copyright: string;
}

export interface Acknowledgement {
  name: string;
  sourceUrl?: string;
  credit: string;
  summary: string;
}

export const THIRD_PARTY_LICENCES: readonly ThirdPartyLicence[] = [
  {
    name: "sfinder-wasm",
    sourceUrl: "https://github.com/Qnia28/sfinder_wasm",
    licence: "Apache License 2.0",
    copyright: "Qnia (@Qnia28)",
  },
  {
    name: "OR-Tools",
    sourceUrl: "https://github.com/google/or-tools",
    licence: "Apache License 2.0",
    copyright: "Google LLC",
  },
  {
    name: "or-tools-wasm",
    sourceUrl: "https://github.com/Axelwickm/or-tools-wasm",
    licence: "Apache License 2.0",
    copyright: "or-tools-wasm contributors",
  },
  {
    name: "Eigen",
    sourceUrl: "https://gitlab.com/libeigen/eigen",
    licence: "MPL-2.0 and permissive portions; supplied source retains original notices",
    copyright: "Eigen contributors",
  },
  {
    name: "Abseil and long",
    sourceUrl: "/licences/sfinder.txt",
    licence: "Apache License 2.0; additional embedded notices retained",
    copyright: "Abseil and long contributors; see bundled notices",
  },
  {
    name: "protobuf, protobufjs, RE2 and protobuf-es",
    sourceUrl: "/licences/sfinder.txt",
    licence: "BSD-3-Clause; protobuf-es also includes Apache-2.0 portions",
    copyright: "Google LLC and respective contributors; see bundled notices",
  },
  {
    name: "utf8_range, zlib and bzip2",
    sourceUrl: "/licences/sfinder.txt",
    licence: "MIT, Zlib and bzip2-1.0.6 respectively",
    copyright: "Respective copyright holders; see bundled notices",
  },
  {
    name: "Emscripten and C/C++ runtimes",
    sourceUrl: "/licences/sfinder.txt",
    licence: "MIT/NCSA, BSD and Apache-2.0 WITH LLVM-exception; component-specific terms retained",
    copyright: "Emscripten, musl, LLVM and runtime contributors; see bundled notices",
  },
  {
    name: "Rust runtime",
    sourceUrl: "/licences/sfinder.txt",
    licence: "MIT OR Apache-2.0; embedded BSD and Unicode notices retained",
    copyright: "The Rust Project Developers and embedded component authors; see bundled notices",
  },
  {
    name: "highs-js",
    sourceUrl: "https://github.com/lovasoa/highs-js",
    licence: "MIT License",
    copyright: "Copyright (c) 2023 highs-js",
  },
  {
    name: "HiGHS",
    sourceUrl: "https://github.com/ERGO-Code/HiGHS",
    licence: "MIT License",
    copyright: "Copyright (c) 2026 HiGHS",
  },
  {
    name: "React, React DOM, and Scheduler",
    sourceUrl: "https://github.com/facebook/react",
    licence: "MIT License",
    copyright: "Copyright (c) Facebook, Inc. and its affiliates",
  },
  {
    name: "loose-envify and js-tokens",
    sourceUrl: "https://github.com/zertosh/loose-envify",
    licence: "MIT License",
    copyright: "Copyright (c) 2015 Andres Suarez; Copyright (c) 2014–2018 Simon Lydell",
  },
  {
    name: "LZ-String",
    sourceUrl: "https://github.com/pieroxy/lz-string",
    licence: "MIT License",
    copyright: "Copyright (c) 2013 pieroxy",
  },
  {
    name: "tetris-fumen",
    sourceUrl: "https://github.com/knewjade/tetris-fumen",
    licence: "MIT License",
    copyright: "Copyright (c) 2019",
  },
  {
    name: "gifenc",
    sourceUrl: "https://github.com/mattdesl/gifenc",
    licence: "MIT License",
    copyright: "Copyright (c) 2017 Matt DesLauriers",
  },
] as const;

export const SFINDER_ACKNOWLEDGEMENTS: readonly Acknowledgement[] = [
  {
    name: "OR-Tools / or-tools-wasm",
    sourceUrl: "https://github.com/Axelwickm/or-tools-wasm",
    credit: "Google OR-Tools team and or-tools-wasm contributors",
    summary: "The CP-SAT solver and its WebAssembly port prove the exact minimum number of solutions for large reduced cover matrices. SFinder runs this backend with two solver workers and then uses its Rust quality optimization to choose among minimum-size sets.",
  },
  {
    name: "solution-finder (SFinder)",
    sourceUrl: "https://github.com/knewjade/solution-finder",
    credit: "knewjade",
    summary: "Its queue-pattern expansion, Perfect Clear reachability results, and chance, saves, minimals, and cover command behavior were used as compatibility targets. QniaPC also uses it offline to verify setup geometry and solver output independently of the browser runtime.",
  },
  {
    name: "sfinder-strict-minimal",
    sourceUrl: "https://github.com/eight04/sfinder-strict-minimal",
    credit: "eight04",
    summary: "Its graph-reduction model and definition of a minimal covering solution set informed early minimal-set behavior. The current sfinder-wasm minimum-cover implementation was subsequently replaced with an independent implementation.",
  },
  {
    name: "PC-Saves-Get",
    sourceUrl: "https://github.com/Marfung37/PC-Saves-Get",
    credit: "Marfung37",
    summary: "Its saved-piece analysis helped define how unused queue pieces are classified and how wanted-save expressions are evaluated across successful queues. Its Python source is not included in QniaPC or sfinder-wasm.",
  },
  {
    name: "sfinder-man",
    sourceUrl: "https://github.com/cringemoment/sfinder-man",
    credit: "cringemoment",
    summary: "Its command workflows informed the arrangement of source Fumen, queue patterns, command options, and result handling used by the browser-facing SFinder tools. Its Python wrapper code is not included.",
  },
  {
    name: "tetra-tools",
    sourceUrl: "https://github.com/wirelyre/tetra-tools",
    credit: "wirelyre",
    summary: "Its vectorized placement search and legal-board pruning techniques informed the performance architecture of the four-line solver. sfinder-wasm uses independently written search code, data structures, WASM interfaces, and legal-board generation; tetra-tools code is neither bundled nor linked.",
  },
  {
    name: "ezSFinder",
    sourceUrl: "https://github.com/cringemoment/ezsfinder",
    credit: "cringemoment; upstream credits include torch, swng, marfung, eight08, and knewjade",
    summary: "Its external helper workflow informed how repeated SFinder calculations and setup-analysis steps can be organized around the command-line solver. QniaPC implements the corresponding browser workflow independently and does not include ezSFinder code.",
  },
] as const;

export const SETUP_DATA_ACKNOWLEDGEMENTS: readonly Acknowledgement[] = [
  {
    name: "Perfect Clear Info Korea",
    sourceUrl: "https://www.perfectclearinfokorea.com/",
    credit: "Korean Perfect Clear Association; Bibii, Holifyre, Paback, SingSing7538, ozsitjl, and algebruh",
    summary: "Reference for cycle-based setup catalogs, advanced setups, and QB/OQB conditions.",
  },
  {
    name: "Perfect Clear setup sheet",
    sourceUrl: "https://docs.qq.com/sheet/DRmxvWmt3SWxwS2tV",
    credit: "NitenTeria and mww",
    summary: "Reference for Perfect Clear setup research and cross-checking.",
  },
  {
    name: "Algebruh's 7th",
    credit: "algebruh",
    summary: "Reference for seventh-cycle Perfect Clear setups, including advanced material.",
  },
] as const;
