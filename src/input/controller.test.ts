import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameSession } from "../engine/game";
import { occupiedCells } from "../engine/pieces";
import { hardDropY } from "../engine/board";
import type { GameAction } from "../engine/types";
import { InputController } from "./controller";
import { DEFAULT_SETTINGS, SDF_INFINITE, type InputSettings } from "./settings";

type InputListener = (event: KeyboardEvent) => void;

class FakeWindow {
  private listeners = new Map<string, Set<InputListener>>();

  addEventListener(type: string, listener: InputListener): void {
    const listeners = this.listeners.get(type) ?? new Set<InputListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: InputListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "keydown" | "keyup", code: string, modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {}): void {
    const event = {
      code,
      repeat: false,
      target: null,
      ctrlKey: modifiers.ctrlKey ?? false,
      altKey: modifiers.altKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("InputController initial actions and DAS preservation", () => {
  let fakeWindow: FakeWindow;
  let frame: FrameRequestCallback | null;
  let now: number;

  beforeEach(() => {
    fakeWindow = new FakeWindow();
    frame = null;
    now = 0;
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeWindow);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function advanceTo(time: number): void {
    now = time;
    const callback = frame;
    if (!callback) throw new Error("animation frame이 예약되지 않았습니다.");
    callback(time);
  }

  function createController(session: GameSession, overrides: Partial<InputSettings> = {}): InputController {
    const settings: InputSettings = {
      ...DEFAULT_SETTINGS,
      ...overrides,
      bindings: { ...DEFAULT_SETTINGS.bindings, ...overrides.bindings },
    };
    return new InputController((action: GameAction) => session.dispatch(action), settings);
  }

  it("SDF infinite는 키를 누르는 즉시 미노를 바닥까지 내리되 고정하지 않는다", () => {
    const session = new GameSession("infinite-sdf");
    const controller = createController(session, { sdf: SDF_INFINITE });
    const piece = session.state.active.piece;

    fakeWindow.emit("keydown", "ArrowDown");

    expect(session.state.active.piece).toBe(piece);
    expect(session.state.active.y).toBe(hardDropY(session.state.board, session.state.active));
    expect(session.state.run.piecesLockedSinceLastPc).toBe(0);
    controller.destroy();
  });

  it("벽에 닿은 ARR 0 DAS를 다음 미노까지 보존한다", () => {
    const session = new GameSession("das-preservation");
    const controller = createController(session, { das: 100, arr: 0 });

    fakeWindow.emit("keydown", "ArrowRight");
    advanceTo(100);
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(9);

    now = 120;
    fakeWindow.emit("keydown", "Space");
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(9);

    controller.destroy();
  });

  it("스폰 사이에도 충전 시간을 이어서 forward pipelining한다", () => {
    const session = new GameSession("das-pipelining");
    const controller = createController(session, { das: 100, arr: 0 });

    fakeWindow.emit("keydown", "ArrowRight");
    now = 50;
    fakeWindow.emit("keydown", "Space");
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBeLessThan(9);

    advanceTo(100);
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(9);

    controller.destroy();
  });

  it("홀드로 바뀐 새 미노에도 충전된 DAS를 적용한다", () => {
    const session = new GameSession("das-after-hold");
    const controller = createController(session, { das: 100, arr: 0 });

    fakeWindow.emit("keydown", "ArrowRight");
    advanceTo(100);
    now = 120;
    fakeWindow.emit("keydown", "KeyC");
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(9);

    controller.destroy();
  });

  it("방향키 직후 홀드해도 새 미노의 최초 방향 입력을 보존한다", () => {
    const session = new GameSession("direction-with-hold");
    const controller = createController(session, { das: 100, arr: 0 });

    fakeWindow.emit("keydown", "ArrowRight");
    const heldPiece = session.state.active.piece;
    now = 10;
    fakeWindow.emit("keydown", "KeyC");

    expect(session.state.hold).toBe(heldPiece);
    expect(session.state.active.x).toBe(5);

    controller.destroy();
  });

  it("반대 방향이 DAS를 중단해도 먼저 누른 방향의 charge를 유지한다", () => {
    const session = new GameSession("das-interruption");
    const controller = createController(session, { das: 100, arr: 0 });

    fakeWindow.emit("keydown", "ArrowRight");
    advanceTo(100);
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(9);

    now = 110;
    fakeWindow.emit("keydown", "ArrowLeft");
    advanceTo(210);
    expect(Math.min(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(0);

    now = 220;
    fakeWindow.emit("keyup", "ArrowLeft");
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(9);

    controller.destroy();
  });

  it("DAS로 벽에 붙인 뒤 반대 방향을 탭하면 정확히 한 칸 tapback한다", () => {
    const session = new GameSession("finesse-tapback");
    session.debugSetQueue("T", ["I", "J", "L", "O", "S", "Z"]);
    const controller = createController(session, { das: 100, arr: 0 });

    fakeWindow.emit("keydown", "ArrowRight");
    advanceTo(100);
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(9);

    now = 110;
    fakeWindow.emit("keyup", "ArrowRight");
    fakeWindow.emit("keydown", "ArrowLeft");
    expect(Math.max(...occupiedCells(session.state.active).map(({ x }) => x))).toBe(8);

    controller.destroy();
  });

  it("180도 키 한 번으로 반대 회전 상태에 도달한다", () => {
    const session = new GameSession("finesse-180");
    session.debugSetQueue("T", ["I", "J", "L", "O", "S", "Z"]);
    const controller = createController(session);

    fakeWindow.emit("keydown", "KeyA");
    expect(session.state.active.orientation).toBe("S");

    controller.destroy();
  });

  it("스폰 시 IHS 후 IRS를 적용한다", () => {
    const session = new GameSession("ihs-irs");
    const controller = createController(session);
    const initiallyHeldPiece = session.state.active.piece;

    fakeWindow.emit("keydown", "KeyC");
    fakeWindow.emit("keydown", "ArrowUp");
    now = 20;
    fakeWindow.emit("keydown", "Space");

    expect(session.state.active.piece).toBe(initiallyHeldPiece);
    expect(session.state.active.orientation).toBe("E");

    controller.destroy();
  });

  it("Shift를 홀드로 사용 중이어도 이동과 회전 기본키를 처리한다", () => {
    const session = new GameSession("modifier-hold");
    const controller = createController(session, {
      bindings: { ...DEFAULT_SETTINGS.bindings, hold: "ShiftLeft" },
    });

    fakeWindow.emit("keydown", "ShiftLeft", { shiftKey: true });
    const spawnX = session.state.active.x;
    fakeWindow.emit("keydown", "ArrowRight", { shiftKey: true });
    expect(session.state.active.x).toBe(spawnX + 1);

    fakeWindow.emit("keydown", "ArrowUp", { shiftKey: true });
    expect(session.state.active.orientation).toBe("E");

    controller.destroy();
  });

  it("F4로 현재 시드를 유지하며 재시작한다", () => {
    const session = new GameSession("shortcut-seed");
    const controller = createController(session);
    fakeWindow.emit("keydown", "Space");

    fakeWindow.emit("keydown", "F4");
    expect(session.state.seed).toBe("shortcut-seed");
    expect(session.state.run.pcCount).toBe(0);

    controller.destroy();
  });

  it("한 칸 내리기 키를 누르고 있어도 최초 한 칸만 내린다", () => {
    const session = new GameSession("single-cell-drop-input");
    const controller = createController(session);
    const beforeY = session.state.active.y;

    fakeWindow.emit("keydown", "KeyS");
    expect(session.state.active.y).toBe(beforeY - 1);

    advanceTo(1000);
    expect(session.state.active.y).toBe(beforeY - 1);

    controller.destroy();
  });

  it("touch IDs share charged movement and release independently", () => {
    const session = new GameSession("touch-controls", 10);
    const controller = createController(session, { das: 100, arr: 0 });
    controller.press("touch:1", "moveLeft");
    controller.press("touch:2", "rotateCW");
    advanceTo(150);
    const left = session.state.active.x;
    expect(left).toBeLessThan(3);
    controller.release("touch:1");
    controller.release("touch:2");
    controller.press("touch:3", "moveRight");
    controller.release("touch:3");
    advanceTo(500);
    expect(session.state.active.x).toBe(left + 1);
    controller.destroy();
  });

  it("UI 전용 Snapshot 종료와 See Solve 키는 GameAction으로 dispatch하지 않는다", () => {
    const dispatch = vi.fn((_action: GameAction) => true);
    const controller = new InputController(dispatch, DEFAULT_SETTINGS);

    fakeWindow.emit("keydown", "Escape");
    fakeWindow.emit("keydown", "KeyV");
    expect(dispatch).not.toHaveBeenCalled();

    controller.destroy();
  });
});
