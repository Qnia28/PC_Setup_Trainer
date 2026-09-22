import { describe, expect, it } from "vitest";
import {
  MAX_RETAINED_SOLVER_MEMORY_BYTES,
  createRetryableSolverLoader,
  exceedsSolverWorkerMemoryLimit,
  resultUsedHiGHS,
  shouldRecycleSolverWorkerAfterError,
  shouldRecycleSolverWorkerAfterResult,
  runWorkerRequest,
} from "../../../src/solver/worker-runtime.mjs";

const COMPLETED_ROW_PER_SAVE = "v115@9gRpDezhRpEeQ4hlg0zhBtR4gli0CeBtQ4glJeAgH";

describe("Solver Worker memory limit", () => {
  it("recycles only after retained solver memory exceeds 128 MiB", () => {
    expect(MAX_RETAINED_SOLVER_MEMORY_BYTES).toBe(128 * 1024 * 1024);
    expect(exceedsSolverWorkerMemoryLimit(MAX_RETAINED_SOLVER_MEMORY_BYTES)).toBe(false);
    expect(exceedsSolverWorkerMemoryLimit(MAX_RETAINED_SOLVER_MEMORY_BYTES + 1)).toBe(true);
  });

  it("warms the four-line WASM solver and legal-board pack without solving", async () => {
    await expect(runWorkerRequest({ kind: "warmup", input: { targetLines: 4 } })).resolves.toMatchObject({
      targetLines: 4,
      ready: true,
    });
  });

  it("warms the six-line WASM solver without solving", async () => {
    await expect(runWorkerRequest({ kind: "warmup", input: { targetLines: 6 } })).resolves.toMatchObject({
      targetLines: 6,
      ready: true,
    });
  });

  it("detects global and per-save HiGHS results for post-result recycling", () => {
    expect(resultUsedHiGHS({ useHiGHSResolved: true })).toBe(true);
    expect(resultUsedHiGHS({ cardinalityBackend: "highs" })).toBe(true);
    expect(resultUsedHiGHS({ results: { T: { cardinalityBackend: "highs" } } })).toBe(true);
    expect(resultUsedHiGHS({ results: { T: { cardinalityBackend: "kernel" } } })).toBe(false);
    expect(shouldRecycleSolverWorkerAfterResult({ cardinalityBackend: "highs" })).toBe(true);
  });

  it("keeps retry-safe Workers after ordinary request errors", () => {
    expect(shouldRecycleSolverWorkerAfterError("minimals")).toBe(false);
    expect(shouldRecycleSolverWorkerAfterError("per-save-minimals")).toBe(false);
    expect(shouldRecycleSolverWorkerAfterError("chance")).toBe(false);
  });

  it("shares successful solver loads and retries a rejected height load", async () => {
    let attempts = 0;
    const load = createRetryableSolverLoader(async (height: number) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary WASM load failure");
      return { height, attempt: attempts };
    });

    await expect(load(4)).rejects.toThrow("temporary WASM load failure");
    await expect(load(4)).resolves.toEqual({ height: 4, attempt: 2 });
    await expect(load(4)).resolves.toEqual({ height: 4, attempt: 2 });
    expect(attempts).toBe(2);
  });

  it("rejects invalid heights before allocating a keyed loader", async () => {
    let attempts = 0;
    const load = createRetryableSolverLoader(async (height: number) => {
      attempts += 1;
      return height;
    });

    await expect(load(7)).rejects.toThrow("unsupported height 7");
    expect(attempts).toBe(0);
  });

  it("aggregates per-save results through two exact secondary workers and remains reusable", async () => {
    const result = await runWorkerRequest({
      kind: "per-save-minimals",
      input: {
        sourceFumen: COMPLETED_ROW_PER_SAVE,
        pattern: "T,*p3",
        targetLines: 4,
        Primary: "Rust",
        useHiGHS: false,
        exactHumanQuality: "true",
        secondaryWorkers: 2,
      },
    }) as {
      total: number;
      pcSuccess: number;
      results: Record<string, { total: number; pcSuccess: number; humanQualityExact: boolean }>;
    };

    expect(result).toMatchObject({ total: 210, pcSuccess: 190 });
    expect(Object.keys(result.results).sort()).toEqual(["I", "J", "L", "O", "S", "T", "Z"]);
    for (const row of Object.values(result.results)) {
      expect(row).toMatchObject({ total: 210, pcSuccess: 190, humanQualityExact: true });
    }
    await expect(runWorkerRequest({ kind: "warmup", input: { targetLines: 4 } })).resolves.toMatchObject({
      targetLines: 4,
      ready: true,
    });
  });
});
