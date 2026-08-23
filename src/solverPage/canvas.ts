import type { decoder } from "tetris-fumen";
import { PIECE_COLORS } from "../render/canvas";

export const SOLVER_FIELD_WIDTH = 10;
export const SOLVER_FIELD_MAX_HEIGHT = 6;

type FumenPage = ReturnType<typeof decoder.decode>[number];

function contextFor(canvas: HTMLCanvasElement, cellSize: number, visibleRows: number): CanvasRenderingContext2D {
  const cssWidth = SOLVER_FIELD_WIDTH * cellSize;
  const cssHeight = visibleRows * cellSize;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function drawGrid(context: CanvasRenderingContext2D, cellSize: number, visibleRows: number): void {
  context.fillStyle = "#0d131a";
  context.fillRect(0, 0, SOLVER_FIELD_WIDTH * cellSize, visibleRows * cellSize);
  context.strokeStyle = "rgba(255,255,255,.11)";
  context.lineWidth = 1;
  for (let x = 0; x <= SOLVER_FIELD_WIDTH; x += 1) {
    context.beginPath();
    context.moveTo(x * cellSize + .5, 0);
    context.lineTo(x * cellSize + .5, visibleRows * cellSize);
    context.stroke();
  }
  for (let y = 0; y <= visibleRows; y += 1) {
    context.beginPath();
    context.moveTo(0, y * cellSize + .5);
    context.lineTo(SOLVER_FIELD_WIDTH * cellSize, y * cellSize + .5);
    context.stroke();
  }
}

function fillCell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  cellSize: number,
  visibleRows: number,
): void {
  const screenY = visibleRows - 1 - y;
  context.fillStyle = color;
  context.fillRect(x * cellSize + 1, screenY * cellSize + 1, cellSize - 2, cellSize - 2);
  context.fillStyle = "rgba(255,255,255,.2)";
  context.fillRect(x * cellSize + 2, screenY * cellSize + 2, cellSize - 4, 3);
}

export function drawEditableField(
  canvas: HTMLCanvasElement,
  field: readonly (readonly boolean[])[],
  visibleRows = 4,
): void {
  const cellSize = 38;
  const context = contextFor(canvas, cellSize, visibleRows);
  drawGrid(context, cellSize, visibleRows);
  for (let y = 0; y < visibleRows; y += 1) {
    for (let x = 0; x < SOLVER_FIELD_WIDTH; x += 1) {
      if (field[y]?.[x]) fillCell(context, x, y, PIECE_COLORS.X, cellSize, visibleRows);
    }
  }
}

export function drawSolutionPage(canvas: HTMLCanvasElement, page: FumenPage, visibleRows = 4): void {
  const cellSize = 24;
  const context = contextFor(canvas, cellSize, visibleRows);
  drawGrid(context, cellSize, visibleRows);
  for (let y = 0; y < visibleRows; y += 1) {
    for (let x = 0; x < SOLVER_FIELD_WIDTH; x += 1) {
      const value = page.field.at(x, y);
      if (value === "_") continue;
      const color = PIECE_COLORS[value as keyof typeof PIECE_COLORS] ?? PIECE_COLORS.X;
      fillCell(context, x, y, color, cellSize, visibleRows);
    }
  }
}
