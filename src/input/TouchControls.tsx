import type { MutableRefObject } from "react";
import type { GameAction } from "../engine/types";
import type { InputController } from "./controller";
import { ACTION_LABELS } from "./settings";

const BUTTONS: [GameAction, string][] = [
  ["undo", "↶"], ["restart", "↻"], ["softDrop", "↓"], ["stepDown", "↓₁"],
  ["hardDrop", "⤓"], ["rotate180", "180°"], ["hold", "⇄"],
  ["moveLeft", "◀"], ["moveRight", "▶"],
  ["rotateCCW", "↶"], ["rotateCW", "↷"],
];

export function TouchControls({ controller, disabled }: {
  controller: MutableRefObject<InputController | null>;
  disabled: boolean;
}) {
  return <div className="touch-controls" aria-label="Touch game controls">
    {BUTTONS.map(([action, symbol]) => <button key={action} type="button"
      className={`touch-${action}`} aria-label={ACTION_LABELS[action]} disabled={disabled}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        controller.current?.press(`touch:${event.pointerId}`, action);
      }}
      onPointerUp={(event) => controller.current?.release(`touch:${event.pointerId}`)}
      onPointerCancel={(event) => controller.current?.release(`touch:${event.pointerId}`)}
      onLostPointerCapture={(event) => controller.current?.release(`touch:${event.pointerId}`)}
      onClick={(event) => {
        // Keyboard/assistive activation only; pointer input already fired on down.
        if (event.detail !== 0) return;
        const code = `accessible:${action}`;
        controller.current?.press(code, action);
        controller.current?.release(code);
      }}
    ><strong aria-hidden="true">{symbol}</strong><small>{ACTION_LABELS[action]}</small></button>)}
  </div>;
}
