import { describe, expect, it, vi } from "vitest";
import { copyText } from "./copyText";

describe("SFinder result clipboard", () => {
  it("writes the complete result Fumen", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await copyText("v115@example", { writeText });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("v115@example");
  });

  it("reports unavailable clipboard access", async () => {
    await expect(copyText("v115@example", undefined)).rejects.toThrow("Clipboard access is unavailable.");
  });
});
