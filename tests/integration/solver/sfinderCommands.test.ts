import { decoder } from "tetris-fumen";
import { describe, expect, it } from "vitest";
import { runBatchWorkerRequest } from "../../../src/solver/batch-worker-runtime.mjs";
import { runWorkerRequest } from "../../../src/solver/worker-runtime.mjs";
import { normalizeSfinderQueuePattern } from "../../../src/sfinderPages/commandModel";

const EMPTY_TWO_LINES = "v115@vhAAgH";
const ZIS_SOLUTION = "v115@ThR4BeBtCeR4zhBtKeAgH";

describe("public SFinder command runtimes", () => {
  it("passes SFinder-style greater-than bag-order constraints to the WASM pattern engine", async () => {
    await expect(runWorkerRequest({
      kind: "chance",
      input: {
        sourceFumen: EMPTY_TWO_LINES,
        pattern: normalizeSfinderQueuePattern("OOOO,[OT]!{O>T}"),
        clear: 2,
        targetLines: 2,
      },
    })).resolves.toMatchObject({ total: 1, success: 1, percent: 100 });
  });

  it("runs chance, saves, and minimals through the shared PC Worker runtime", async () => {
    await expect(runWorkerRequest({
      kind: "chance",
      input: { sourceFumen: EMPTY_TWO_LINES, pattern: "OOOOO", clear: 2, targetLines: 2 },
    })).resolves.toMatchObject({ total: 1, success: 1, percent: 100 });

    const allSaves = await runWorkerRequest({
      kind: "saves",
      input: { sourceFumen: EMPTY_TWO_LINES, pattern: "OOOO,[O]!", wantedSave: "", clear: 2, targetLines: 2 },
    }) as { total: number; success: number; failed: number; saveResults: Array<Record<string, unknown>> };
    expect(allSaves).toMatchObject({ total: 1, success: 1, failed: 0 });
    expect(allSaves.saveResults).toEqual([
      { save: "", success: 1, total: 1, percent: 100 },
    ]);

    const multipleSaves = await runWorkerRequest({
      kind: "saves",
      input: { sourceFumen: EMPTY_TWO_LINES, pattern: "OOOO,[O]!", wantedSave: "O,!O,/O{0,1}/", clear: 2, targetLines: 2 },
    }) as { wantedSaveResults: Array<Record<string, unknown>> };
    expect(multipleSaves.wantedSaveResults.map(({ saveExpression, success }) => ({ saveExpression, success }))).toEqual([
      { saveExpression: "O", success: 0 },
      { saveExpression: "!O", success: 1 },
      { saveExpression: "/O{0,1}/", success: 1 },
    ]);

    const minimals = await runWorkerRequest({
      kind: "minimals",
      input: {
        sourceFumen: EMPTY_TWO_LINES,
        pattern: "OOOO,[O]!",
        wantedSave: "",
        clear: 2,
        targetLines: 2,
        useHiGHS: false,
        exactHumanQuality: "Fast",
      },
    }) as {
      minimalCount: number;
      fumen: string;
      cardinalityBackend: string;
      humanQualityExact: boolean;
      useHiGHSRequested: boolean | "auto";
      useHiGHSResolved: boolean;
    };
    expect(minimals.minimalCount).toBe(1);
    expect(decoder.decode(minimals.fumen)).toHaveLength(1);
    expect(minimals.cardinalityBackend).toEqual(expect.any(String));
    expect(minimals.humanQualityExact).toBe(true);
    expect(minimals.useHiGHSRequested).toBe(false);
    expect(minimals.useHiGHSResolved).toBe(false);
  });

  it("runs cover, congruent, and congruent cover through the browser batch runtime", async () => {
    await expect(runBatchWorkerRequest({
      kind: "cover",
      input: { sourceFumen: ZIS_SOLUTION, pattern: "ZIS", clear: 4, mode: "normal", mirror: false },
    })).resolves.toMatchObject({ covered: 1, total: 1, failed: 0 });

    const congruent = await runBatchWorkerRequest({
      kind: "congruent",
      input: { sourceFumen: ZIS_SOLUTION, pattern: "ZIS", clear: 4 },
    }) as { count: number; fumen: string };
    expect(congruent.count).toBe(1);
    expect(decoder.decode(congruent.fumen)[0]?.comment).toBe("ZIS");

    await expect(runBatchWorkerRequest({
      kind: "congruentcover",
      input: { sourceFumen: ZIS_SOLUTION, pattern: "ZIS", clear: 4, mode: "normal", mirror: false },
    })).resolves.toMatchObject({ count: 1, covered: 1, total: 1, failed: 0 });
  });

  it("accepts the same colored solution in five-line compatibility mode", async () => {
    await expect(runBatchWorkerRequest({
      kind: "cover",
      input: { sourceFumen: ZIS_SOLUTION, pattern: "ZIS", clear: 5, mode: "normal", mirror: false },
    })).resolves.toMatchObject({ covered: 1, total: 1, failed: 0 });
  });
});
