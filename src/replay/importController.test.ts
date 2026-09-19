import { describe, expect, it, vi } from "vitest";
import { GameSession } from "../engine/game";
import { encodeReplayCode } from "./format";
import { createReplayV3Data, encodeQpcr3Container } from "./qpcr3";
import { ReplayImportController, parseImportedReplay, readReplayFile } from "./importController";
import { decodeJstrisReplayCode } from "./jstrisLocal/decode";
import fixture from "./fixtures/jstris-pc-05.replay.txt?raw";

function replay(seed: string) {
  const session = new GameSession(seed);
  return createReplayV3Data(session.placementHistory.initialState(), session.placementHistory.eventLog());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function callbacks() { return { loading: vi.fn(), install: vi.fn(), error: vi.fn() }; }

describe("replay import boundary", () => {
  it("accepts QPCR code, JSON and binary without weakening validation", async () => {
    const data = replay("formats");
    for (const input of [encodeReplayCode(data), encodeQpcr3Container(data)]) {
      expect((await parseImportedReplay(input)).seed).toBe("formats");
    }
    await expect(parseImportedReplay(JSON.stringify(data))).rejects.toThrow("not a portable container");
    await expect(parseImportedReplay('{"format":"qpcr-replay","version":99,"c":{},"d":"x"}')).rejects.toThrow();
    await expect(parseImportedReplay('{"unrecognized":true}')).rejects.toThrow("Unsupported replay JSON");
    await expect(parseImportedReplay('{')).rejects.toThrow();
  });

  it("accepts direct Jstris JSON and the same JSON from a text file", async () => {
    const json = JSON.stringify(decodeJstrisReplayCode(fixture));
    const fromFile = await readReplayFile({ name: "jstris.json", size: json.length,
      text: async () => json, arrayBuffer: async () => new ArrayBuffer(0) });
    const direct = await parseImportedReplay(json);
    expect(await parseImportedReplay(fromFile)).toEqual(direct);
    expect(await parseImportedReplay(JSON.stringify(direct))).toEqual(direct);
    expect(direct.version).toBe(1);
  });

  it.each(["text", "binary"])("ignores an older %s file that finishes after the latest load", async (kind) => {
    const controller = new ReplayImportController();
    const old = deferred<string | Uint8Array>();
    const a = callbacks(), b = callbacks();
    const pending = controller.load(() => old.promise, a);
    await controller.load(encodeReplayCode(replay("B")), b);
    old.resolve(kind === "text" ? encodeReplayCode(replay("A")) : encodeQpcr3Container(replay("A")));
    await pending;
    expect(a.install).not.toHaveBeenCalled();
    expect(a.loading.mock.calls).toEqual([[true]]);
    expect(b.install.mock.calls[0]?.[0].seed).toBe("B");
    expect(b.loading.mock.calls).toEqual([[true], [false]]);
  });

  it.each(["resolve", "reject"])("clear/unmount suppresses late %s and loading updates", async (outcome) => {
    const controller = new ReplayImportController();
    const old = deferred<string>();
    const cb = callbacks();
    const pending = controller.load(() => old.promise, cb);
    controller.cancel();
    if (outcome === "resolve") old.resolve(encodeReplayCode(replay("A")));
    else old.reject(new Error("late file error"));
    await pending;
    expect(cb.install).not.toHaveBeenCalled();
    expect(cb.error).not.toHaveBeenCalled();
    expect(cb.loading.mock.calls).toEqual([[true]]);
  });

  it("rejects oversized files before reading", async () => {
    const text = vi.fn(), arrayBuffer = vi.fn();
    await expect(readReplayFile({ name: "huge.txt", size: 1e9, text, arrayBuffer })).rejects.toThrow("too large");
    await expect(readReplayFile({ name: "huge.bin", size: 1e9, text, arrayBuffer })).rejects.toThrow("too large");
    expect(text).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("ignores a stale URL conversion and its finally while a newer request is pending", async () => {
    const response = deferred<Response>();
    const next = deferred<string>();
    const fetcher = vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise);
    try {
      const controller = new ReplayImportController();
      const a = callbacks(), b = callbacks();
      const pendingA = controller.load("https://jstris.jezevec10.com/replay/123", a);
      const pendingB = controller.load(() => next.promise, b);
      response.resolve(new Response(fixture));
      await pendingA;
      expect(a.install).not.toHaveBeenCalled();
      expect(a.loading.mock.calls).toEqual([[true]]);
      expect(b.loading.mock.calls).toEqual([[true]]);
      next.resolve(encodeReplayCode(replay("latest")));
      await pendingB;
      expect(b.install.mock.calls[0]?.[0].seed).toBe("latest");
    } finally { fetcher.mockRestore(); }
  });
});
