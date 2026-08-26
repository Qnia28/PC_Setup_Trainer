import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "./SiteHeader";

describe("SFinder navigation", () => {
  it("puts the use guide in the featured slot and groups every tool below it", () => {
    const html = renderToStaticMarkup(<SiteHeader active="sfinder" sfinderCommand="guide" />);
    const guideIndex = html.indexOf("Use Guide");
    const solverIndex = html.indexOf("PC Solver");
    const chanceIndex = html.indexOf("Chance");

    expect(guideIndex).toBeGreaterThan(-1);
    expect(solverIndex).toBeGreaterThan(guideIndex);
    expect(chanceIndex).toBeGreaterThan(solverIndex);
    expect(html.match(/site-navigation-dropdown-divider/g)).toHaveLength(1);
    expect(html).toContain('href="/sfinder/guide" class="current" aria-current="page"');
    expect(html).not.toContain('href="/sfinder/cover"');
    expect(html).not.toContain('href="/sfinder/congruent"');
    expect(html).not.toContain('href="/sfinder/congruent_cover"');
  });
});
