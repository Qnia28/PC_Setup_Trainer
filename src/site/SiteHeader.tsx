import "./siteHeader.css";
import { SFINDER_COMMANDS, sfinderCommandPath, type SfinderCommandId } from "../sfinderPages/commands";

type SitePage = "game" | "replay" | "licence" | "sfinder";

const NAV_ITEMS: ReadonlyArray<{ page: SitePage; href: string; label: string }> = [
  { page: "game", href: "/game", label: "Game" },
  { page: "replay", href: "/replay", label: "Replay" },
  { page: "licence", href: "/licence", label: "Licence" },
];

interface SiteHeaderProps {
  active: SitePage;
  sfinderCommand?: SfinderCommandId | "solver";
}

export function SiteHeader({ active, sfinderCommand }: SiteHeaderProps) {
  return <header className="site-header">
    <nav className="site-navigation" aria-label="Main navigation">
      <a className="site-brand" href="/game" aria-label="QniaPC game">QniaPC</a>
      <div className="site-navigation-links">
        {NAV_ITEMS.map((item) => <a
          key={item.page}
          href={item.href}
          className={active === item.page ? "active" : undefined}
          aria-current={active === item.page ? "page" : undefined}
        >{item.label}</a>)}
        <details className={`site-navigation-menu ${active === "sfinder" ? "active" : ""}`}>
          <summary>SFinder <span aria-hidden="true">▾</span></summary>
          <div className="site-navigation-dropdown">
            <a href="/solver" className={sfinderCommand === "solver" ? "current" : undefined} aria-current={sfinderCommand === "solver" ? "page" : undefined}>
              <strong>PC Solver</strong>
              <small>Interactive 4-line solver</small>
            </a>
            <div className="site-navigation-dropdown-divider" />
            {SFINDER_COMMANDS.map((command) => <a
              key={command.id}
              href={sfinderCommandPath(command.id)}
              className={sfinderCommand === command.id ? "current" : undefined}
              aria-current={sfinderCommand === command.id ? "page" : undefined}
            >
              <strong>{command.label}</strong>
              <small>{command.id}</small>
            </a>)}
          </div>
        </details>
      </div>
    </nav>
  </header>;
}
