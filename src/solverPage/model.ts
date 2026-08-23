export type StandaloneSolveDisplayMode = "one" | "all";
export type StandaloneSolveKind = "solve-one" | "solve-all" | "per-save-minimals" | "per-save-all";

export interface StandaloneSolveAnalysis {
  kind: StandaloneSolveKind;
  placedPieces: number;
  piecesNeeded: number;
  queueWindow: string;
  queueWindowLength: number;
  saveMode: boolean;
}

export type StandaloneSolvePreparation =
  | { ready: true; analysis: StandaloneSolveAnalysis }
  | { ready: false; reason: string };

export function prepareStandaloneSolve(input: {
  occupiedCells: number;
  queue: string;
  displayMode: StandaloneSolveDisplayMode;
  targetLines?: 2 | 3 | 4 | 5 | 6;
}): StandaloneSolvePreparation {
  const { occupiedCells, queue, displayMode, targetLines = 4 } = input;
  if (/[^TILJOSZ]/.test(queue)) {
    return { ready: false, reason: "Queue contains invalid characters. Use only T, I, L, J, O, S, and Z." };
  }
  const targetCells = targetLines * 10;
  if (occupiedCells < 0 || occupiedCells > targetCells) {
    return { ready: false, reason: `The field exceeds the ${targetLines}-line solver format.` };
  }
  if (occupiedCells % 4 !== 0) {
    return { ready: false, reason: "The field does not correspond to a whole number of placed pieces." };
  }
  const remainingCells = targetCells - occupiedCells;
  if (remainingCells <= 0 || remainingCells % 4 !== 0) {
    return { ready: false, reason: `The field cannot complete the ${targetLines}-line Perfect Clear target.` };
  }
  const placedPieces = occupiedCells / 4;
  const piecesNeeded = remainingCells / 4;
  if (queue.length < piecesNeeded) {
    return { ready: false, reason: `This field requires see${piecesNeeded}, but the queue has ${queue.length} pieces.` };
  }
  const saveMode = queue.length >= piecesNeeded + 1;
  const queueWindowLength = piecesNeeded + (saveMode ? 1 : 0);
  const kind: StandaloneSolveKind = saveMode
    ? displayMode === "all" ? "per-save-all" : "per-save-minimals"
    : displayMode === "all" ? "solve-all" : "solve-one";
  return {
    ready: true,
    analysis: {
      kind,
      placedPieces,
      piecesNeeded,
      queueWindow: queue.slice(0, queueWindowLength),
      queueWindowLength,
      saveMode,
    },
  };
}
