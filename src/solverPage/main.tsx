import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteHeader } from "../site/SiteHeader";
import { SolverApp } from "./SolverApp";
import "./solver.css";

createRoot(document.getElementById("root")!).render(<StrictMode>
  <SiteHeader active="sfinder" sfinderCommand="solver" />
  <SolverApp />
</StrictMode>);
