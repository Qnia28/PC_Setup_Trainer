import { PIECES, type Piece } from "../engine/types";
import { sortPiecesForDisplay } from "../engine/pieceDisplay";
import { normalizeQueue, type DictionaryPc } from "./model";

export type DictionarySearchInput =
  | { kind: "queue"; value: string }
  | { kind: "class"; pc: DictionaryPc; pieces: Piece[]; value: string };

const CLASS_LENGTH: Partial<Record<DictionaryPc, number>> = { 2: 4, 3: 1, 4: 5, 5: 2, 6: 6 };

export function parseDictionarySearch(pc: DictionaryPc, value: string): DictionarySearchInput {
  const input = normalizeQueue(value);
  if (/^[TILJOSZ]{7}$/.test(input)) return { kind: "queue", value: input };
  const length = CLASS_LENGTH[pc];
  if (!length) throw new Error(`Enter a 7-piece queue for PC# ${pc}.`);
  const exclusion = /^(?:NO|-)([TILJOSZ]+)$/.exec(input);
  const token = exclusion?.[1] ?? input;
  if (!/^[TILJOSZ]+$/.test(token) || new Set(token).size !== token.length) {
    throw new Error(`Enter a 7-piece queue, a ${length}-piece class, or NO / - followed by excluded pieces.`);
  }
  const pieces = exclusion ? PIECES.filter(piece => !token.includes(piece)) : [...token] as Piece[];
  if (pieces.length !== length) throw new Error(`PC# ${pc} requires ${length} distinct class pieces (${7 - length} excluded).`);
  const ordered = sortPiecesForDisplay(pieces);
  return { kind: "class", pc, pieces: ordered, value: exclusion
    ? `NO ${sortPiecesForDisplay(PIECES.filter(piece => token.includes(piece))).join("")}` : ordered.join("") };
}
