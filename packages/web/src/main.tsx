import { createRoot } from "react-dom/client";

// self-hosted variable fonts (OFL, bundled by vite — no Google Fonts hotlink).
// Archivo carries the display/decided voice (wght + wdth, the width axis
// plants the headlines), Geist is the UI workhorse, Geist Mono is the
// provenance voice.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";

import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
