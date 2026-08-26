import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import guideMarkdown from "./SFinder_User_Guide_EN.md?raw";
import { renderGuideMarkdown } from "./SfinderGuideApp";

describe("SFinder use guide", () => {
  it("renders the bundled guide headings, examples, and emphasis", () => {
    const html = renderToStaticMarkup(<article>{renderGuideMarkdown(guideMarkdown)}</article>);

    expect(html).toContain("<h1>SFinder Tools User Guide</h1>");
    expect(html).toContain("<h1>PC Solver</h1>");
    expect(html).toContain("<code>*p7</code>");
    expect(html).toContain("*!             alias of *p7");
    expect(html).toContain("<strong>one concrete visible queue</strong>");
    expect(html).toContain("PC Solver currently provides 4L, 5L, and 6L modes");
    expect(html).toContain("this is not a minimum-cover calculation");
    expect(html).not.toContain("<li>Coverage counts</li>");
    expect(html).not.toContain("<h1>Cover</h1>");
    expect(html).not.toContain("<h1>Congruent</h1>");
    expect(html).not.toContain("<h1>Congruent cover</h1>");
  });
});
