import { describe, expect, it } from "vitest";
import { prepareStandaloneSolve } from "./model";

describe("standalone solver input planning", () => {
  it("uses an exact 10P window for a 3P + see7 solve", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 12,
      queue: "TILJOSZ",
      displayMode: "one",
    })).toEqual({
      ready: true,
      analysis: {
        kind: "solve-one",
        occupiedCells: 12,
        piecesNeeded: 7,
        queueWindow: "TILJOSZ",
        queueWindowLength: 7,
        saveMode: false,
      },
    });
  });

  it("uses only the required prefix for a save calculation with a longer queue", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 16,
      queue: "TILJOSZTI",
      displayMode: "all",
    })).toMatchObject({
      ready: true,
      analysis: {
        kind: "per-save-all",
        occupiedCells: 16,
        piecesNeeded: 6,
        queueWindow: "TILJOSZ",
        queueWindowLength: 7,
        saveMode: true,
      },
    });
  });

  it("treats a manually filled bottom row as part of the four-line format", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 20,
      queue: "TILJOS",
      displayMode: "one",
    })).toMatchObject({
      ready: true,
      analysis: { occupiedCells: 20, piecesNeeded: 5, kind: "per-save-minimals" },
    });
  });

  it("treats two manually filled bottom rows as part of the four-line format", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 28,
      queue: "TIL",
      displayMode: "all",
    })).toMatchObject({
      ready: true,
      analysis: { occupiedCells: 28, piecesNeeded: 3, kind: "solve-all" },
    });
  });

  it("rejects a field whose remaining cells cannot complete the target", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 13,
      queue: "TILJOSZ",
      displayMode: "one",
    })).toMatchObject({ ready: false });
  });

  it("accepts the reported 26-cell 5-line Fumen geometry", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 26,
      queue: "LIOZSJT",
      displayMode: "all",
      targetLines: 5,
    })).toEqual({
      ready: true,
      analysis: {
        kind: "per-save-all",
        occupiedCells: 26,
        piecesNeeded: 6,
        queueWindow: "LIOZSJT",
        queueWindowLength: 7,
        saveMode: true,
      },
    });
  });

  it("preserves invalid queue text for the UI but blocks calculation", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 12,
      queue: "TILXOSZ",
      displayMode: "one",
    })).toEqual({
      ready: false,
      reason: "Queue contains invalid characters. Use only T, I, L, J, O, S, and Z.",
    });
  });

  it("reports required pieces without see notation when the queue is short", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 0,
      queue: "",
      displayMode: "all",
    })).toEqual({
      ready: false,
      reason: "10P required to complete this field.",
    });
  });

  it("plans a six-line save calculation from a compatibility field", () => {
    expect(prepareStandaloneSolve({
      occupiedCells: 40,
      queue: "OOOOOI",
      displayMode: "all",
      targetLines: 6,
    })).toEqual({
      ready: true,
      analysis: {
        kind: "per-save-all",
        occupiedCells: 40,
        piecesNeeded: 5,
        queueWindow: "OOOOOI",
        queueWindowLength: 6,
        saveMode: true,
      },
    });
  });
});
