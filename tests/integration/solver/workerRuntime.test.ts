import { describe, expect, it } from "vitest";
import {
  MAX_RETAINED_SOLVER_MEMORY_BYTES,
  exceedsSolverWorkerMemoryLimit,
  runWorkerRequest,
} from "../../../src/solver/worker-runtime.mjs";

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
});
