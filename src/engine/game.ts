import { collides, createBoard, hardDropY } from "./board";
import { spawnPiece } from "./pieces";
import { createBagState, drawPiece, ensureQueue } from "./randomizer";
import { BOARD_HEIGHT, type ActivePiece, type GameAction, type GameState, type Piece, type RotationDirection } from "./types";
import { parseQueueJumpInput, type QueueJumpTarget } from "../rules/queueJump";
import { tryRotate } from "../rules/rotation";
import { applyUnlimitedHold, copyGameState, lockGameState, placementEventFromStates, type PlacementTransitionOptions } from "./placement";
import { PlacementHistory } from "./placementHistory";
import { assertValidSeed } from "./seed";

function initialSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createGameState(seed = initialSeed(), boardHeight = BOARD_HEIGHT): GameState {
  const first = drawPiece(createBagState(seed));
  return {
    board: createBoard(boardHeight),
    active: spawnPiece(first.piece, boardHeight),
    hold: null,
    holdUsedThisTurn: false,
    bag: ensureQueue(first.bag, 7),
    run: {
      cycle: 1,
      pcCount: 0,
      piecesLockedSinceLastPc: 0,
      linesSinceLastPc: 0,
      status: "playing",
      message: "Begin Cycle 1 setup.",
    },
    seed,
  };
}

function move(state: GameState, dx: number, dy: number): GameState {
  const candidate = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
  return collides(state.board, candidate) ? state : { ...state, active: candidate };
}

function rotate(state: GameState, direction: RotationDirection): GameState {
  const active = tryRotate(state.board, state.active, direction);
  return active === state.active ? state : { ...state, active };
}

export class GameSession {
  state: GameState;
  readonly placementHistory: PlacementHistory;
  private readonly fixedInitial: GameState | null;
  private readonly transitionOptions: PlacementTransitionOptions;

  constructor(seedOrInitial?: string | GameState, private readonly boardHeight = BOARD_HEIGHT) {
    this.fixedInitial = typeof seedOrInitial === "object" ? copyGameState(seedOrInitial) : null;
    this.transitionOptions = this.fixedInitial ? { refillBag: false, spawnAfterTerminal: false } : {};
    this.state = this.fixedInitial
      ? copyGameState(this.fixedInitial)
      : createGameState(typeof seedOrInitial === "string" ? seedOrInitial : undefined, boardHeight);
    this.placementHistory = new PlacementHistory(this.state);
  }

  dispatch(action: GameAction): boolean {
    if (action === "restart") {
      this.restart();
      return true;
    }
    if (action === "randomSeed") {
      this.restart(this.state.seed);
      return true;
    }
    if (action === "undo") return this.undo();
    if (this.state.run.status !== "playing") return false;
    const before = this.state;
    if (action === "moveLeft") this.state = move(this.state, -1, 0);
    if (action === "moveRight") this.state = move(this.state, 1, 0);
    if (action === "stepDown") this.state = move(this.state, 0, -1);
    if (action === "softDrop") this.state = move(this.state, 0, -1);
    if (action === "rotateCW") this.state = rotate(this.state, "CW");
    if (action === "rotateCCW") this.state = rotate(this.state, "CCW");
    if (action === "rotate180") this.state = rotate(this.state, "R180");
    if (action === "hold") this.state = applyUnlimitedHold(this.state, this.transitionOptions);
    if (action === "hardDrop") {
      const before = this.state;
      const event = placementEventFromStates(this.placementHistory.turnStartState(), before, this.transitionOptions);
      this.state = lockGameState({ ...before, active: { ...before.active, y: event.y } }, this.transitionOptions);
      this.placementHistory.record(event, before, this.state);
    }
    return this.state !== before || action === "hardDrop";
  }

  undo(): boolean {
    const previous = this.placementHistory.undo();
    if (!previous) return false;
    this.state = previous;
    return true;
  }

  restart(seed = initialSeed()): void {
    this.state = this.fixedInitial ? copyGameState(this.fixedInitial) : createGameState(seed, this.boardHeight);
    this.placementHistory.reset(this.state);
  }

  setSeed(seed: string): void {
    const normalized = seed.trim();
    if (normalized) assertValidSeed(normalized);
    this.restart(normalized || initialSeed());
  }

  jumpToQueue(input: string): QueueJumpTarget {
    const target = parseQueueJumpInput(input);
    const generated = ensureQueue(createBagState(`${this.state.seed}:queue-jump:${target.normalized}`), 14);
    let hold: Piece | null;
    let activePiece: Piece;
    let currentBagTail: Piece[];

    if (target.pieces.length === 7) {
      hold = null;
      activePiece = target.pieces[0];
      currentBagTail = target.pieces.slice(1);
    } else if (target.pieces.length === 1) {
      hold = target.pieces[0];
      activePiece = generated.queue[0];
      currentBagTail = [];
      generated.queue = generated.queue.slice(1);
    } else {
      hold = target.pieces[0];
      activePiece = target.pieces[1];
      currentBagTail = target.pieces.slice(2);
    }

    this.state = {
      board: createBoard(this.boardHeight),
      active: spawnPiece(activePiece, this.boardHeight),
      hold,
      holdUsedThisTurn: false,
      bag: { ...generated, queue: [...currentBagTail, ...generated.queue] },
      run: {
        cycle: target.cycle,
        pcCount: target.cycle - 1,
        piecesLockedSinceLastPc: 0,
        linesSinceLastPc: 0,
        status: "playing",
        message: `Queue ${target.normalized} loaded for Cycle ${target.cycle}.`,
      },
      seed: this.state.seed,
    };
    this.placementHistory.reset(this.state);
    return target;
  }

  debugSetQueue(active: Piece, next: Piece[], holdPiece: Piece | null = null): void {
    this.state = {
      ...this.state,
      active: spawnPiece(active, this.state.board.length),
      hold: holdPiece,
      bag: { ...this.state.bag, queue: [...next, ...this.state.bag.queue] },
    };
    this.placementHistory.reset(this.state);
  }
}

export function ghostPiece(state: GameState): ActivePiece {
  return { ...state.active, y: hardDropY(state.board, state.active) };
}
