import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import englishGuideMarkdown from "./SFinder_User_Guide_EN.md?raw";
import koreanGuideMarkdown from "./SFinder_User_Guide_KR.md?raw";
import { renderGuideMarkdown } from "./SfinderGuideApp";

describe("SFinder use guide", () => {
  it("renders the bundled guide headings, examples, and emphasis", () => {
    const html = renderToStaticMarkup(<article>{renderGuideMarkdown(englishGuideMarkdown)}</article>);

    expect(html).toContain("<h1>SFinder Tools User Guide</h1>");
    expect(html).toContain("<h1>PC Solver</h1>");
    expect(html).toContain("<code>*p7</code>");
    expect(html).toContain("*!             alias of *p7");
    expect(html).toContain("<strong>one concrete visible queue</strong>");
    expect(html).toContain("PC Solver currently provides 4L, 5L, and 6L modes");
    expect(html).toContain("this is not a minimum-cover calculation");
    expect(html).not.toContain("<li>Coverage counts</li>");
    expect(html).not.toContain("<h1>Saves</h1>");
    expect(html).not.toContain("<h1>Cover</h1>");
    expect(html).not.toContain("<h1>Congruent</h1>");
    expect(html).not.toContain("<h1>Congruent cover</h1>");
  });

  it("renders the Korean guide with the same public tool scope", () => {
    const html = renderToStaticMarkup(<article>{renderGuideMarkdown(koreanGuideMarkdown)}</article>);

    expect(html).toContain("<h1>SFinder 도구 사용자 가이드</h1>");
    expect(html).toContain("<h1>PC Solver</h1>");
    expect(html).toContain("<code>*p7</code>");
    expect(html).toContain("<strong>하나의 구체적인 큐</strong>");
    expect(html).not.toContain("<h1>Saves</h1>");
    expect(html).not.toContain("<h1>Cover</h1>");
    expect(html).not.toContain("<h1>Congruent</h1>");
    expect(html).not.toContain("<h1>Congruent cover</h1>");
  });
});
