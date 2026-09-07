export const PIECES = ["I", "J", "L", "O", "S", "T", "Z"] as const;
export type Piece = (typeof PIECES)[number];
export const ORIENTATIONS = ["N", "E", "S", "W"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export type RotationDirection = "CW" | "CCW" | "R180";
export type Cell = { x: number; y: number };
export type GrayCell = "X";
export type BoardCell = Piece | GrayCell | null;
export type Board = BoardCell[][];

export interface ActivePiece {
  piece: Piece;
  orientation: Orientation;
  x: number;
  y: number;
}

export interface BagState {
  rngState: number;
  queue: Piece[];
}

export type Cycle = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RunState {
  cycle: Cycle;
  pcCount: number;
  piecesLockedSinceLastPc: number;
  linesSinceLastPc: number;
  status: "playing" | "failed";
  message: string;
}

export interface GameState {
  board: Board;
  active: ActivePiece;
  hold: Piece | null;
  holdUsedThisTurn: boolean;
  bag: BagState;
  run: RunState;
  seed: string;
}

export type GameAction =
  | "moveLeft"
  | "moveRight"
  | "stepDown"
  | "softDrop"
  | "hardDrop"
  | "rotateCW"
  | "rotateCCW"
  | "rotate180"
  | "hold"
  | "undo"
  | "restart"
  | "randomSeed";

export const BOARD_WIDTH = 10;
export const VISIBLE_HEIGHT = 20;
export const BOARD_HEIGHT = 24;
export const MOBILE_BOARD_HEIGHT = 10;
