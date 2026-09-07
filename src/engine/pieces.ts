import { BOARD_HEIGHT, type ActivePiece, type Cell, type Orientation, type Piece } from "./types";

const SPAWN_CELLS: Record<Exclude<Piece, "I" | "O">, Cell[]> = {
  T: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  J: [{ x: -1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
  L: [{ x: 1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
  S: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }],
  Z: [{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
};

const I_CELLS: Record<Orientation, Cell[]> = {
  N: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  E: [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 1, y: -2 }],
  S: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 2, y: -1 }],
  W: [{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -2 }],
};

const O_CELLS: Cell[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

const turns: Record<Orientation, number> = { N: 0, E: 1, S: 2, W: 3 };

function rotateClockwise(cell: Cell): Cell {
  return { x: cell.y, y: -cell.x };
}

function rotateNTimes(cells: Cell[], count: number): Cell[] {
  let result = cells;
  for (let i = 0; i < count; i += 1) result = result.map(rotateClockwise);
  return result;
}

export function localCells(piece: Piece, orientation: Orientation): Cell[] {
  if (piece === "I") return I_CELLS[orientation];
  if (piece === "O") return O_CELLS;
  return rotateNTimes(SPAWN_CELLS[piece], turns[orientation]);
}

export function occupiedCells(active: ActivePiece): Cell[] {
  return localCells(active.piece, active.orientation).map(({ x, y }) => ({
    x: x + active.x,
    y: y + active.y,
  }));
}

export function spawnPiece(piece: Piece, boardHeight = BOARD_HEIGHT): ActivePiece {
  const y = boardHeight === 8 ? (piece === "I" ? 6 : 5) : boardHeight === 10 ? 8 : 18;
  return { piece, orientation: "N", x: 4, y };
}

export function sortedCellKey(cells: Cell[]): string {
  return cells
    .map(({ x, y }) => `${x},${y}`)
    .sort()
    .join(";");
}
