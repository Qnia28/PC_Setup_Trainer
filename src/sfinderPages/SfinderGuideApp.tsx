import { createElement, Fragment, useState, type ReactNode } from "react";
import englishGuideMarkdown from "./SFinder_User_Guide_EN.md?raw";
import koreanGuideMarkdown from "./SFinder_User_Guide_KR.md?raw";
import { SiteHeader } from "../site/SiteHeader";
import "./sfinderGuide.css";

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.flatMap((token, index): ReactNode[] => {
    if (!token) return [];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**") && token.endsWith("**")) {
      return [<strong key={key}>{token.slice(2, -2)}</strong>];
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return [<code key={key}>{token.slice(1, -1)}</code>];
    }
    return [<Fragment key={key}>{token}</Fragment>];
  });
}

function paragraphContents(lines: string[], keyPrefix: string): ReactNode[] {
  return lines.flatMap((line, index): ReactNode[] => {
    const hardBreak = line.endsWith("  ");
    const nodes = inlineMarkdown(line.trimEnd(), `${keyPrefix}-${index}`);
    if (index === lines.length - 1) return nodes;
    return [...nodes, hardBreak ? <br key={`${keyPrefix}-break-${index}`} /> : " "];
  });
}

export function renderGuideMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const blockKey = `guide-block-${index}`;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(createElement(`h${level}`, { key: blockKey }, inlineMarkdown(heading[2]!, blockKey)));
      index += 1;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push(<hr key={blockKey} />);
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={blockKey}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={blockKey}>{paragraphContents(quote, blockKey)}</blockquote>);
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^-\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={blockKey}>{items.map((item, itemIndex) =>
        <li key={`${blockKey}-${itemIndex}`}>{inlineMarkdown(item, `${blockKey}-${itemIndex}`)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={blockKey}>{items.map((item, itemIndex) =>
        <li key={`${blockKey}-${itemIndex}`}>{inlineMarkdown(item, `${blockKey}-${itemIndex}`)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index]!;
      if (!candidate.trim() || /^(#{1,6})\s+|^```|^>\s?|^-\s+|^\d+\.\s+/.test(candidate) || candidate.trim() === "---") break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push(<p key={blockKey}>{paragraphContents(paragraph, blockKey)}</p>);
  }

  return blocks;
}

export function SfinderGuideApp() {
  const [language, setLanguage] = useState<"en" | "ko">("en");
  const guideMarkdown = language === "en" ? englishGuideMarkdown : koreanGuideMarkdown;

  return <>
    <SiteHeader active="sfinder" sfinderCommand="guide" />
    <main className="sfinder-guide-shell">
      <article className="sfinder-guide-document" lang={language}>
        <nav className="sfinder-guide-languages" aria-label="Guide language">
          <button type="button" className={language === "en" ? "selected" : undefined} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
          <button type="button" className={language === "ko" ? "selected" : undefined} aria-pressed={language === "ko"} onClick={() => setLanguage("ko")}>KR</button>
        </nav>
        {renderGuideMarkdown(guideMarkdown)}
      </article>
    </main>
  </>;
}
