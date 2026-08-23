import { PIECES, type Cycle, type Piece } from "../engine/types";
import type { SetupQuery } from "./query";

export type Cycle1ClassificationMode =
  | "normal-seven-bag"
  | "normal-seven-bag-prefix"
  | "replacement-cycle"
  | "unsupported-bag-window";

export interface Cycle1Replacement {
  /** Extra piece that replaces another piece, written first in project notation. */
  extraPiece: Piece;
  /** Missing normal-bag piece, written second in project notation. */
  replacedPiece: Piece;
  /** Project notation: extra > replaced, for example L>O. */
  label: `${Piece}>${Piece}`;
}

export interface Cycle1QueueContext {
  visiblePieces: Piece[];
  /** Complete current-bag piece pool available to the setup search. */
  buildPieces: Piece[];
  /** NEXT queue with the hidden final bag piece restored when HOLD is empty. */
  searchNext: Piece[];
  /** Number of searchNext pieces that belong to the current setup bag. */
  placeableNextCount: number;
  classificationMode: Cycle1ClassificationMode;
  replacement?: Cycle1Replacement;
  inferredLastPiece?: Piece;
}

function pieceCounts(pieces: readonly Piece[]): Map<Piece, number> {
  const counts = new Map<Piece, number>(PIECES.map((piece) => [piece, 0]));
  for (const piece of pieces) counts.set(piece, (counts.get(piece) ?? 0) + 1);
  return counts;
}

/**
 * Distinguishes a normal Cycle 1 bag from the replacement state reached after
 * Cycle 7. With HOLD occupied, H + A + NEXT 5 is the complete seven-piece
 * boundary. At a fresh game start HOLD is empty, so A + NEXT 5 is only a
 * six-piece prefix and can prove normality only when it contains no duplicate.
 */
export function cycle1QueueContext(query: SetupQuery): Cycle1QueueContext | null {
  if (query.next.length < 5) return null;
  const visiblePieces = query.hold === null
    ? [query.active, ...query.next.slice(0, 5)]
    : [query.hold, query.active, ...query.next.slice(0, 5)];
  const counts = pieceCounts(visiblePieces);

  if (query.hold === null) {
    const prefixIsDistinct = [...counts.values()].every((count) => count <= 1);
    const inferredLastPiece = prefixIsDistinct
      ? PIECES.find((piece) => !visiblePieces.includes(piece))
      : undefined;
    if (!inferredLastPiece) {
      return {
        visiblePieces,
        buildPieces: visiblePieces,
        searchNext: query.next.slice(0, 5),
        placeableNextCount: 5,
        classificationMode: "unsupported-bag-window",
      };
    }
    return {
      visiblePieces,
      buildPieces: [...visiblePieces, inferredLastPiece],
      searchNext: [...query.next.slice(0, 5), inferredLastPiece],
      placeableNextCount: 6,
      classificationMode: "normal-seven-bag-prefix",
      inferredLastPiece,
    };
  }

  if ([...counts.values()].every((count) => count === 1)) {
    return {
      visiblePieces,
      buildPieces: visiblePieces,
      searchNext: query.next,
      placeableNextCount: Math.min(query.next.length, 5),
      classificationMode: "normal-seven-bag",
    };
  }

  const extraPieces = PIECES.filter((piece) => counts.get(piece) === 2);
  const replacedPieces = PIECES.filter((piece) => counts.get(piece) === 0);
  const isSingleReplacement = extraPieces.length === 1
    && replacedPieces.length === 1
    && [...counts.values()].every((count) => count >= 0 && count <= 2);
  if (isSingleReplacement) {
    const extraPiece = extraPieces[0];
    const replacedPiece = replacedPieces[0];
    return {
      visiblePieces,
      buildPieces: visiblePieces,
      searchNext: query.next,
      placeableNextCount: Math.min(query.next.length, 5),
      classificationMode: "replacement-cycle",
      replacement: {
        extraPiece,
        replacedPiece,
        label: `${extraPiece}>${replacedPiece}`,
      },
    };
  }

  return {
    visiblePieces,
    buildPieces: visiblePieces,
    searchNext: query.next,
    placeableNextCount: Math.min(query.next.length, 5),
    classificationMode: "unsupported-bag-window",
  };
}

export function isNormalCycle1Context(context: Cycle1QueueContext): boolean {
  return context.classificationMode === "normal-seven-bag"
    || context.classificationMode === "normal-seven-bag-prefix";
}

/**
 * User-facing cycle number. Replacement windows are the alternate Cycle 1
 * bag form documented as Cycle 8, while the authoritative game phase remains
 * Cycle 1 for progression and bag arithmetic.
 */
export function displayCycleForQuery(query: SetupQuery): Cycle | 8 {
  if (query.cycle !== 1) return query.cycle;
  return cycle1QueueContext(query)?.classificationMode === "replacement-cycle" ? 8 : 1;
}
