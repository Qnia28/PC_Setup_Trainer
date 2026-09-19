import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DictionaryApp } from "./DictionaryApp";
import "./dictionary.css";

createRoot(document.getElementById("root")!).render(<StrictMode><DictionaryApp /></StrictMode>);
