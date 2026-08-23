import { ghostPiece } from "../engine/game";
import { localCells, occupiedCells } from "../engine/pieces";
import { BOARD_WIDTH, type BoardCell, type Cell, type GameState, type Piece } from "../engine/types";
import { PIECE_COLORS } from "../render/canvas";
import { deserializeBoard, type ReplayFrame } from "./format";

function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number, pixelRatio = window.devicePixelRatio || 1): CanvasRenderingContext2D {
  const ratio = Math.max(1, pixelRatio);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

export const REPLAY_CELL_SIZE = 36;
export const REPLAY_PLAYFIELD_HEIGHT = 5;
export const REPLAY_VISIBLE_HEIGHT = 8;

export function replayCurrentPieceCells(piece: Piece): Cell[] {
  return localCells(piece, "N").map(({ x, y }) => ({
    x: x + Math.floor(BOARD_WIDTH / 2) - 1,
    y: y + (piece === "I" ? REPLAY_PLAYFIELD_HEIGHT + 1 : REPLAY_PLAYFIELD_HEIGHT),
  }));
}

function cellPosition({ x, y }: Cell, size: number): { x: number; y: number } {
  return { x: x * size, y: (REPLAY_VISIBLE_HEIGHT - 1 - y) * size };
}

function drawCell(context: CanvasRenderingContext2D, cell: Cell, piece: Exclude<BoardCell, null>, size: number, alpha = 1, inset = 1): void {
  if (cell.y < 0 || cell.y >= REPLAY_VISIBLE_HEIGHT) return;
  const position = cellPosition(cell, size);
  context.globalAlpha = alpha;
  context.fillStyle = PIECE_COLORS[piece];
  context.fillRect(position.x + inset, position.y + inset, size - inset * 2, size - inset * 2);
  context.fillStyle = "rgba(255,255,255,.22)";
  context.fillRect(position.x + inset + 1, position.y + inset + 1, size - inset * 2 - 2, 2);
  context.globalAlpha = 1;
}

function drawGrid(context: CanvasRenderingContext2D, size: number): void {
  context.fillStyle = "#11151c";
  context.fillRect(0, 0, BOARD_WIDTH * size, REPLAY_VISIBLE_HEIGHT * size);
  context.strokeStyle = "rgba(255,255,255,.07)";
  for (let x = 0; x <= BOARD_WIDTH; x += 1) {
    context.beginPath(); context.moveTo(x * size + .5, 0); context.lineTo(x * size + .5, REPLAY_VISIBLE_HEIGHT * size); context.stroke();
  }
  for (let y = 0; y <= REPLAY_VISIBLE_HEIGHT; y += 1) {
    context.beginPath(); context.moveTo(0, y * size + .5); context.lineTo(BOARD_WIDTH * size, y * size + .5); context.stroke();
  }
}

export function drawReplayFrame(
  canvas: HTMLCanvasElement,
  frame: ReplayFrame,
  options: { pixelRatio?: number } = {},
): void {
  const size = REPLAY_CELL_SIZE;
  const context = prepareCanvas(canvas, BOARD_WIDTH * size, REPLAY_VISIBLE_HEIGHT * size, options.pixelRatio);
  drawGrid(context, size);

  context.fillStyle = "rgba(111,211,244,.035)";
  context.fillRect(0, 0, BOARD_WIDTH * size, (REPLAY_VISIBLE_HEIGHT - REPLAY_PLAYFIELD_HEIGHT) * size);
  context.strokeStyle = "rgba(111,211,244,.32)";
  context.beginPath();
  context.moveTo(0, (REPLAY_VISIBLE_HEIGHT - REPLAY_PLAYFIELD_HEIGHT) * size + .5);
  context.lineTo(BOARD_WIDTH * size, (REPLAY_VISIBLE_HEIGHT - REPLAY_PLAYFIELD_HEIGHT) * size + .5);
  context.stroke();

  const board = deserializeBoard(frame.displayBoard ?? frame.snapshot.board);
  for (let y = 0; y < REPLAY_VISIBLE_HEIGHT; y += 1) for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const piece = board[y]?.[x];
    if (piece) drawCell(context, { x, y }, piece, size);
  }
  for (const cell of replayCurrentPieceCells(frame.snapshot.active)) {
    drawCell(context, cell, frame.snapshot.active, size);
  }
  if (frame.placement) {
    context.strokeStyle = "rgba(255,255,255,.92)";
    context.lineWidth = 2;
    for (const cell of frame.placement.cells) {
      if (cell.y < 0 || cell.y >= REPLAY_VISIBLE_HEIGHT) continue;
      const position = cellPosition(cell, size);
      context.strokeRect(position.x + 2, position.y + 2, size - 4, size - 4);
    }
  }
}

export function drawReplaySnapshotGame(canvas: HTMLCanvasElement, state: GameState): void {
  const size = REPLAY_CELL_SIZE;
  const context = prepareCanvas(canvas, BOARD_WIDTH * size, REPLAY_VISIBLE_HEIGHT * size);
  drawGrid(context, size);
  for (let y = 0; y < REPLAY_VISIBLE_HEIGHT; y += 1) for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const piece = state.board[y]?.[x];
    if (piece) drawCell(context, { x, y }, piece, size);
  }
  if (state.run.status === "playing") {
    for (const cell of occupiedCells(ghostPiece(state))) drawCell(context, cell, state.active.piece, size, .2, 3);
    for (const cell of occupiedCells(state.active)) drawCell(context, cell, state.active.piece, size);
  }
}
