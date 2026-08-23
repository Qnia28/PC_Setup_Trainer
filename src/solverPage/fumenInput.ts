import { decoder } from "tetris-fumen";
import { SOLVER_FIELD_MAX_HEIGHT, SOLVER_FIELD_WIDTH } from "./canvas";

export type SolverField = boolean[][];

export type SolverFumenParseResult =
  | { status: "empty" }
  | { status: "ready"; field: SolverField; code: string }
  | { status: "error"; reason: string };

function extractFumenCode(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = trimmed.match(/v11[05]@[A-Za-z0-9+/?]+/)?.[0];
  if (direct) return direct;
  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get("d");
    const fromHash = new URLSearchParams(url.hash.replace(/^#\??/, "")).get("d");
    return fromQuery ?? fromHash;
  } catch {
    return trimmed;
  }
}

export function parseSolverFumen(value: string, visibleRows = 4): SolverFumenParseResult {
  const code = extractFumenCode(value);
  if (!code) return { status: "empty" };
  try {
    const page = decoder.decode(code)[0];
    if (!page) return { status: "error", reason: "The Fumen contains no field page." };
    for (let y = visibleRows; y <= 22; y += 1) {
      for (let x = 0; x < SOLVER_FIELD_WIDTH; x += 1) {
        if (page.field.at(x, y) !== "_") {
          return { status: "error", reason: `The selected mode supports fields up to ${visibleRows} lines.` };
        }
      }
    }
    const field = Array.from({ length: SOLVER_FIELD_MAX_HEIGHT }, (_, y) =>
      Array.from({ length: SOLVER_FIELD_WIDTH }, (_, x) => y < visibleRows && page.field.at(x, y) !== "_"));
    return { status: "ready", field, code };
  } catch (reason) {
    return {
      status: "error",
      reason: reason instanceof Error ? `Invalid Fumen: ${reason.message}` : "Invalid Fumen.",
    };
  }
}
