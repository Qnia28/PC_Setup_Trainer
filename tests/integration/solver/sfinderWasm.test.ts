import { decoder, encoder, Field } from "tetris-fumen";
import { describe, expect, it } from "vitest";
import {
  retainedSolverMemoryBytes,
  runWorkerRequest,
  shouldRecycleSolverWorker,
} from "../../../src/solver/worker-runtime.mjs";

const emptyTwoLineField = encoder.encode([{
  field: Field.create(),
  flags: { colorize: true },
}]);
const broadFiveLineField = "v115@zgB8GeC8GeE8EeD8DeG8AeE8JeAgH";

function fieldWithFilledBottomRows(rows: number): string {
  const field = Field.create();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < 10; x += 1) field.set(x, y, "X");
  }
  return encoder.encode([{ field, flags: { colorize: true } }]);
}

describe("sfinder-wasm live solver integration", () => {
  it("returns one ordinary solution for a concrete solve-one queue", async () => {
    const result = await runWorkerRequest({
      kind: "solve-one",
      input: {
        sourceFumen: emptyTwoLineField,
        pattern: "OOOOO",
        targetLines: 2,
        useHold: true,
      },
    }) as {
      solutionCount: number;
      solutionKey: string | null;
      playableOrderCount: number;
      fumen: string | null;
    };

    expect(result.solutionCount).toBe(1);
    expect(result.solutionKey).toBeTruthy();
    expect(result.playableOrderCount).toBeGreaterThan(0);
    expect(result.fumen).not.toBeNull();
    expect(result.fumen).toBe("v115@vhAAgHRhjpJeAAPIAT3khE0eDKE");
    expect(decoder.decode(result.fumen!).length).toBe(2);
  });

  it("uses the single-queue per-save path and returns the saved piece", async () => {
    const result = await runWorkerRequest({
      kind: "per-save-minimals",
      input: {
        sourceFumen: emptyTwoLineField,
        pattern: "OOOOOI",
        targetLines: 2,
        useHold: true,
      },
    }) as {
      pcSuccess: number;
      pageCounts: Record<string, number>;
      results: Record<string, { minimalCount: number; playableOrderCount: number | null }>;
      fumen: string;
    };

    expect(result.pcSuccess).toBe(1);
    expect(result.pageCounts.I).toBe(1);
    expect(result.results.I).toMatchObject({ minimalCount: 1, playableOrderCount: 1 });
    expect(decoder.decode(result.fumen).length).toBe(2);
    expect(retainedSolverMemoryBytes()).toBeGreaterThan(0);
    expect(shouldRecycleSolverWorker()).toBe(false);
  });

  it("returns every ordinary solution when solve-all is requested", async () => {
    const result = await runWorkerRequest({
      kind: "solve-all",
      input: {
        sourceFumen: emptyTwoLineField,
        pattern: "OOOOO",
        targetLines: 2,
        useHold: true,
      },
    }) as { solutionCount: number; fumen: string | null };

    expect(result.solutionCount).toBeGreaterThan(0);
    expect(result.fumen).toBe("v115@vhAAgHRhjpJeAAPMAT3khE0eDKEFb85A");
    expect(decoder.decode(result.fumen!).length).toBe(result.solutionCount + 1);
  });

  it("groups all concrete-queue solutions by saved piece", async () => {
    const result = await runWorkerRequest({
      kind: "per-save-all",
      input: {
        sourceFumen: emptyTwoLineField,
        pattern: "OOOOOI",
        targetLines: 2,
        useHold: true,
      },
    }) as { solutionCount: number; pageCounts: Record<string, number>; fumen: string | null };

    expect(result.solutionCount).toBeGreaterThan(0);
    expect(result.pageCounts.I).toBeGreaterThan(0);
    expect(result.pageCounts).toEqual({ T: 0, I: 1, L: 0, J: 0, S: 0, Z: 0, O: 0 });
    expect(result.fumen).toBe("v115@vhAAgHRhjpJeAAPIATC7rDFb8KC");
    expect(decoder.decode(result.fumen!).length).toBe(result.solutionCount + 1);
  });

  it.each([
    { targetLines: 4, filledRows: 2, expectedFumen: null },
    { targetLines: 5, filledRows: 3, expectedFumen: "v115@Hhd8JeAgHzgjpd8JeAAPIAT3khE0eDKE" },
    { targetLines: 6, filledRows: 4, expectedFumen: null },
  ] as const)("solves a fast $targetLines-line compatibility field", async ({ targetLines, filledRows, expectedFumen }) => {
    const result = await runWorkerRequest({
      kind: "solve-one",
      input: {
        sourceFumen: fieldWithFilledBottomRows(filledRows),
        pattern: "OOOOO",
        targetLines,
        useHold: true,
      },
    }) as { targetLines: number; solutionCount: number; fumen: string | null };

    expect(result).toMatchObject({ targetLines, solutionCount: 1 });
    if (expectedFumen) expect(result.fumen).toBe(expectedFumen);
    expect(decoder.decode(result.fumen!)).toHaveLength(2);
  });

  it("uses the optimized pattern pipeline for a broad five-line matrix", async () => {
    const chance = await runWorkerRequest({
      kind: "chance",
      input: {
        sourceFumen: broadFiveLineField,
        pattern: "*p7",
        targetLines: 5,
        useHold: true,
      },
    }) as { total: number; success: number; failed: number };

    expect(chance).toMatchObject({ total: 5040, success: 5004, failed: 36 });

    const minimals = await runWorkerRequest({
      kind: "per-save-minimals",
      input: {
        sourceFumen: broadFiveLineField,
        pattern: "*p7",
        targetLines: 5,
        useHold: true,
      },
    }) as { pcSuccess: number; pageCounts: Record<string, number> };

    expect(minimals.pcSuccess).toBe(5004);
    expect(Object.values(minimals.pageCounts).reduce((sum, count) => sum + count, 0)).toBe(64);
  });

  it("preserves save-by-save output in six-line mode", async () => {
    const result = await runWorkerRequest({
      kind: "per-save-minimals",
      input: {
        sourceFumen: fieldWithFilledBottomRows(4),
        pattern: "OOOOOI",
        targetLines: 6,
        useHold: true,
      },
    }) as { targetLines: number; pageCounts: Record<string, number>; fumen: string };

    expect(result.targetLines).toBe(6);
    expect(result.pageCounts.I).toBeGreaterThan(0);
    expect(decoder.decode(result.fumen).length).toBeGreaterThan(1);
  });
});
