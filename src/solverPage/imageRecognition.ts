// Original screenshot recognizer. No eztofumen source or palettes are used.
import { localCells } from "../engine/pieces";
import { ORIENTATIONS, PIECES, type Piece } from "../engine/types";

export interface Raster { width: number; height: number; data: Uint8ClampedArray }
export interface ImageBoard { x: number; y: number; cell: number }
export interface ScreenshotResult {
  board: ImageBoard;
  field: boolean[][];
  hold: Piece | null;
  active: Piece;
  next: Piece[];
  queue: string;
}
interface Color { v: number; s: number; h: number }
function color(image: Raster, x: number, y: number): Color {
  const i = (Math.max(0, Math.min(image.height - 1, Math.round(y))) * image.width
    + Math.max(0, Math.min(image.width - 1, Math.round(x)))) * 4;
  const r = image.data[i]! / 255, g = image.data[i + 1]! / 255, b = image.data[i + 2]! / 255;
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  const h = d === 0 ? 0 : ((v === r ? (g - b) / d : v === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  return { v, s: v ? d / v : 0, h };
}
function hueDistance(a: number, b: number) { return Math.min(Math.abs(a - b), 360 - Math.abs(a - b)); }

/** Find long contrasting frame lines, then verify both axes of a 10x20 grid. */
export function locateImageBoard(image: Raster): ImageBoard {
  const lines: { x: number; top: number; bottom: number }[] = [];
  const gapLimit = Math.max(3, Math.round(image.height / 250));
  for (let x = 0; x < image.width; x++) {
    let top = 0, last = -1;
    for (let y = 0; y <= image.height + gapLimit; y++) {
      // A continuous neutral background is not a frame. Require local contrast.
      // Only one side need be dark: HOLD borders and the meter can touch a frame.
      if (y < image.height && color(image, x, y).v > Math.min(
        color(image, x - 4, y).v, color(image, x + 4, y).v,
      ) + .015) {
        if (y - last > gapLimit + 1) top = y;
        last = y;
      } else if (y - last === gapLimit + 1 && last - top > image.height * .35) {
        if (!lines.some((line) => Math.abs(line.x - x) < 3 && Math.abs(line.bottom - last) < 5)) lines.push({ x, top, bottom: last });
      }
    }
  }
  const candidates: { board: ImageBoard; score: number }[] = [];
  for (const left of lines) for (const right of lines) {
    const width = right.x - left.x, cell = width / 10;
    if (cell < 10 || width < image.width * .18 || width > image.width * .8) continue;
    // Blocks can cover the bottom of Jstris's frame; anchor at the top instead.
    const y = Math.min(left.top, right.top);
    if (Math.abs(left.top - right.top) > cell * 1.3 || y + width * 2 > image.height + 3
      || Math.min(left.bottom, right.bottom) - y < width * 1.3) continue;
    let hits = 0, total = 0;
    for (let row = 1; row < 15; row++) for (let col = 1; col < 10; col++) {
      const cx = left.x + col * cell;
      const cy = y + row * cell;
      let edge = 0;
      for (let offset = -2; offset <= 2; offset++) {
        const c = color(image, cx + cell * .5, cy + offset);
        edge = Math.max(edge, c.v);
      }
      const middle = color(image, cx + cell * .5, cy + cell * .5);
      if (edge > middle.v + .009) hits++;
      total++;
      let verticalEdge = 0;
      for (let offset = -2; offset <= 2; offset++) {
        verticalEdge = Math.max(verticalEdge, color(image, cx + offset, cy + cell * .5).v);
      }
      if (verticalEdge > middle.v + .009) hits++;
      total++;
    }
    const score = hits / total;
    if (score > .62) candidates.push({ board: { x: left.x, y: Math.max(0, y), cell }, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) throw new Error("Could not locate a clear 10×20 grid. Include the complete board frame and visible grid.");
  if (candidates.some((c) => c.score > best.score - .06 && Math.abs(c.board.x - best.board.x) > best.board.cell)) {
    throw new Error("Multiple boards detected. Crop the screenshot to one player.");
  }
  return best.board;
}

interface TilePiece { piece: Piece; x: number; y: number; width: number; height: number; color: Color; cells: { x: number; y: number }[] }
function shapeKey(cells: { x: number; y: number }[]) {
  const minX = Math.min(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y));
  return cells.map(c => `${c.x - minX},${c.y - minY}`).sort().join(";");
}
const shapes = PIECES.flatMap(piece => ORIENTATIONS.map(orientation => ({
  piece, key: shapeKey(localCells(piece, orientation).map(c => ({ x: c.x, y: -c.y }))),
})));

/** Connected filled regions plus tetromino geometry, independent of skin RGB. */
function readPieces(image: Raster, rect: { x: number; y: number; width: number; height: number }, cell: number): TilePiece[] {
  const stride = Math.max(1, Math.floor(cell / 12));
  const width = Math.ceil(rect.width / stride), height = Math.ceil(rect.height / stride);
  if (width < 1 || height < 1) return [];
  // Bridge narrow bevel seams, but never the cell-sized gaps between previews.
  const joinRadius = Math.max(1, Math.round(cell * .09 / stride));
  const mask = new Uint8Array(width * height);
  const hues = new Float32Array(width * height);
  const chroma = new Float32Array(width * height);
  const seeds: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = color(image, rect.x + x * stride, rect.y + y * stride);
    mask[y * width + x] = c.s > .3 && c.v > .40 ? 1 : 0;
    hues[y * width + x] = c.h;
    chroma[y * width + x] = c.s * c.v;
    if (mask[y * width + x]) seeds.push(y * width + x);
  }
  // Start with the strongest color, not the first background pixel in a scan.
  // A same-hue sky must not flood into a brighter, more saturated tetromino.
  seeds.sort((a, b) => chroma[b]! - chroma[a]!);
  const result: TilePiece[] = [];
  for (const i of seeds) {
    if (!mask[i]) continue;
    const pending = [i]; mask[i] = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let n = 0; n < pending.length; n++) {
      const index = pending[n]!, x = index % width, y = Math.floor(index / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -joinRadius; dy <= joinRadius; dy++) for (let dx = -joinRadius; dx <= joinRadius; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[j]
          || hueDistance(hues[j]!, hues[i]!) > 22 || chroma[j]! < chroma[i]! * .5) continue;
        mask[j] = 0; pending.push(j);
      }
    }
    const w = (maxX - minX + 1) * stride, h = (maxY - minY + 1) * stride;
    const cols = Math.round(w / cell), rows = Math.round(h / cell);
    if (cols < 1 || cols > 4 || rows < 1 || rows > 4 || Math.abs(w / cell - cols) > .3 || Math.abs(h / cell - rows) > .3) continue;
    const cells: { x: number; y: number }[] = [], colors: Color[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const c = color(image, rect.x + minX * stride + (x + .5) * w / cols, rect.y + minY * stride + (y + .5) * h / rows);
      if (c.s > .3 && c.v > .4 && hueDistance(c.h, hues[i]!) < 22
        && c.s * c.v >= chroma[i]! * .5) {
        cells.push({ x, y }); colors.push(c);
      }
    }
    if (cells.length !== 4) continue;
    const match = shapes.find(shape => shape.key === shapeKey(cells));
    if (!match || colors.some(c => hueDistance(c.h, colors[0]!.h) > 22)) continue;
    const median = colors.sort((a,b) => a.v - b.v)[2]!;
    // Bevel highlights and darker tile faces may form separate components.
    // Merge only the same shape at the same position, not repeated NEXT pieces.
    if (result.some(p => p.piece === match.piece
      && Math.abs(p.x - (rect.x + minX * stride)) < cell * .3
      && Math.abs(p.y - (rect.y + minY * stride)) < cell * .3)) continue;
    result.push({ piece: match.piece, x: rect.x + minX * stride, y: rect.y + minY * stride, width: w, height: h, color: median, cells });
  }
  return result.sort((a,b) => a.y - b.y);
}

