import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isSfinderGuideRoute, resolveSfinderCommand } from "./commands";
import { SfinderCommandApp } from "./SfinderCommandApp";
import { SfinderGuideApp } from "./SfinderGuideApp";

const search = new URLSearchParams(window.location.search);
const isGuide = isSfinderGuideRoute(window.location.pathname, search.get("command"));
const command = resolveSfinderCommand(window.location.pathname, search.get("command"));
document.title = `${isGuide ? "SFinder Use Guide" : command.label} · QniaPC`;

createRoot(document.getElementById("root")!).render(<StrictMode>
  {isGuide ? <SfinderGuideApp /> : <SfinderCommandApp command={command} />}
</StrictMode>);
