export type ClipboardInput = { kind: "image"; blob: Blob } | { kind: "text"; text: string };

/** Prefer an actual image over a text/HTML representation of the same clipboard. */
export async function readSolverClipboard(clipboard: Pick<Clipboard, "read" | "readText">): Promise<ClipboardInput> {
  if (typeof clipboard.read === "function") {
    const items = await clipboard.read();
    for (const item of items) {
      const type = item.types.find(type => type.startsWith("image/"));
      if (type) return { kind: "image", blob: await item.getType(type) };
    }
    for (const item of items) {
      if (item.types.includes("text/plain")) return { kind: "text", text: await (await item.getType("text/plain")).text() };
    }
    throw new Error("Clipboard has no image or plain text.");
  }
  if (typeof clipboard.readText === "function") return { kind: "text", text: await clipboard.readText() };
  throw new Error("Clipboard reading is not supported in this browser.");
}
