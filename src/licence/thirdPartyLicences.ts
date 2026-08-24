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
    licence: "MIT License for distribution with QniaPC",
    copyright: "Qnia (@Qnia28)",
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
