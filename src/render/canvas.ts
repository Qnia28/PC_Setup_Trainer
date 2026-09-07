import { ghostPiece } from "../engine/game";
import { occupiedCells } from "../engine/pieces";
import { BOARD_WIDTH, VISIBLE_HEIGHT, type BoardCell, type Cell, type GameState, type Piece } from "../engine/types";
import type { SetupVariant } from "../setups/schema";

export const PIECE_COLORS: Record<Exclude<BoardCell, null>, string> = {
  I: "#35c8e6",
  J: "#4f6ee8",
  L: "#ff9f31",
  O: "#f5d547",
  S: "#55c96b",
  T: "#b562d8",
  Z: "#ef5b65",
  X: "#777f8c",
};

export interface SetupShadowCell {
  cell: Cell;
  piece: Piece;
}

/** Returns only empty-board target cells; source geometry itself remains unchanged. */
export function visibleSetupShadowCells(state: GameState, setup: SetupVariant): SetupShadowCell[] {
  return setup.placements.flatMap((placement) => placement.cells
    .filter((cell) => state.board[cell.y]?.[cell.x] === null)
    .map((cell) => ({ cell, piece: placement.piece })));
}

function prepareCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}
function drawCell(
  context: CanvasRenderingContext2D,
  cell: Cell,
  piece: Exclude<BoardCell, null>,
  size: number,
  alpha = 1,
  inset = 1,
  visibleHeight = VISIBLE_HEIGHT,
): void {
  if (cell.y < 0 || cell.y >= visibleHeight) return;
  const x = cell.x * size;
  const y = (visibleHeight - 1 - cell.y) * size;
  context.globalAlpha = alpha;
  context.fillStyle = PIECE_COLORS[piece];
  context.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  context.fillStyle = "rgba(255,255,255,.22)";
  context.fillRect(x + inset + 1, y + inset + 1, size - inset * 2 - 2, Math.max(2, size * 0.09));
  context.globalAlpha = 1;
}

export function drawBoardViewport(
  canvas: HTMLCanvasElement,
  state: GameState,
  setup: SetupVariant | null,
  showGuide: boolean,
  visibleHeight: number,
  size: number,
): void {
  const context = prepareCanvas(canvas, BOARD_WIDTH * size, visibleHeight * size);
  context.fillStyle = "#11151c";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255,255,255,.07)";
  context.lineWidth = 1;
  for (let x = 0; x <= BOARD_WIDTH; x += 1) {
    context.beginPath(); context.moveTo(x * size + .5, 0); context.lineTo(x * size + .5, visibleHeight * size); context.stroke();
  }
  for (let y = 0; y <= visibleHeight; y += 1) {
    context.beginPath(); context.moveTo(0, y * size + .5); context.lineTo(BOARD_WIDTH * size, y * size + .5); context.stroke();
  }

  if (setup && showGuide) {
    for (const { cell, piece } of visibleSetupShadowCells(state, setup)) {
      drawCell(context, cell, piece, size, .23, 2, visibleHeight);
    }
  }
  for (let y = 0; y < visibleHeight; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      const piece = state.board[y]?.[x];
      if (piece) drawCell(context, { x, y }, piece, size, 1, 1, visibleHeight);
    }
  }
  if (state.run.status === "playing") {
    for (const cell of occupiedCells(ghostPiece(state))) drawCell(context, cell, state.active.piece, size, .2, 3, visibleHeight);
    for (const cell of occupiedCells(state.active)) drawCell(context, cell, state.active.piece, size, 1, 1, visibleHeight);
  }
}

export function drawBoard(canvas: HTMLCanvasElement, state: GameState, setup: SetupVariant | null, showGuide: boolean): void {
  drawBoardViewport(canvas, state, setup, showGuide, Math.min(state.board.length, VISIBLE_HEIGHT), 30);
}
export function drawPiecePreview(canvas: HTMLCanvasElement, piece: Piece | null): void {
  const context = prepareCanvas(canvas, 96, 64);
  context.clearRect(0, 0, 96, 64);
  if (!piece) return;
  const cells = piece === "I"
    ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]
    : piece === "O"
      ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
      : occupiedCells({ piece, orientation: "N", x: 1, y: 0 });
  const minX = Math.min(...cells.map(({ x }) => x));
  const maxX = Math.max(...cells.map(({ x }) => x));
  const minY = Math.min(...cells.map(({ y }) => y));
  const maxY = Math.max(...cells.map(({ y }) => y));
  const size = 20;
  const offsetX = (96 - (maxX - minX + 1) * size) / 2 - minX * size;
  const offsetY = (64 - (maxY - minY + 1) * size) / 2 + maxY * size;
  for (const cell of cells) {
    context.globalAlpha = 1;
    context.fillStyle = PIECE_COLORS[piece];
    context.fillRect(offsetX + cell.x * size + 1, offsetY - cell.y * size + 1, size - 2, size - 2);
  }
}

export function drawSetupPreview(canvas: HTMLCanvasElement, setup: SetupVariant): void {
  const size = 18;
  const context = prepareCanvas(canvas, BOARD_WIDTH * size, 4 * size);
  context.fillStyle = "#11151c";
  context.fillRect(0, 0, BOARD_WIDTH * size, 4 * size);
  for (const placement of setup.placements) {
    for (const cell of placement.cells) {
      const y = 3 - cell.y;
      context.fillStyle = PIECE_COLORS[placement.piece];
      context.fillRect(cell.x * size + 1, y * size + 1, size - 2, size - 2);
    }
  }
}

export function solutionPreviewOccupiedCells(board: GameState["board"], visibleHeight = 4): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < visibleHeight; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (board[y]?.[x] !== null) cells.push({ x, y });
    }
  }
  return cells;
}

export function drawSolutionPreview(canvas: HTMLCanvasElement, setup: SetupVariant, board: GameState["board"]): void {
  const visibleHeight = 4;
  const size = 30;
  const context = prepareCanvas(canvas, BOARD_WIDTH * size, visibleHeight * size);
  context.fillStyle = "#11151c";
  context.fillRect(0, 0, BOARD_WIDTH * size, visibleHeight * size);
  context.strokeStyle = "rgba(255,255,255,.09)";
  context.lineWidth = 1;
  for (let x = 0; x <= BOARD_WIDTH; x += 1) {
    context.beginPath(); context.moveTo(x * size + .5, 0); context.lineTo(x * size + .5, visibleHeight * size); context.stroke();
  }
  for (let y = 0; y <= visibleHeight; y += 1) {
    context.beginPath(); context.moveTo(0, y * size + .5); context.lineTo(BOARD_WIDTH * size, y * size + .5); context.stroke();
  }
  for (const cell of solutionPreviewOccupiedCells(board, visibleHeight)) {
    drawCell(context, cell, "X", size, 1, 1, visibleHeight);
  }
  for (const placement of setup.placements) {
    for (const cell of placement.cells) drawCell(context, cell, placement.piece, size, 1, 1, visibleHeight);
  }
}
