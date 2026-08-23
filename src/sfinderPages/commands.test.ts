import { describe, expect, it } from "vitest";
import { resolveSfinderCommand, sfinderCommandPath, SFINDER_COMMANDS } from "./commands";

describe("SFinder command routes", () => {
  it("keeps every command on a stable detail route", () => {
    expect(SFINDER_COMMANDS.map(({ id }) => sfinderCommandPath(id))).toEqual([
      "/sfinder/chance",
      "/sfinder/saves",
      "/sfinder/minimals",
      "/sfinder/per_save_minimals",
      "/sfinder/cover",
      "/sfinder/congruent_cover",
      "/sfinder/congruent",
    ]);
  });

  it("resolves production paths and the local HTML query fallback", () => {
    expect(resolveSfinderCommand("/sfinder/saves").id).toBe("saves");
    expect(resolveSfinderCommand("/sfinder.html", "cover").id).toBe("cover");
    expect(resolveSfinderCommand("/sfinder/unknown").id).toBe("chance");
  });
});
