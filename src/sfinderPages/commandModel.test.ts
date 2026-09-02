import { describe, expect, it } from "vitest";
import { decoder, encoder, Field } from "tetris-fumen";
import { createEmptyCommandField } from "./commandCanvas";
import {
  commandDisplayRows,
  commandTargetOptions,
  defaultHumanQualityMode,
  defaultTargetLines,
  formatCalculationDuration,
  formatRatioPercentage,
  groupPerSavePages,
  fieldFromFumen,
  minimumCoverWorkerOptions,
  normalizeCommandSource,
  normalizeSfinderQueuePattern,
  occupiedCalculationCells,
} from "./commandModel";

describe("sfinder command line groups", () => {
  it("maps adaptive minimum-cover controls without exposing the legacy path", () => {
    expect(defaultHumanQualityMode("minimals")).toBe("Fast");
    expect(defaultHumanQualityMode("per_save_minimals")).toBe("True");
    expect(minimumCoverWorkerOptions("minimals", "auto", "Fast")).toEqual({
      useHiGHS: "auto",
      exactHumanQuality: "Fast",
    });
    expect(minimumCoverWorkerOptions("minimals", "off", "True")).toEqual({
      useHiGHS: false,
      exactHumanQuality: "True",
    });
    expect(minimumCoverWorkerOptions("per_save_minimals", "on", "True")).toEqual({
      useHiGHS: true,
      exactHumanQuality: "True",
    });
    expect(minimumCoverWorkerOptions("chance", "on", "True")).toEqual({});
  });

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

  it("formats ratio values as percentages", () => {
    expect(formatRatioPercentage(0)).toBe("0%");
    expect(formatRatioPercentage(0.9523809524)).toBe("95.24%");
    expect(formatRatioPercentage(1)).toBe("100%");
  });

  it("normalizes SFinder bag-order constraints while preserving the visible expression", () => {
    expect(normalizeSfinderQueuePattern(" *!{O>T} ")).toBe("*!{O<T}");
    expect(normalizeSfinderQueuePattern("T,*p6{ O > T, L>S }")).toBe("T,*p6{O<T, L<S}");
    expect(normalizeSfinderQueuePattern("[OT]!{O<T};[SZ]!{S>Z}")).toBe("[OT]!{O<T};[SZ]!{S<Z}");
  });

  it("groups per-save pages by saved piece in PC Solver display order", () => {
    const pages = decoder.decode(encoder.encode([
      { field: Field.create(), comment: "Save Z (50.00%)" },
      { field: Field.create(), comment: "☆ Save T" },
      { field: Field.create(), comment: "Save Z (50.00%)" },
      { field: Field.create(), comment: "Save O (25.00%)" },
    ]));

    expect(groupPerSavePages(pages).map(({ piece, label, pages: savedPages }) => ({
      piece,
      label,
      count: savedPages.length,
    }))).toEqual([
      { piece: "T", label: "Save T", count: 1 },
      { piece: "O", label: "Save O", count: 1 },
      { piece: "Z", label: "Save Z", count: 2 },
    ]);
  });

  it("ignores the top displayed row when a 6-row board targets 5 lines", () => {
    const field = createEmptyCommandField();
    field[0]![0] = "X";
    field[4]![1] = "X";
    field[5]![2] = "X";

    const fumen = normalizeCommandSource({ fumen: "", field, targetLines: 5, displayRows: 6 });
    const page = decoder.decode(fumen)[0]!;
    expect(page.field.at(0, 0)).toBe("X");
    expect(page.field.at(1, 4)).toBe("X");
    expect(page.field.at(2, 5)).toBe("_");
  });

  it("ignores all displayed rows above a 2-line target without shifting the field", () => {
    const field = createEmptyCommandField();
    field[0]![0] = "X";
    field[1]![1] = "X";
    field[2]![2] = "X";
    field[3]![3] = "X";

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

  it("preserves drawn colors when encoding a command field", () => {
    const field = createEmptyCommandField();
    field[0]![0] = "T";
    field[0]![1] = "O";
    field[1]![2] = "I";
    field[1]![3] = "X";

    const page = decoder.decode(normalizeCommandSource({
      fumen: "",
      field,
      targetLines: 4,
      displayRows: 4,
    }))[0]!;

    expect(page.field.at(0, 0)).toBe("T");
    expect(page.field.at(1, 0)).toBe("O");
    expect(page.field.at(2, 1)).toBe("I");
    expect(page.field.at(3, 1)).toBe("X");
    expect(occupiedCalculationCells(field, 4)).toBe(4);
  });

  it("keeps colored Fumen cells in the editable command field", () => {
    const sourceField = Field.create();
    sourceField.set(0, 0, "T");
    sourceField.set(1, 0, "O");
    sourceField.set(2, 1, "J");
    sourceField.set(3, 1, "X");
    const source = encoder.encode([{ field: sourceField, flags: { colorize: true } }]);

    const field = fieldFromFumen(source, 4);

    expect(field[0]!.slice(0, 4)).toEqual(["T", "O", null, null]);
    expect(field[1]!.slice(0, 4)).toEqual([null, null, "J", "X"]);
  });
});