export function recognizeScreenshot(image: Raster): ScreenshotResult {
  if (image.width < 200 || image.height < 300 || image.width * image.height > 12_000_000) throw new Error("Use a clear screenshot between 200×300 and 12 megapixels.");
  const board = locateImageBoard(image), { x, y, cell } = board;
  const nextX = x + 10 * cell + cell * .45;
  const next = readPieces(image, { x: nextX, y, width: Math.min(image.width - nextX, cell * 6), height: cell * 16 }, cell);
  const leftX = Math.max(0, x - cell * 6);
  const hold = readPieces(image, { x: leftX, y, width: x - leftX - cell * .4, height: cell * 5 }, cell);
  const activeTop = Math.max(0, y - cell * 4);
  const active = readPieces(image, { x: x + cell, y: activeTop, width: cell * 8, height: y + cell * 5 - activeTop }, cell);
  if (next.length !== 5 || hold.length > 1 || active.length !== 1) throw new Error("Could not reliably read HOLD / active / five NEXT pieces. Include all three regions and capture the piece near spawn.");
  const refs = [...next, ...hold, ...active];
  const currentPose = active[0]!;
  const field = Array.from({ length: 6 }, () => Array<boolean>(10).fill(false));
  const uncertain: { col: number; row: number; color: Color }[] = [];
  for (let row = 0; row < 20; row++) for (let col = 0; col < 10; col++) {
    const samples: Color[] = [];
    for (const oy of [.35, .5, .65]) for (const ox of [.35, .5, .65]) samples.push(color(image, x + (col + ox) * cell, y + (row + oy) * cell));
    const c = samples.sort((a,b) => a.v - b.v)[4]!;
    if (c.v < .16 || c.s < .25 && c.v < .3) continue;
    const centerX = x + (col + .5) * cell, centerY = y + (row + .5) * cell;
    if (row < 5 && currentPose.cells.some(tile =>
      Math.abs(centerX - (currentPose.x + (tile.x + .5) * cell)) < cell * .4
      && Math.abs(centerY - (currentPose.y + (tile.y + .5) * cell)) < cell * .4)) continue;
    if (c.s < .25) throw new Error("Uncertain gray/garbage cell. This prototype supports colored stacks only.");
    const nearby = refs.filter(ref => hueDistance(ref.color.h, c.h) < 28);
    const reference = nearby.length ? Math.max(...nearby.map(ref => ref.color.v)) : Math.max(...refs.map(ref => ref.color.v));
    const ratio = c.v / reference;
    if (ratio < .55) continue; // Filled translucent or outline ghost.
    if (ratio < .7) { uncertain.push({ col, row, color: c }); continue; }
    if (row < 14) throw new Error("The settled stack exceeds the 6-row Solver limit.");
    field[19 - row]![col] = true;
  }
  // Gamma can brighten a filled ghost. Only accept borderline cells when they
  // agree with the active tetromino's exact landing on the confidently read stack.
  const activeCells = currentPose.cells.map(tile => ({
    col: Math.round((currentPose.x - x) / cell) + tile.x,
    row: Math.round((currentPose.y - y) / cell) + tile.y,
  }));
  let drop = 0;
  while (drop < 24 && activeCells.every(tile => {
    const row = tile.row + drop + 1;
    return row < 20 && !field[19 - row]?.[tile.col];
  })) drop++;
  if (uncertain.some(tile => hueDistance(tile.color.h, currentPose.color.h) > 28
    || !activeCells.some(activeTile => activeTile.col === tile.col && activeTile.row + drop === tile.row))) {
    throw new Error("A dim cell could be a block or a ghost. Adjust the screenshot or enter this field manually.");
  }
  if (field.flat().filter(Boolean).length % 4 !== 0 || field.some(row => row.every(Boolean))) {
    throw new Error("The detected field is inconsistent with a settled PC field. Capture after the line-clear animation.");
  }
  const current = active[0]!.piece, held = hold[0]?.piece ?? null;
  return { board, field, active: current, hold: held, next: next.map(p => p.piece), queue: `${held ?? ""}${current}${next.map(p => p.piece).join("")}` };
}
