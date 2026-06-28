import { createRoot } from "react-dom/client";

// self-hosted variable fonts (OFL, bundled by vite — no Google Fonts hotlink).
// Fraunces carries the editorial/decided voice (full axis: opsz/SOFT/WONK),
// Geist is the UI workhorse, Geist Mono is the provenance voice.
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";

import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
