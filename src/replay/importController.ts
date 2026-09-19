import { MAX_REPLAY_INPUT_SIZE, parseReplayInput, type ReplayData } from "./format";
import { importJstrisReplay } from "./jstris";
import { decodeQpcr3Container, QPCR3_MAX_BINARY_SIZE } from "./qpcr3";

export type ReplayImportSource = string | (() => Promise<string | Uint8Array>);

export async function readReplayFile(file: Pick<File, "name" | "size" | "text" | "arrayBuffer">): Promise<string | Uint8Array> {
  if (file.name.toLowerCase().endsWith(".bin")) {
    if (file.size > QPCR3_MAX_BINARY_SIZE) throw new Error("QPCR3 binary file is too large.");
    return new Uint8Array(await file.arrayBuffer());
  }
  if (file.size > MAX_REPLAY_INPUT_SIZE) throw new Error("Replay file is too large.");
  return file.text();
}

export async function parseImportedReplay(raw: string | Uint8Array): Promise<ReplayData> {
  if (raw instanceof Uint8Array) return decodeQpcr3Container(raw);
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_REPLAY_INPUT_SIZE) throw new Error("Replay input is empty or too large.");
  if (trimmed.startsWith("QPCR")) return parseReplayInput(trimmed);
  if (trimmed.startsWith("{")) {
    const value: unknown = JSON.parse(trimmed);
    if (!value || typeof value !== "object") throw new Error("Unsupported replay JSON.");
    // A declared QPCR format must pass its own strict parser, never fall back.
    if ("format" in value) return parseReplayInput(trimmed);
    if (!("c" in value) || !value.c || typeof value.c !== "object"
      || !("d" in value) || typeof value.d !== "string") throw new Error("Unsupported replay JSON.");
  }
  return importJstrisReplay(trimmed);
}

interface ImportCallbacks {
  loading: (loading: boolean) => void;
  install: (data: ReplayData) => void;
  error: (reason: unknown) => void;
}

/** One ordering boundary for text, file reads, binary imports and launch URLs. */
export class ReplayImportController {
  private generation = 0;

  cancel(): void { this.generation += 1; }

  async load(source: ReplayImportSource, callbacks: ImportCallbacks): Promise<void> {
    const generation = ++this.generation;
    callbacks.loading(true);
    try {
      const raw = typeof source === "string" ? source : await source();
      if (generation !== this.generation) return;
      const data = await parseImportedReplay(raw);
      if (generation !== this.generation) return;
      callbacks.install(data);
    } catch (reason) {
      if (generation === this.generation) callbacks.error(reason);
    } finally {
      if (generation === this.generation) callbacks.loading(false);
    }
  }
}
