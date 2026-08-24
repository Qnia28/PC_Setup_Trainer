import { decoder } from "tetris-fumen";
import { boardFromFumenPage } from "./board.mjs";
import { expandPattern } from "./pattern.mjs";
import { enumerateQueuesCached } from "./path-engine.mjs";
import { queueCanSave } from "./saves.mjs";

const DETAIL = [
  ["TL/TJ", "TL||TJ"], ["TI", "TI"], ["TO", "TO"], ["TS/TZ", "TS||TZ"],
  ["LJ", "LJ"], ["OI", "OI"], ["IL/IJ", "IL||IJ"], ["IS/IZ", "IS||IZ"],
  ["OL/OJ", "OL||OJ"], ["JS/LZ", "JS||LZ"], ["JZ/LS", "JZ||LS"],
  ["OS/OZ", "OS||OZ"], ["SZ", "SZ"],
];

export function fourthQueues(hold, nextPair) {
  const normalizedHold = hold.toUpperCase();
  const pair = nextPair.toUpperCase();
  const pairSet = new Set(pair);
  const remain = [..."TLJISZO"].filter((piece) => !pairSet.has(piece)).join("");
  return {
    pathPattern: `${normalizedHold},${pair[0]},${pair[1]},[${remain}]p4`,
    savePattern: `${normalizedHold},${pair[0]},${pair[1]},[^${pair}]p4`,
  };
}

export function calculateFourthDistribution({ sourceFumen, hold, nextPair, solver, useHold = true }) {
  const { pathPattern, savePattern } = fourthQueues(hold, nextPair);
  const board = boardFromFumenPage(decoder.decode(sourceFumen)[0]);
  const queues = expandPattern(pathPattern);
  const rows = enumerateQueuesCached({ board, queues, solver, useHold });
  const counts = Array(DETAIL.length).fill(0);
  let solved = 0;
  for (let queueIndex = 0; queueIndex < queues.length; queueIndex += 1) {
    const queue = queues[queueIndex];
    const solutions = rows[queueIndex];
    if (solutions.length) solved += 1;
    for (let rank = 0; rank < DETAIL.length; rank += 1) {
      if (queueCanSave(queue, solutions, savePattern, DETAIL[rank][1])) {
        counts[rank] += 1;
        break;
      }
    }
  }
  let cumulative = 0;
  return {
    pathPattern,
    savePattern,
    total: queues.length,
    solved,
    ranks: DETAIL.map(([label, expression], index) => {
      cumulative += counts[index];
      return { label, expression, count: counts[index], cumulativeCount: cumulative, total: queues.length };
    }),
  };
}
