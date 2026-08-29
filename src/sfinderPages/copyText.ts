export interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

export async function copyText(
  value: string,
  clipboard: ClipboardWriter | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<void> {
  if (!clipboard) throw new Error("Clipboard access is unavailable.");
  await clipboard.writeText(value);
}
