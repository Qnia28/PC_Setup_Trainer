import { decoder, encoder, Field, Mino, type Page } from "tetris-fumen";
import {
  COMMAND_FIELD_MAX_HEIGHT,
  COMMAND_FIELD_WIDTH,
  type CommandField,
} from "./commandCanvas";

export { formatCalculationDuration } from "../solver/formatDuration";

export type CommandTargetLines = 2 | 3 | 4 | 5 | 6;
export type CommandLineGroup = "2-4" | "5-6";
export type HiGHSMode = "auto" | "on" | "off";
export type HumanQualityMode = "Fast" | "True";
export const PER_SAVE_RESULT_ORDER = "TILJOSZ";

export interface PerSavePageGroup {
  piece: string;
  label: string;
  pages: Page[];
}

export function isAdaptiveMinimalsCommand(commandId: string): boolean {
  return commandId === "minimals" || commandId === "per_save_minimals";
}

export function defaultHumanQualityMode(commandId: string): HumanQualityMode {
  return commandId === "per_save_minimals" ? "True" : "Fast";
}

export function minimumCoverWorkerOptions(
  commandId: string,
  useHiGHSMode: HiGHSMode,
  exactHumanQuality: HumanQualityMode,
): { useHiGHS?: boolean | "auto"; exactHumanQuality?: HumanQualityMode } {
  if (!isAdaptiveMinimalsCommand(commandId)) return {};
  return {
    useHiGHS: useHiGHSMode === "auto" ? "auto" : useHiGHSMode === "on",
    exactHumanQuality,
  };
}

export function commandDisplayRows(group: CommandLineGroup): 4 | 6 {
  return group === "2-4" ? 4 : 6;
}

export function defaultTargetLines(group: CommandLineGroup): 4 | 5 {
  return group === "2-4" ? 4 : 5;
}

export function commandTargetOptions(group: CommandLineGroup): readonly CommandTargetLines[] {
  return group === "2-4" ? [2, 3, 4] : [5, 6];
}

export function normalizeSfinderQueuePattern(pattern: string): string {
  return pattern.trim().replace(/\{([^{}]*)\}/g, (_constraint, rules: string) => {
    const normalizedRules = rules.trim().replace(
      /([TILJSZO])\s*[<>]\s*([TILJSZO])/gi,
      (_rule, earlier: string, later: string) => `${earlier.toUpperCase()}<${later.toUpperCase()}`,
    );
    return `{${normalizedRules}}`;
  });
}

export function formatRatioPercentage(ratio: number): string {
  const percent = ratio * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

export function groupPerSavePages(pages: readonly Page[]): PerSavePageGroup[] {
  const byPiece = new Map([...PER_SAVE_RESULT_ORDER].map((piece) => [piece, [] as Page[]]));
  for (const page of pages) {
    const piece = page.comment.match(/\bSave ([TILJOSZ])\b/i)?.[1]?.toUpperCase();
    if (piece) byPiece.get(piece)?.push(page);
  }
  return [...PER_SAVE_RESULT_ORDER].flatMap((piece) => {
    const savedPages = byPiece.get(piece) ?? [];
    return savedPages.length ? [{ piece, label: `Save ${piece}`, pages: savedPages }] : [];
  });
}

export function extractFumenCode(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = trimmed.match(/v11[05]@[A-Za-z0-9+/?]+/)?.[0];
  if (direct) return direct;
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("d")
      ?? new URLSearchParams(url.hash.replace(/^#\??/, "")).get("d")
      ?? trimmed;
  } catch {
    return trimmed;
  }
}

function validateDisplayHeight(page: Page, displayRows: 4 | 6): void {
  for (let y = displayRows; y <= 22; y += 1) {
    for (let x = 0; x < COMMAND_FIELD_WIDTH; x += 1) {
      if (page.field.at(x, y) !== "_") {
        throw new Error(`The ${displayRows}-row input board cannot contain blocks above row ${displayRows}.`);
      }
    }
  }
}

export function fieldFromFumen(value: string, displayRows: 4 | 6): CommandField {
  const code = extractFumenCode(value);
  if (!code) throw new Error("Enter a Fumen code or URL first.");
  const page = decoder.decode(code)[0];
  if (!page) throw new Error("The Fumen contains no field page.");
  validateDisplayHeight(page, displayRows);
  const displayField = page.field.copy();
  if (page.operation) displayField.fill(page.operation, true);
  return Array.from({ length: COMMAND_FIELD_MAX_HEIGHT }, (_, y) =>
    Array.from(
      { length: COMMAND_FIELD_WIDTH },
      (_, x) => {
        if (y >= displayRows) return null;
        const cell = displayField.at(x, y);
        return cell === "_" ? null : cell;
      },
    ));
}

function normalizedPage(page: Page, targetLines: CommandTargetLines, displayRows: 4 | 6) {
  validateDisplayHeight(page, displayRows);
  const field = Field.create();
  for (let y = 0; y < targetLines; y += 1) {
    for (let x = 0; x < COMMAND_FIELD_WIDTH; x += 1) {
      const cell = page.field.at(x, y);
      if (cell !== "_") field.set(x, y, cell);
    }
  }
  let operation = page.operation;
  if (operation) {
    const positions = Mino.from(operation).positions();
    const inside = positions.filter(({ y }) => y >= 0 && y < targetLines);
    if (inside.length !== 0 && inside.length !== positions.length) {
      throw new Error(`The page operation crosses the ${targetLines}L calculation boundary.`);
    }
    if (inside.length === 0) operation = undefined;
  }
  return {
    field,
    operation,
    comment: page.comment,
    flags: page.flags,
  };
}

function fieldPage(field: CommandField, targetLines: CommandTargetLines) {
  const fumenField = Field.create();
  for (let y = 0; y < targetLines; y += 1) {
    for (let x = 0; x < COMMAND_FIELD_WIDTH; x += 1) {
      const cell = field[y]?.[x];
      if (cell) fumenField.set(x, y, cell);
    }
  }
  return { field: fumenField, flags: { colorize: true } };
}

export function normalizeCommandSource(input: {
  fumen: string;
  field: CommandField;
  targetLines: CommandTargetLines;
  displayRows: 4 | 6;
}): string {
  const code = extractFumenCode(input.fumen);
  if (!code) return encoder.encode([fieldPage(input.field, input.targetLines)]);
  const pages = decoder.decode(code);
  if (!pages.length) throw new Error("The Fumen contains no field page.");
  return encoder.encode(pages.map((page) => normalizedPage(page, input.targetLines, input.displayRows)));
}

export function occupiedCalculationCells(field: CommandField, targetLines: CommandTargetLines): number {
  let count = 0;
  for (let y = 0; y < targetLines; y += 1) {
    for (let x = 0; x < COMMAND_FIELD_WIDTH; x += 1) if (field[y]?.[x]) count += 1;
  }
  return count;
}
