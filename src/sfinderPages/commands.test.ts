import { describe, expect, it } from "vitest";
import {
  defaultWantedSave,
  isSfinderGuideRoute,
  resolveSfinderCommand,
  sfinderCommandPath,
  SFINDER_COMMANDS,
  SFINDER_MENU_COMMANDS,
} from "./commands";

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

  it("recognizes the guide route and local HTML query fallback", () => {
    expect(isSfinderGuideRoute("/sfinder/guide")).toBe(true);
    expect(isSfinderGuideRoute("/sfinder.html", "guide")).toBe(true);
    expect(isSfinderGuideRoute("/sfinder/chance")).toBe(false);
  });

  it("starts Minimals with an empty wanted-save expression", () => {
    expect(defaultWantedSave("minimals")).toBe("");
    expect(defaultWantedSave("saves")).toBe("T");
  });

  it("shows the same pattern-expression example for Minimals and Per-save minimals", () => {
    const placeholders = Object.fromEntries(SFINDER_COMMANDS.map(({ id, patternPlaceholder }) => [id, patternPlaceholder]));
    expect(placeholders.per_save_minimals).toBe(placeholders.minimals);
    expect(placeholders.minimals).toBe("[TILJS]!,*p2");
  });

  it("describes Cover as a coverage check rather than a minimal-cover command", () => {
    expect(SFINDER_COMMANDS.find(({ id }) => id === "cover")?.summary)
      .toBe("Check which queues can build at least one supplied target.");
  });

  it("keeps incomplete Saves and colored-field tools out of the public menu", () => {
    expect(SFINDER_MENU_COMMANDS.map(({ id }) => id)).toEqual([
      "chance",
      "minimals",
      "per_save_minimals",
    ]);
  });
});
