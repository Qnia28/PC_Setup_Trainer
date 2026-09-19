import { boardHash, placeCells } from "../engine/board";
import { sortedCellKey } from "../engine/pieces";
import type { Board, Orientation, Piece } from "../engine/types";
import { occupancyKey, sharedPlacementSearch } from "./placementSearch";
import type { SetupVariant, TargetPlacement } from "./schema";

export interface BuildStep {
  action: "place" | "hold";
  piece: Piece;
  placementId?: string;
  /**
   * `placeableNextCount` 뒤에 제공된 미노로 hold를 해제한 경우에만 붙는다.
   * 이 미노는 셋업 geometry에 배치할 수 없는 다음 가방 버퍼이므로, 전수조사
   * 결과를 직렬화할 때 실제 T 미노와 구분해 표시해야 한다.
   */
  source?: "visible" | "synthetic-next-bag-buffer";
}

export interface BuildPlan {
  steps: BuildStep[];
  holds: number;
}

export type ReachabilityCache = Map<string, boolean>;

/**
 * Called for every expanded BFS node. Implementations should return a Promise
 * only when the search needs to yield; the hot path stays synchronous between
 * slice boundaries.
 */
export interface CooperativeSearchControl {
  onNode(): Promise<void> | void;
}

interface SearchState {
  board: Board;
  active: Piece;
  activePlaceable: boolean;
  hold: Piece | null;
  holdPlaceable: boolean | null;
  queueIndex: number;
  remaining: TargetPlacement[];
  plan: BuildStep[];
  holds: number;
  /**
   * Canonical-search marker, not a game restriction. With occupied HOLD, a
   * second consecutive HOLD returns to the same state. With empty HOLD, the
   * two-HOLD-then-place path reaches the same post-place state as
   * place-then-HOLD. Skipping that dominated ordering preserves every
   * placement plan while the runtime itself remains unlimited-HOLD.
   */
  heldSincePlacement: boolean;
}

export function canReachPlacement(board: Board, piece: Piece, target: TargetPlacement): boolean {
  return searchPlacement(board, piece, target);
}

function searchPlacement(
  board: Board, piece: Piece, target: TargetPlacement, cache?: ReachabilityCache,
): boolean {
  const identity = `${occupancyKey(board)}|${piece}`;
  const key = `${identity}|${sortedCellKey(target.cells)}`;
  const cached = cache?.get(key);
  if (cached !== undefined) return cached;
  const search = sharedPlacementSearch(board, piece, cache, identity);
  const targets = search.targets(target);
  while (targets.length && !search.reached(targets) && !search.exhausted) search.step();
  const reachable = search.reached(targets);
  cache?.set(key, reachable);
  return reachable;
}

function canReachPlacementCached(
  board: Board, piece: Piece, target: TargetPlacement, cache?: ReachabilityCache,
): boolean {
  return searchPlacement(board, piece, target, cache);
}

async function canReachPlacementCachedCooperative(
  board: Board,
  piece: Piece,
  target: TargetPlacement,
  cache: ReachabilityCache | undefined,
  control: CooperativeSearchControl,
): Promise<boolean> {
  const identity = `${occupancyKey(board)}|${piece}`;
  const key = `${identity}|${sortedCellKey(target.cells)}`;
  const cached = cache?.get(key);
  if (cached !== undefined) return cached;
  const search = sharedPlacementSearch(board, piece, cache, identity);
  const targets = search.targets(target);
  while (targets.length && !search.reached(targets) && !search.exhausted) {
    const pause = control.onNode();
    if (pause) await pause;
    search.step();
  }
  const reachable = search.reached(targets);
  cache?.set(key, reachable);
  return reachable;
}

function remainingKey(remaining: TargetPlacement[]): string {
  return remaining.map(({ id }) => id).sort().join(",");
}

function afterUnlimitedHold(state: SearchState, next: Piece[], placeableNextCount: number): SearchState | null {
  if (state.heldSincePlacement) return null;
  const holdStep: BuildStep = {
    action: "hold",
    piece: state.active,
    source: state.activePlaceable ? "visible" : "synthetic-next-bag-buffer",
  };
  if (state.hold === null) {
    const nextPiece = next[state.queueIndex];
    if (!nextPiece) return null;
    return {
      ...state,
      active: nextPiece,
      activePlaceable: state.queueIndex < placeableNextCount,
      hold: state.active,
      holdPlaceable: state.activePlaceable,
      queueIndex: state.queueIndex + 1,
      plan: [...state.plan, holdStep],
      holds: state.holds + 1,
      heldSincePlacement: true,
    };
  }
  return {
    ...state,
    active: state.hold,
    activePlaceable: state.holdPlaceable ?? false,
    hold: state.active,
    holdPlaceable: state.activePlaceable,
    plan: [...state.plan, holdStep],
    holds: state.holds + 1,
    heldSincePlacement: true,
  };
}

