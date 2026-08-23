import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LicenceApp } from "./LicenceApp";
import "./licence.css";

createRoot(document.getElementById("root")!).render(<StrictMode><LicenceApp /></StrictMode>);
