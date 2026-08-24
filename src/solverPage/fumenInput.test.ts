import { encoder, Field } from "tetris-fumen";
import { describe, expect, it } from "vitest";
import { parseSolverFumen } from "./fumenInput";

function encodeCells(cells: ReadonlyArray<readonly [number, number]>): string {
  const field = Field.create();
  for (const [x, y] of cells) field.set(x, y, "X");
  return encoder.encode([{ field }]);
}

describe("standalone solver Fumen input", () => {
  it("decodes a raw Fumen into the editable four-line field", () => {
    const parsed = parseSolverFumen(encodeCells([[0, 0], [3, 2]]));
    expect(parsed).toMatchObject({ status: "ready" });
    if (parsed.status !== "ready") return;
    expect(parsed.field[0]?.[0]).toBe(true);
    expect(parsed.field[2]?.[3]).toBe(true);
    expect(parsed.field.flat().filter(Boolean)).toHaveLength(2);
  });

  it("accepts a Fumen viewer URL", () => {
    const code = encodeCells([[9, 3]]);
    expect(parseSolverFumen(`https://knewjade.github.io/fumen-for-mobile/#?d=${code}`))
      .toMatchObject({ status: "ready", code });
  });

  it("rejects occupied cells above the four-line compatibility mode", () => {
    expect(parseSolverFumen(encodeCells([[0, 4]]))).toMatchObject({ status: "error" });
  });

  it("accepts cells through the sixth row in six-line mode", () => {
    const parsed = parseSolverFumen(encodeCells([[0, 4], [9, 5]]), 6);
    expect(parsed).toMatchObject({ status: "ready" });
    if (parsed.status !== "ready") return;
    expect(parsed.field[4]?.[0]).toBe(true);
    expect(parsed.field[5]?.[9]).toBe(true);
  });

  it("decodes the reported valid five-line Fumen with all 26 occupied cells", () => {
    const parsed = parseSolverFumen("v115@zgB8GeC8GeE8EeD8DeG8AeE8JeAgH", 5);
    expect(parsed).toMatchObject({ status: "ready" });
    if (parsed.status !== "ready") return;
    expect(parsed.field.flat().filter(Boolean)).toHaveLength(26);
  });
});