export function findBuildPlan(
  setup: SetupVariant,
  board: Board,
  active: Piece,
  hold: Piece | null,
  next: Piece[],
  _holdAvailable = true,
  placeableNextCount = next.length,
  reachabilityCache?: ReachabilityCache,
): BuildPlan | null {
  const pending: SearchState[] = [{
    board: board.map((row) => [...row]), active, activePlaceable: true,
    hold, holdPlaceable: hold === null ? null : true, queueIndex: 0,
    remaining: setup.placements, plan: [], holds: 0, heldSincePlacement: false,
  }];
  let pendingIndex = 0;
  const visited = new Set<string>();
  while (pendingIndex < pending.length) {
    const state = pending[pendingIndex++]!;
    const key = [
      boardHash(state.board),
      state.active,
      state.activePlaceable,
      state.hold ?? "-",
      state.holdPlaceable ?? "-",
      state.queueIndex,
      remainingKey(state.remaining),
      state.heldSincePlacement,
    ].join("|");
    if (visited.has(key)) continue;
    visited.add(key);

    for (const placement of state.activePlaceable
      ? state.remaining.filter(({ piece }) => piece === state.active)
      : []) {
      if (!canReachPlacementCached(state.board, state.active, placement, reachabilityCache)) continue;
      const remaining = state.remaining.filter(({ id }) => id !== placement.id);
      const plan = [...state.plan, { action: "place" as const, piece: state.active, placementId: placement.id }];
      if (remaining.length === 0) return { steps: plan, holds: state.holds };
      const nextPiece = next[state.queueIndex];
      if (!nextPiece) continue;
      pending.push({
        ...state,
        board: placeCells(state.board, placement.cells, placement.piece),
        active: nextPiece,
        activePlaceable: state.queueIndex < placeableNextCount,
        queueIndex: state.queueIndex + 1,
        remaining,
        plan,
        heldSincePlacement: false,
      });
    }

    const held = afterUnlimitedHold(state, next, placeableNextCount);
    if (held) pending.push(held);
  }
  return null;
}

/** Same search as findBuildPlan, with bounded event-loop yield points. */
export async function findBuildPlanCooperative(
  setup: SetupVariant,
  board: Board,
  active: Piece,
  hold: Piece | null,
  next: Piece[],
  _holdAvailable = true,
  placeableNextCount = next.length,
  reachabilityCache: ReachabilityCache | undefined,
  control: CooperativeSearchControl,
): Promise<BuildPlan | null> {
  const pending: SearchState[] = [{
    board: board.map((row) => [...row]), active, activePlaceable: true,
    hold, holdPlaceable: hold === null ? null : true, queueIndex: 0,
    remaining: setup.placements, plan: [], holds: 0, heldSincePlacement: false,
  }];
  let pendingIndex = 0;
  const visited = new Set<string>();
  while (pendingIndex < pending.length) {
    const pause = control.onNode();
    if (pause) await pause;
    const state = pending[pendingIndex++]!;
    const key = [
      boardHash(state.board),
      state.active,
      state.activePlaceable,
      state.hold ?? "-",
      state.holdPlaceable ?? "-",
      state.queueIndex,
      remainingKey(state.remaining),
      state.heldSincePlacement,
    ].join("|");
    if (visited.has(key)) continue;
    visited.add(key);

    for (const placement of state.activePlaceable
      ? state.remaining.filter(({ piece: targetPiece }) => targetPiece === state.active)
      : []) {
      if (!await canReachPlacementCachedCooperative(state.board, state.active, placement, reachabilityCache, control)) continue;
      const remaining = state.remaining.filter(({ id }) => id !== placement.id);
      const plan = [...state.plan, { action: "place" as const, piece: state.active, placementId: placement.id }];
      if (remaining.length === 0) return { steps: plan, holds: state.holds };
      const nextPiece = next[state.queueIndex];
      if (!nextPiece) continue;
      pending.push({
        ...state,
        board: placeCells(state.board, placement.cells, placement.piece),
        active: nextPiece,
        activePlaceable: state.queueIndex < placeableNextCount,
        queueIndex: state.queueIndex + 1,
        remaining,
        plan,
        heldSincePlacement: false,
      });
    }

    const held = afterUnlimitedHold(state, next, placeableNextCount);
    if (held) pending.push(held);
  }
  return null;
}

export function inferPlacementState(target: TargetPlacement): { orientation: Orientation; x: number; y: number } | null {
  if (target.orientation && target.origin) return { orientation: target.orientation, ...target.origin };
  return null;
}
