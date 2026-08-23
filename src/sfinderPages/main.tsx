import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { resolveSfinderCommand } from "./commands";
import { SfinderCommandApp } from "./SfinderCommandApp";

const search = new URLSearchParams(window.location.search);
const command = resolveSfinderCommand(window.location.pathname, search.get("command"));
document.title = `${command.label} · QniaPC`;

createRoot(document.getElementById("root")!).render(<StrictMode>
  <SfinderCommandApp command={command} />
</StrictMode>);
