import "./siteHeader.css";
import { SFINDER_MENU_COMMANDS, sfinderCommandPath, type SfinderCommandId } from "../sfinderPages/commands";

type SitePage = "game" | "replay" | "licence" | "sfinder";

const NAV_ITEMS: ReadonlyArray<{ page: SitePage; href: string; label: string }> = [
  { page: "game", href: "/game", label: "Game" },
  { page: "replay", href: "/replay", label: "Replay" },
];

interface SiteHeaderProps {
  active: SitePage;
  sfinderCommand?: SfinderCommandId | "guide" | "solver";
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
            <a href="/sfinder/guide" className={sfinderCommand === "guide" ? "current" : undefined} aria-current={sfinderCommand === "guide" ? "page" : undefined}>
              <strong>Use Guide</strong>
              <small>SFinder tools overview</small>
            </a>
            <div className="site-navigation-dropdown-divider" />
            <a href="/solver" className={sfinderCommand === "solver" ? "current" : undefined} aria-current={sfinderCommand === "solver" ? "page" : undefined}>
              <strong>PC Solver</strong>
              <small>Concrete-queue PC solutions</small>
            </a>
            {SFINDER_MENU_COMMANDS.map((command) => <a
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
        <a
          className={`site-navigation-licence ${active === "licence" ? "active" : ""}`}
          href="/licence"
          aria-current={active === "licence" ? "page" : undefined}
        >Licence</a>
      </div>
    </nav>
  </header>;
}
