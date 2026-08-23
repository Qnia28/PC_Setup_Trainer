import { decoder, encoder, Field } from "tetris-fumen";
import { BOARD_WIDTH, PIECES, type Board, type Cycle, type Piece } from "../engine/types";
import type { SetupVariant, TargetPlacement } from "../setups/schema";
import { SolverWorkerClient, viteWorkerFactory } from "./workerClient";

export const LIVE_SOLVE_SAVE_ORDER = [..."TILJOSZ"] as Piece[];
const PORT_PAGE_ORDER = [..."TILJSZO"] as Piece[];

export type LiveSolveKind = "per-save-minimals" | "solve-one";

export interface LiveSolveRequest {
  kind: LiveSolveKind;
  input: {
    sourceFumen: string;
    pattern: string;
    targetLines: 2 | 3 | 4;
    useHold: true;
  };
}

export interface PerSavePieceResult {
  piece: Piece;
  minimalCount: number;
  label: string;
}

export interface PerSaveMinimalsResult {
  results: Record<Piece, PerSavePieceResult>;
  pageCounts: Record<Piece, number>;
  fumen: string;
}

export interface SolveOneResult {
  solutionCount: number;
  fumen: string | null;
}

export interface LiveSolveOption {
  save: Piece | null;
  label: string;
  shadow: SetupVariant;
}

export function formatAvailableSaves(options: readonly { save: Piece | null }[]): string | null {
  const saves = options.flatMap(({ save }) => save === null ? [] : [`Save ${save}`]);
  return saves.length > 0 ? `Available: ${saves.join(", ")}` : null;
}

export interface LiveSolveRequestContext {
  board: Board;
  active: Piece;
  hold: Piece | null;
  next: readonly Piece[];
  piecesLockedSinceLastPc: number;
  linesSinceLastPc: number;
}

export type LiveSolvePreparation =
  | { ready: true; request: LiveSolveRequest }
  | { ready: false; reason: string };

function encodeCurrentBoard(board: Board): string {
  const field = Field.create();
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      const cell = board[y]?.[x];
      if (cell) field.set(x, y, cell);
    }
  }
  return encoder.encode([{ field, flags: { colorize: true } }]);
}

function visibleQueue(context: Pick<LiveSolveRequestContext, "active" | "hold" | "next">): Piece[] {
  return context.hold === null
    ? [context.active, ...context.next.slice(0, 5)]
    : [context.hold, context.active, ...context.next.slice(0, 5)];
}

export function prepareLiveSolveRequest(context: LiveSolveRequestContext): LiveSolvePreparation {
  if (context.piecesLockedSinceLastPc < 3) {
    return { ready: false, reason: "Place at least 3 pieces before calculating a solve." };
  }
  const targetLines = 4 - context.linesSinceLastPc;
  if (targetLines < 2 || targetLines > 4) {
    return { ready: false, reason: "The integrated solver supports 2–4 remaining lines." };
  }
  if (context.board.slice(targetLines).some((row) => row.some((cell) => cell !== null))) {
    return { ready: false, reason: `The current stack exceeds the ${targetLines}-line target.` };
  }
  const occupiedCells = context.board.slice(0, targetLines)
    .reduce((count, row) => count + row.filter((cell) => cell !== null).length, 0);
  const remainingCells = targetLines * BOARD_WIDTH - occupiedCells;
  if (remainingCells <= 0 || remainingCells % 4 !== 0) {
    return { ready: false, reason: "The current post-clear board is not compatible with a PC target." };
  }
  const piecesNeeded = remainingCells / 4;
  const kind: LiveSolveKind = context.piecesLockedSinceLastPc === 3 ? "solve-one" : "per-save-minimals";
  const queueLength = kind === "solve-one" ? piecesNeeded : piecesNeeded + 1;
  const queue = visibleQueue(context);
  if (queue.length < queueLength) {
    return { ready: false, reason: `Solve requires see${queueLength}, but only see${queue.length} is available.` };
  }
  return {
    ready: true,
    request: {
      kind,
      input: {
        sourceFumen: encodeCurrentBoard(context.board),
        pattern: queue.slice(0, queueLength).join(""),
        targetLines: targetLines as 2 | 3 | 4,
        useHold: true,
      },
    },
  };
}

function shadowFromPage(page: ReturnType<typeof decoder.decode>[number], cycle: Cycle, id: string, label: string): SetupVariant | null {
  const cells = new Map<Piece, { x: number; y: number }[]>();
  for (const piece of PIECES) cells.set(piece, []);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      const value = page.field.at(x, y);
      if (PIECES.includes(value as Piece)) cells.get(value as Piece)!.push({ x, y });
    }
  }
  const placements: TargetPlacement[] = [];
  const pieceSignature: Piece[] = [];
  for (const piece of PIECES) {
    const pieceCells = cells.get(piece)!;
    if (pieceCells.length === 0) continue;
    placements.push({ id: `${id}-${piece}`, piece, cells: pieceCells });
    for (let count = 0; count < pieceCells.length; count += 4) pieceSignature.push(piece);
  }
  if (placements.length === 0) return null;
  return {
    id,
    cycle,
    family: "live-solver",
    displayName: label,
    geometryKind: "solution-shadow",
    pieceSignature,
    placements,
    difficulty: 1,
    reviewStatus: "reviewed",
  };
}

export function perSaveOptions(result: PerSaveMinimalsResult, cycle: Cycle): LiveSolveOption[] {
  const pages = decoder.decode(result.fumen);
  const firstPage = new Map<Piece, (typeof pages)[number]>();
  for (const page of pages.slice(1)) {
    const match = page.comment.match(/Save ([TILJOSZ])/);
    if (match) firstPage.set(match[1] as Piece, firstPage.get(match[1] as Piece) ?? page);
  }
  let cursor = 1;
  for (const piece of PORT_PAGE_ORDER) {
    const count = result.pageCounts[piece] ?? 0;
    if (count > 0 && !firstPage.has(piece) && pages[cursor]) firstPage.set(piece, pages[cursor]);
    cursor += count;
  }
  return LIVE_SOLVE_SAVE_ORDER.flatMap((piece) => {
    if ((result.results[piece]?.minimalCount ?? 0) <= 0) return [];
    const page = firstPage.get(piece);
    if (!page) return [];
    const shadow = shadowFromPage(page, cycle, `live-save-${piece}`, `Save ${piece}`);
    return shadow ? [{ save: piece, label: `Save ${piece}`, shadow }] : [];
  });
}

export function solveOneOptions(result: SolveOneResult, cycle: Cycle): LiveSolveOption[] {
  if (!result.fumen || result.solutionCount <= 0) return [];
  const page = decoder.decode(result.fumen)[1];
  if (!page) return [];
  const shadow = shadowFromPage(page, cycle, "live-solution", "Solution");
  return shadow ? [{ save: null, label: "Solution", shadow }] : [];
}

export class LiveSolverClient {
  private client: SolverWorkerClient | null = null;

  private ensureClient(): SolverWorkerClient {
    this.client ??= new SolverWorkerClient(viteWorkerFactory);
    return this.client;
  }

  request<T>(request: LiveSolveRequest): Promise<T> {
    return this.ensureClient().request<T>(request.kind, request.input);
  }

  cancel(): void {
    this.client?.cancel();
  }

  dispose(): void {
    this.client?.dispose();
    this.client = null;
  }
}
