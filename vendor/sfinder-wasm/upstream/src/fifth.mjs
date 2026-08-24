import { decoder } from "tetris-fumen";
import { boardFromFumenPage } from "./board.mjs";
import { combineWithIntro, solutionPage } from "./fumen.mjs";
import { makeOrderCountQuality, recordOrderCount } from "./human-ranking.mjs";
import { minimumCover } from "./min-cover.mjs";
import { expandPatternCases } from "./pattern.mjs";
import { visitCaseSolutions } from "./path-engine.mjs";
import { filterSolutionsForSave, queueCanSave } from "./saves.mjs";
import { TETRIS_DISPLAY_ORDER } from "./piece-order.mjs";

export const FIFTH_PIECES = TETRIS_DISPLAY_ORDER;
export const FIFTH_DISPLAY_ORDER = "SZOLJIT";
export const FIFTH_BESTSAVE_PIECES = "ILJSZO";
export const fifthSaveCondition = (piece) => [...FIFTH_PIECES].filter((value) => value !== piece).join("");

function caseSeesPiece(entry, piece) {
  const drawCount = (entry.observedBag ?? entry.lastBag)?.drawCount ?? 0;
  return drawCount > 0 && entry.queue.slice(-drawCount).includes(piece);
}

export function fifthMinimalsPerSaves({ sourceFumen, analysisPattern, solver, useHold = true }) {
  const board = boardFromFumenPage(decoder.decode(sourceFumen)[0]);
  const cases = expandPatternCases(analysisPattern);
  const queues = cases.map((entry) => entry.queue);
  const all = new Map(cases.map((entry) => [entry.caseId, []]));
  const qualityIndex = new Map();

  for (const entry of cases) {
    if (!entry.lastBag) {
      throw new Error(`5th analysis branch ${entry.branchIndex + 1} does not end in a bag token`);
    }
  }
  const { byKey } = visitCaseSolutions({
    board,
    cases,
    solver,
    useHold,
    trackCaseSolutions: false,
    visit: (entry, _caseIndex, solution, orderCount) => {
      all.get(entry.caseId).push(solution);
      recordOrderCount(qualityIndex, entry.caseId, { key: solution.key, orderCount });
    },
  });

  const qualityFor = makeOrderCountQuality(qualityIndex);
  const usages = {};
  const results = {};
  for (const piece of FIFTH_DISPLAY_ORDER) {
    const wanted = fifthSaveCondition(piece);
    const coverage = new Map();
    let success = 0;
    let seen = 0;
    for (const entry of cases) {
      if (!caseSeesPiece(entry, piece)) continue;
      seen += 1;
      const solutions = all.get(entry.caseId) ?? [];
      if (queueCanSave(entry.queue, solutions, entry.lastBag, wanted)) success += 1;
      const filtered = filterSolutionsForSave(entry.queue, solutions, entry.lastBag, wanted);
      if (filtered.length) coverage.set(entry.caseId, new Set(filtered.map((solution) => solution.key)));
    }
    const availability = seen ? success / seen : 0;
    const isSee = seen > 0 && success === seen;
    const label = isSee ? `See ${piece}` : `Use ${piece}`;
    usages[piece] = {
      piece,
      success,
      total: queues.length,
      seen,
      availability,
      isSee,
      label,
    };
    if (success) {
      const minimal = minimumCover(coverage, { qualityFor, solver });
      const keys = [...minimal.keys].sort();
      results[piece] = {
        minimalCount: minimal.count,
        keys,
        solutions: keys.map((key) => byKey.get(key)),
        humanQualityVector: minimal.qualityVector ?? [],
      };
    } else {
      results[piece] = { minimalCount: 0, keys: [], solutions: [], humanQualityVector: [] };
    }
  }
  const bestsave = [...FIFTH_BESTSAVE_PIECES].every((piece) => usages[piece].isSee);
  return { board, cases, queues, all, usages, results, bestsave };
}

export function encodeFifthCombined({ sourceFumen, title, calculation }) {
  const pages = [];
  const pageCounts = {};
  for (const piece of FIFTH_DISPLAY_ORDER) {
    const result = calculation.results[piece];
    pageCounts[piece] = result.solutions.length;
    for (const solution of result.solutions) {
      const usage = calculation.usages[piece];
      const comment = usage.isSee ? `☆ ${usage.label}` : usage.label;
      pages.push(solutionPage(calculation.board, solution, comment));
    }
  }
  return { fumen: combineWithIntro(sourceFumen, title, pages), pageCounts };
}
