import { describe, expect, it } from "vitest";
import { decoder, encoder, Field } from "tetris-fumen";
import { createEmptyCommandField } from "./commandCanvas";
import {
  commandDisplayRows,
  commandTargetOptions,
  defaultTargetLines,
  formatCalculationDuration,
  normalizeCommandSource,
} from "./commandModel";

describe("sfinder command line groups", () => {
  it("keeps fixed 4-row and 6-row boards with 4L and 5L defaults", () => {
    expect(commandDisplayRows("2-4")).toBe(4);
    expect(commandTargetOptions("2-4")).toEqual([2, 3, 4]);
    expect(defaultTargetLines("2-4")).toBe(4);
    expect(commandDisplayRows("5-6")).toBe(6);
    expect(commandTargetOptions("5-6")).toEqual([5, 6]);
    expect(defaultTargetLines("5-6")).toBe(5);
  });

  it("formats completed calculation time in milliseconds below ten seconds and seconds above it", () => {
    expect(formatCalculationDuration(0)).toBe("0 ms");
    expect(formatCalculationDuration(9_999)).toBe("9999 ms");
    expect(formatCalculationDuration(10_000)).toBe("10.0 s");
    expect(formatCalculationDuration(10_549)).toBe("10.5 s");
    expect(formatCalculationDuration(61_234)).toBe("61.2 s");
  });

  it("ignores the top displayed row when a 6-row board targets 5 lines", () => {
    const field = createEmptyCommandField();
    field[0]![0] = true;
    field[4]![1] = true;
    field[5]![2] = true;

    const fumen = normalizeCommandSource({ fumen: "", field, targetLines: 5, displayRows: 6 });
    const page = decoder.decode(fumen)[0]!;
    expect(page.field.at(0, 0)).toBe("X");
    expect(page.field.at(1, 4)).toBe("X");
    expect(page.field.at(2, 5)).toBe("_");
  });

  it("ignores all displayed rows above a 2-line target without shifting the field", () => {
    const field = createEmptyCommandField();
    field[0]![0] = true;
    field[1]![1] = true;
    field[2]![2] = true;
    field[3]![3] = true;

    const fumen = normalizeCommandSource({ fumen: "", field, targetLines: 2, displayRows: 4 });
    const page = decoder.decode(fumen)[0]!;
    expect(page.field.at(0, 0)).toBe("X");
    expect(page.field.at(1, 1)).toBe("X");
    expect(page.field.at(2, 2)).toBe("_");
    expect(page.field.at(3, 3)).toBe("_");
  });

  it("applies the same bottom-row crop to colored Fumen input", () => {
    const field = Field.create();
    field.set(0, 0, "T");
    field.set(1, 4, "I");
    field.set(2, 5, "O");
    const source = encoder.encode([{ field, flags: { colorize: true } }]);

    const normalized = normalizeCommandSource({
      fumen: source,
      field: createEmptyCommandField(),
      targetLines: 5,
      displayRows: 6,
    });
    const page = decoder.decode(normalized)[0]!;
    expect(page.field.at(0, 0)).toBe("T");
    expect(page.field.at(1, 4)).toBe("I");
    expect(page.field.at(2, 5)).toBe("_");
  });
});
