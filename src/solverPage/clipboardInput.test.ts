import { describe, expect, it, vi } from "vitest";
import { readSolverClipboard } from "./clipboardInput";

function item(types: string[]): ClipboardItem {
  return { types, getType: async (type: string) => new Blob([type === "text/plain" ? "v115@vhAAgH" : "image"], { type }) } as unknown as ClipboardItem;
}
describe("Solver clipboard routing", () => {
  it("prefers an image even when plain text is listed first", async () => {
    const result = await readSolverClipboard({ read: async () => [item(["text/plain"]), item(["image/png"])], readText: vi.fn() });
    expect(result.kind).toBe("image");
    if (result.kind === "image") expect(result.blob.type).toBe("image/png");
  });
  it("returns plain text without interpreting it", async () => {
    expect(await readSolverClipboard({ read: async () => [item(["text/plain"])], readText: vi.fn() })).toEqual({ kind: "text", text: "v115@vhAAgH" });
  });
  it("uses readText only when rich clipboard reading is unavailable", async () => {
    expect(await readSolverClipboard({ read: undefined, readText: async () => "fumen URL" } as unknown as Clipboard)).toEqual({ kind: "text", text: "fumen URL" });
  });
  it("does not swallow denied permissions or fall back to another representation", async () => {
    const readText = vi.fn();
    await expect(readSolverClipboard({ read: async () => { throw new Error("Permission denied"); }, readText })).rejects.toThrow("Permission denied");
    expect(readText).not.toHaveBeenCalled();
  });
  it("rejects unsupported and empty rich clipboards", async () => {
    for (const items of [[], [item(["text/html"])]]) {
      await expect(readSolverClipboard({ read: async () => items, readText: vi.fn() })).rejects.toThrow("no image or plain text");
    }
  });
});
