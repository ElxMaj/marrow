import { useCallback, useEffect, useState } from "react";

import { getJSON, Ticking, ThemeToggle } from "./components";
import {
  parseRoute,
  resolveInitialTheme,
  ROUTES,
  type Route,
  type SandboxState,
  type Theme,
} from "./ui";
import { ConnectorsView } from "./views/Connectors";
import { CatchesView } from "./views/Catches";
import { GoalsView } from "./views/Goals";
import { GraphView } from "./views/Graph";
import { IngestView } from "./views/Ingest";
import { ObservabilityView } from "./views/Observability";
import { OverviewView } from "./views/Overview";
import { QuestionsView, type BrainState } from "./views/Questions";
import { SettingsView } from "./views/Settings";

const empty: BrainState = { decisions: [], entities: [], questions: [], readOnly: false };
const THEME_KEY = "marrow-theme";

/** The shared brain, fetched once and threaded to the views that read it. The
 *  Questions view mutates it in place for the read-only sandbox promote; the
 *  rest only read. */
function useBrain(): {
  state: BrainState;
  setState: React.Dispatch<React.SetStateAction<BrainState>>;
  status: "loading" | "ready" | "error";
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<BrainState>(empty);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const refresh = useCallback(async () => {
    setState(await getJSON<BrainState>("/api/state"));
  }, []);
  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      await refresh();
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [refresh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, setState, status, refresh, reload };
}

/** A tiny hash router: `#/connectors` selects a section, browser back/forward
 *  work, and the question loop is just one route. No router dependency. */
function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? "overview" : parseRoute(window.location.hash),
  );
  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`;
    // a section change starts at the top, like turning to a new page.
    window.scrollTo({ top: 0 });
  }, []);
  return [route, navigate];
}

export function App(): JSX.Element {
  const { state, setState, status, refresh, reload } = useBrain();
  const [route, navigate] = useHashRoute();
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    const prefersDark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(resolveInitialTheme(stored, prefersDark));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // private mode / no storage: the choice just does not persist.
      }
      return next;
    });
  }, []);

  const decided = state.decisions.filter((d) => d.status === "decided").length;
  const sandbox: SandboxState = state;

  return (
    <div className="console" data-route={route}>
      <aside className="sidebar">
        <a className="brand" href="https://marrow-six.vercel.app" aria-label="Marrow home">
          <span className="mark" aria-hidden />
          <span className="brand-text">
            <h1>Marrow</h1>
            <span className="tagline">The room, distilled</span>
          </span>
        </a>

        <nav className="nav" aria-label="Sections">
          {ROUTES.map((r) => (
            <button
              key={r}
              className={`nav-item${route === r ? " active" : ""}`}
              onClick={() => navigate(r)}
              aria-current={route === r ? "page" : undefined}
            >
              <NavIcon route={r} />
              <span className="nav-label">{r}</span>
              {r === "questions" && state.questions.length > 0 && (
                <span className="nav-count">{state.questions.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p className="file-line" aria-label="Brain summary">
            <Ticking value={decided} className="n-decided" /> decided ·{" "}
            <Ticking value={state.questions.length} className="n-open" /> open ·{" "}
            <Ticking value={state.entities.length} className="n-muted" /> entities
          </p>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </aside>

      <main className="console-main">
        {state.readOnly && (
          <div className="banner readonly" role="note">
            <p>
              A seeded brain, read only. Answers run in a sandbox and nothing is saved: promote
              something and watch it settle. Run it locally to write: <code>pnpm marrow web</code>
            </p>
          </div>
        )}

        {status === "error" ? (
          <div className="banner error" role="alert">
            <p>Could not reach the brain.</p>
            <button className="btn" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        ) : (
          <Section
            route={route}
            state={state}
            sandbox={sandbox}
            setState={setState}
            status={status}
            refresh={refresh}
            navigate={navigate}
          />
        )}
      </main>
    </div>
  );
}

function Section({
  route,
  state,
  sandbox,
  setState,
  status,
  refresh,
  navigate,
}: {
  route: Route;
  state: BrainState;
  sandbox: SandboxState;
  setState: React.Dispatch<React.SetStateAction<BrainState>>;
  status: "loading" | "ready" | "error";
  refresh: () => Promise<void>;
  navigate: (route: Route) => void;
}): JSX.Element {
  switch (route) {
    case "goals":
      return <GoalsView readOnly={state.readOnly} />;
    case "questions":
      return <QuestionsView state={state} setState={setState} status={status} refresh={refresh} />;
    case "catches":
      return <CatchesView readOnly={state.readOnly} />;
    case "graph":
      return <GraphView state={sandbox} status={status} />;
    case "connectors":
      return <ConnectorsView readOnly={state.readOnly} />;
    case "observability":
      return <ObservabilityView />;
    case "ingest":
      return <IngestView readOnly={state.readOnly} />;
    case "settings":
      return <SettingsView state={sandbox} readOnly={state.readOnly} />;
    case "overview":
    default:
      return <OverviewView state={sandbox} navigate={navigate} />;
  }
}

function NavIcon({ route }: { route: Route }): JSX.Element {
  const common = {
    viewBox: "0 0 20 20",
    width: 17,
    height: 17,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (route) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="6" height="6" rx="1.2" />
          <rect x="11" y="3" width="6" height="6" rx="1.2" />
          <rect x="3" y="11" width="6" height="6" rx="1.2" />
          <rect x="11" y="11" width="6" height="6" rx="1.2" />
        </svg>
      );
    case "goals":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" />
          <circle cx="10" cy="10" r="3" />
          <path d="M10 3v2M10 15v2M3 10h2M15 10h2" />
        </svg>
      );
    case "questions":
      return (
        <svg {...common}>
          <path d="M3 5.5h14M3 10h9M3 14.5h6" />
        </svg>
      );
    case "catches":
      return (
        <svg {...common}>
          <path d="M3 3v7l4 4 4-4 4 4 4-4V3H3z" />
          <path d="M10 10 7 13" />
        </svg>
      );
    case "graph":
      return (
        <svg {...common}>
          <circle cx="5" cy="6" r="2" />
          <circle cx="15" cy="5" r="2" />
          <circle cx="11" cy="14.5" r="2" />
          <path d="M6.7 7.2 9.4 13M13.6 6.4 11.7 12.7M6.9 5.6 13 5.2" />
        </svg>
      );
    case "connectors":
      return (
        <svg {...common}>
          <path d="M8 4.5 5.5 7a3 3 0 0 0 0 4.2L7 12.7M12 15.5 14.5 13a3 3 0 0 0 0-4.2L13 7.3" />
          <path d="M8.5 11.5 11.5 8.5" />
        </svg>
      );
    case "observability":
      return (
        <svg {...common}>
          <path d="M3 13l3.5-5 3 4 2.5-6L15 12l2-3" />
        </svg>
      );
    case "ingest":
      return (
        <svg {...common}>
          <path d="M10 3v8.5M6.5 8 10 11.5 13.5 8" />
          <path d="M4 14.5h12" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4 6h7M15 6h1M4 14h1M9 14h7" />
          <circle cx="13" cy="6" r="2" />
          <circle cx="7" cy="14" r="2" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}
