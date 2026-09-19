import { localCells, sortedCellKey, spawnPiece } from "../engine/pieces";
import { BOARD_WIDTH, ORIENTATIONS, type Board, type Cell, type Piece } from "../engine/types";
import { kickCandidates, nextOrientation } from "../rules/rotation";
import type { TargetPlacement } from "./schema";

// Compile the game's geometry and ordered kicks, not a second physics definition.
function compilePiece(piece: Piece) {
  return ORIENTATIONS.map((orientation) => {
    const cells = localCells(piece, orientation);
    return {
      cells,
      minX: Math.min(...cells.map((cell) => cell.x)),
      minY: Math.min(...cells.map((cell) => cell.y)),
      rotations: (["CW", "CCW", "R180"] as const).map((direction) => {
        const to = nextOrientation(orientation, direction);
        return { to: ORIENTATIONS.indexOf(to), kicks: kickCandidates(piece, orientation, to) };
      }),
    };
  });
}

const pieces = new Map<Piece, ReturnType<typeof compilePiece>>();
const PADDING = 2;
const STRIDE = BOARD_WIDTH + PADDING * 2;

/** Colors do not affect collision. Height remains part of this occupancy identity. */
export function occupancyKey(board: Board): string {
  return board.map((row) => {
    let bits = 0;
    for (let x = 0; x < BOARD_WIDTH; x++) if (row[x] !== null) bits |= 1 << x;
    return bits.toString(36);
  }).join(".");
}

/**
 * Lazy forward reachability from the actual game spawn. One graph serves every
 * target on this occupancy/piece pair. A step is atomic so cancelled/cooperative
 * searches may safely leave a partially explored graph for a later target.
 */
export class PlacementSearch {
  private readonly geometry: ReturnType<typeof compilePiece>;
  private readonly rows: Uint16Array;
  private readonly plane: number;
  private readonly visited: Uint8Array;
  private readonly legality: Uint8Array;
  private readonly pending: Int32Array;
  private head = 0;
  private tail = 0;

  constructor(board: Board, piece: Piece) {
    let geometry = pieces.get(piece);
    if (!geometry) {
      geometry = compilePiece(piece);
      pieces.set(piece, geometry);
    }
    this.geometry = geometry;
    // Snapshot occupancy: callers may subsequently mutate their input board.
    this.rows = new Uint16Array(board.length);
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (board[y][x] !== null) this.rows[y] |= 1 << x;
      }
    }
    this.plane = STRIDE * (board.length + PADDING * 2);
    this.visited = new Uint8Array(this.plane * 4);
    this.legality = new Uint8Array(this.plane * 4);
    this.pending = new Int32Array(this.plane * 4);
    const spawn = spawnPiece(piece, board.length);
    this.enqueue(this.id(spawn.x, spawn.y, ORIENTATIONS.indexOf(spawn.orientation)));
  }

  private id(x: number, y: number, orientation: number): number {
    if (x < -PADDING || x >= BOARD_WIDTH + PADDING || y < -PADDING || y >= this.rows.length + PADDING) return -1;
    return orientation * this.plane + (y + PADDING) * STRIDE + x + PADDING;
  }

  private legal(id: number): boolean {
    if (id < 0 || id >= this.legality.length) return false;
    const cached = this.legality[id];
    if (cached) return cached === 1;
    const orientation = Math.floor(id / this.plane);
    const position = id % this.plane;
    const x = position % STRIDE - PADDING;
    const y = Math.floor(position / STRIDE) - PADDING;
    for (const cell of this.geometry[orientation].cells) {
      const cx = x + cell.x;
      const cy = y + cell.y;
      if (cx < 0 || cx >= BOARD_WIDTH || cy < 0 || cy >= this.rows.length || (this.rows[cy] & (1 << cx))) {
        this.legality[id] = 2;
        return false;
      }
    }
    this.legality[id] = 1;
    return true;
  }

  private enqueue(id: number): void {
    if (!this.legal(id) || this.visited[id]) return;
    this.visited[id] = 1;
    this.pending[this.tail++] = id;
  }

  /** Exact cells are authoritative; optional origin/orientation metadata is not. */
  targets(target: TargetPlacement): number[] {
    if (target.cells.length !== 4) return [];
    const key = sortedCellKey(target.cells);
    const minX = Math.min(...target.cells.map((cell) => cell.x));
    const minY = Math.min(...target.cells.map((cell) => cell.y));
    const result: number[] = [];
    for (let o = 0; o < 4; o++) {
      const geometry = this.geometry[o];
      const x = minX - geometry.minX;
      const y = minY - geometry.minY;
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      const cells: Cell[] = geometry.cells.map((cell) => ({ x: x + cell.x, y: y + cell.y }));
      if (sortedCellKey(cells) !== key) continue;
      const id = this.id(x, y, o);
      if (this.legal(id) && !this.legal(this.id(x, y - 1, o))) result.push(id);
    }
    return result;
  }

  reached(targets: readonly number[]): boolean {
    return targets.some((id) => this.visited[id] !== 0);
  }

  get exhausted(): boolean { return this.head === this.tail; }

  step(): void {
    if (this.exhausted) return;
    const id = this.pending[this.head++];
    const orientation = Math.floor(id / this.plane);
    const position = id % this.plane;
    const x = position % STRIDE - PADDING;
    const y = Math.floor(position / STRIDE) - PADDING;
    this.enqueue(this.id(x - 1, y, orientation));
    this.enqueue(this.id(x + 1, y, orientation));
    this.enqueue(this.id(x, y - 1, orientation));
    for (const rotation of this.geometry[orientation].rotations) {
      for (const kick of rotation.kicks) {
        const candidate = this.id(x + kick.dx, y + kick.dy, rotation.to);
        if (!this.legal(candidate)) continue;
        this.enqueue(candidate);
        // First legal kick wins, even if that pose was already visited.
        break;
      }
    }
  }
}

// Query-scoped, bounded retention. No persistent cache of catalog/policy results.
const searches = new WeakMap<Map<string, boolean>, Map<string, PlacementSearch>>();
const MAX_SEARCHES = 128;

export function sharedPlacementSearch(
  board: Board, piece: Piece, cache?: Map<string, boolean>, key?: string,
): PlacementSearch {
  if (!cache) return new PlacementSearch(board, piece);
  let scope = searches.get(cache);
  if (!scope) {
    scope = new Map();
    searches.set(cache, scope);
  }
  const identity = key ?? `${occupancyKey(board)}|${piece}`;
  const previous = scope.get(identity);
  if (previous) return previous;
  const search = new PlacementSearch(board, piece);
  if (scope.size >= MAX_SEARCHES) scope.delete(scope.keys().next().value!);
  scope.set(identity, search);
  return search;
}
