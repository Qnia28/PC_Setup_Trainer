export const COMMAND_FIELD_WIDTH = 10;
export const COMMAND_FIELD_MAX_HEIGHT = 6;

export type CommandField = boolean[][];

export function createEmptyCommandField(): CommandField {
  return Array.from({ length: COMMAND_FIELD_MAX_HEIGHT }, () =>
    Array<boolean>(COMMAND_FIELD_WIDTH).fill(false));
}

export function drawCommandField(
  canvas: HTMLCanvasElement,
  field: readonly (readonly boolean[])[],
  visibleRows: number,
): void {
  const cellSize = 36;
  const ratio = window.devicePixelRatio || 1;
  const width = COMMAND_FIELD_WIDTH * cellSize;
  const height = visibleRows * cellSize;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#0d131a";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(255,255,255,.11)";
  context.lineWidth = 1;

  for (let x = 0; x <= COMMAND_FIELD_WIDTH; x += 1) {
    context.beginPath();
    context.moveTo(x * cellSize + .5, 0);
    context.lineTo(x * cellSize + .5, height);
    context.stroke();
  }
  for (let y = 0; y <= visibleRows; y += 1) {
    context.beginPath();
    context.moveTo(0, y * cellSize + .5);
    context.lineTo(width, y * cellSize + .5);
    context.stroke();
  }

  for (let y = 0; y < visibleRows; y += 1) {
    for (let x = 0; x < COMMAND_FIELD_WIDTH; x += 1) {
      if (!field[y]?.[x]) continue;
      const screenY = visibleRows - 1 - y;
      context.fillStyle = "#8a95a5";
      context.fillRect(x * cellSize + 1, screenY * cellSize + 1, cellSize - 2, cellSize - 2);
      context.fillStyle = "rgba(255,255,255,.18)";
      context.fillRect(x * cellSize + 2, screenY * cellSize + 2, cellSize - 4, 3);
    }
  }
}
