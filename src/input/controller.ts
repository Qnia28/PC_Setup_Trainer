import type { GameAction } from "../engine/types";
import { GAME_INPUT_ACTIONS, SDF_INFINITE, createBinding, type InputSettings } from "./settings";

interface PressedKey {
  action: GameAction;
  order: number;
}

interface RepeatState {
  action: "moveLeft" | "moveRight" | "softDrop";
  started: number;
  last: number;
  arrZeroApplied: boolean;
}

const HORIZONTAL_ACTIONS = new Set<GameAction>(["moveLeft", "moveRight"]);
const ROTATION_ACTIONS = new Set<GameAction>(["rotateCW", "rotateCCW", "rotate180"]);

export class InputController {
  private pressed = new Map<string, PressedKey>();
  private repeats = new Map<string, RepeatState>();
  private activeHorizontalCode: string | null = null;
  private pressOrder = 0;
  private frame = 0;
  private settings: InputSettings;

  constructor(private dispatch: (action: GameAction) => boolean, settings: InputSettings) {
    this.settings = settings;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);
    document.addEventListener("visibilitychange", this.clear);
    this.frame = requestAnimationFrame(this.tick);
  }

  updateSettings(settings: InputSettings): void { this.settings = settings; }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
    document.removeEventListener("visibilitychange", this.clear);
    this.clear();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, button, select, textarea")) return;
    const bindings = GAME_INPUT_ACTIONS.map((action): [GameAction, string] => [action, this.settings.bindings[action]]);
    const binding = createBinding(event.code, event);
    const action = bindings.find(([, configured]) => configured === binding)?.[0]
      ?? bindings.find(([, configured]) => configured === event.code)?.[0];
    if (!action) return;
    event.preventDefault();
    if (event.repeat || this.pressed.has(event.code)) return;

    this.press(event.code, action);
  };

  press(code: string, action: GameAction): void {
    if (this.pressed.has(code)) return;
    const now = performance.now();
    this.pressed.set(code, { action, order: ++this.pressOrder });
    if (HORIZONTAL_ACTIONS.has(action) || action === "softDrop") {
      this.repeats.set(code, {
        action: action as RepeatState["action"],
        started: now,
        last: now,
        arrZeroApplied: false,
      });
    }

    const changed = action === "softDrop" && this.settings.sdf === SDF_INFINITE
      ? this.applyInfiniteSoftDrop()
      : this.dispatch(action);
    if (HORIZONTAL_ACTIONS.has(action)) this.selectActiveHorizontal(now, false);
    if (action === "hardDrop" && changed) {
      this.applyInitialActions(now, true);
    } else if (action === "hold" && changed) {
      this.applyInitialActions(now, false);
    } else if (changed && (ROTATION_ACTIONS.has(action) || action === "softDrop")) {
      this.reapplyChargedHorizontal(now);
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.release(event.code);
  };

  release(code: string): void {
    const released = this.pressed.get(code);
    this.pressed.delete(code);
    this.repeats.delete(code);
    if (released && HORIZONTAL_ACTIONS.has(released.action)) this.selectActiveHorizontal(performance.now());
  }

  private clear = (): void => {
    this.pressed.clear();
    this.repeats.clear();
    this.activeHorizontalCode = null;
  };

  private latestPressed(actions: Set<GameAction>): [string, PressedKey] | null {
    let latest: [string, PressedKey] | null = null;
    for (const entry of this.pressed.entries()) {
      if (!actions.has(entry[1].action)) continue;
      if (!latest || entry[1].order > latest[1].order) latest = entry;
    }
    return latest;
  }

  private selectActiveHorizontal(now: number, resumeCharged = true): void {
    const latest = this.latestPressed(HORIZONTAL_ACTIONS);
    const nextCode = latest?.[0] ?? null;
    if (nextCode === this.activeHorizontalCode) return;
    this.activeHorizontalCode = nextCode;
    if (!nextCode) return;
    const repeat = this.repeats.get(nextCode);
    if (!repeat) return;
    repeat.arrZeroApplied = false;
    if (resumeCharged && now - repeat.started >= this.settings.das) this.applyHorizontalRepeat(repeat, now, true);
  }

  private applyHorizontalRepeat(repeat: RepeatState, now: number, immediate = false): void {
    if (this.settings.arr === 0) {
      if (repeat.arrZeroApplied) return;
      for (let index = 0; index < 12; index += 1) this.dispatch(repeat.action);
      repeat.arrZeroApplied = true;
      repeat.last = now;
      return;
    }
    if (!immediate && now - repeat.last < this.settings.arr) return;
    this.dispatch(repeat.action);
    repeat.last = now;
  }

  private reapplyChargedHorizontal(now: number): void {
    const horizontal = this.activeHorizontalCode ? this.repeats.get(this.activeHorizontalCode) : null;
    if (!horizontal || now - horizontal.started < this.settings.das) return;
    horizontal.arrZeroApplied = false;
    this.applyHorizontalRepeat(horizontal, now, true);
  }

  private applyInfiniteSoftDrop(): boolean {
    let moved = false;
    for (let index = 0; index < 24; index += 1) {
      const changed = this.dispatch("softDrop");
      if (!changed) break;
      moved = true;
    }
    return moved;
  }

  private applySpawnHorizontal(now: number): void {
    const horizontal = this.activeHorizontalCode ? this.repeats.get(this.activeHorizontalCode) : null;
    if (!horizontal) return;
    if (now - horizontal.started < this.settings.das) {
      this.dispatch(horizontal.action);
      return;
    }
    horizontal.arrZeroApplied = false;
    this.applyHorizontalRepeat(horizontal, now, true);
  }

  private applyInitialActions(now: number, includeIhs: boolean): void {
    if (includeIhs) {
      const heldHold = this.latestPressed(new Set<GameAction>(["hold"]));
      if (heldHold) this.dispatch("hold");
    }

    const heldRotation = this.latestPressed(ROTATION_ACTIONS);
    if (heldRotation) this.dispatch(heldRotation[1].action);
    this.applySpawnHorizontal(now);
  }

  private tick = (now: number): void => {
    for (const [code, repeat] of this.repeats) {
      if (repeat.action !== "softDrop") continue;
      if (!this.pressed.has(code)) continue;
      if (this.settings.sdf === SDF_INFINITE) {
        const moved = this.applyInfiniteSoftDrop();
        repeat.last = now;
        if (moved) this.reapplyChargedHorizontal(now);
        continue;
      }
      const interval = 1000 / this.settings.sdf;
      if (now - repeat.last < interval) continue;
      const count = Math.min(20, Math.floor((now - repeat.last) / interval));
      let moved = false;
      for (let index = 0; index < count; index += 1) moved = this.dispatch("softDrop") || moved;
      repeat.last = now;
      if (moved) this.reapplyChargedHorizontal(now);
    }

    if (this.activeHorizontalCode) {
      const horizontal = this.repeats.get(this.activeHorizontalCode);
      if (horizontal && now - horizontal.started >= this.settings.das) this.applyHorizontalRepeat(horizontal, now);
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
