// Small pure helpers for the question-loop view. No DOM, no fetch: just the few
// real decisions about how the brain is presented, kept testable in isolation.

export type Theme = "dark" | "light";

// The console's client-side routes. A tiny hash router (no router dependency)
// maps `#/connectors` to a section; the question loop is just one of them.
export type Route =
  | "overview"
  | "goals"
  | "questions"
  | "catches"
  | "graph"
  | "connectors"
  | "observability"
  | "ingest"
  | "settings";

export const ROUTES: Route[] = [
  "overview",
  "goals",
  "questions",
  "catches",
  "graph",
  "connectors",
  "observability",
  "ingest",
  "settings",
];

/** Read a route from a location hash, defaulting to overview for anything
 *  unrecognised (including the empty hash on first load). */
export function parseRoute(hash: string): Route {
  const slug = hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
  return (ROUTES as string[]).includes(slug) ? (slug as Route) : "overview";
}

/** A one-line label for each section, for the sidebar nav. */
export function routeLabel(route: Route): string {
  return route;
}

// View types matching the /api shape. The web holds no logic, only types.
export interface Provenance {
  evidenceId: string;
  start: number;
  end: number;
}
export interface Confidence {
  value: number;
  source: "model" | "human";
}
export interface Decision {
  id: string;
  kind: "decision";
  title: string;
  rationale: string;
  constraint: boolean;
  status: string;
  confidence: Confidence;
  provenance: Provenance[];
}
export interface Entity {
  id: string;
  kind: "entity";
  name: string;
  description?: string;
  status: string;
  confidence: Confidence;
  provenance: Provenance[];
}
export interface Question {
  id: string;
  kind: "question";
  prompt: string;
  relatesTo?: string[];
  status: string;
  confidence: Confidence;
  provenance: Provenance[];
}
/**
 * A goal as the Goals space renders it: a target the room committed to, split
 * into product goals (what the product must do) and user goals (what a user
 * must be able to do). `entityName` is the resolved name of the entity the goal
 * serves, joined server-side for display; the structural link is `entityId`.
 * Status/confidence/provenance carry the same decided-vs-open trust as any node.
 */
export interface GoalView {
  id: string;
  kind: "goal";
  title: string;
  description?: string;
  goalType: "product" | "user";
  entityId?: string;
  entityName?: string;
  status: string;
  confidence: Confidence;
  provenance: Provenance[];
}
export interface SandboxState {
  decisions: Decision[];
  entities: Entity[];
  questions: Question[];
  readOnly?: boolean;
}

export interface SandboxResult {
  state: SandboxState;
  promotedIds: string[];
  supersededIds: string[];
}

/**
 * The read-only demo's promote, run client-side and unpersisted. Mirrors the
 * server's answer() semantics exactly: the single related node (or the chosen
 * side of a conflict) is promoted to decided with a human confidence and one
 * more provenance span (the answer), the unchosen decisions are superseded,
 * and both sides of a conflict are never promoted. Returns null when the
 * answer cannot be recorded (unknown question, or a conflict with no side
 * chosen), so the caller can surface the same error the server would.
 */
export function sandboxPromote(
  state: SandboxState,
  questionId: string,
  answerText: string,
  decide?: string,
): SandboxResult | null {
  const question = state.questions.find((q) => q.id === questionId);
  if (!question) return null;

  const ids = new Set(question.relatesTo ?? []);
  const related: (Decision | Entity)[] = [
    ...state.decisions.filter((d) => ids.has(d.id)),
    ...state.entities.filter((e) => ids.has(e.id)),
  ];

  let toPromote: (Decision | Entity)[];
  let toSupersede: (Decision | Entity)[] = [];
  if (decide !== undefined) {
    const chosen = related.find((n) => n.id === decide);
    if (!chosen) return null;
    toPromote = [chosen];
    toSupersede = related.filter((n) => n.id !== decide && n.kind === "decision");
  } else if (related.length <= 1) {
    toPromote = related;
  } else {
    return null;
  }

  const promotedIds = new Set(toPromote.map((n) => n.id));
  const supersededIds = new Set(toSupersede.map((n) => n.id));
  const answerSpan: Provenance = { evidenceId: "ev_sandbox", start: 0, end: answerText.length };

  function settle<T extends Decision | Entity>(node: T): T {
    if (promotedIds.has(node.id)) {
      return {
        ...node,
        status: "decided",
        confidence: { value: 1, source: "human" as const },
        provenance: [...node.provenance, answerSpan],
      };
    }
    if (supersededIds.has(node.id)) return { ...node, status: "superseded" };
    return node;
  }

  return {
    state: {
      ...state,
      decisions: state.decisions.map(settle),
      entities: state.entities.map(settle),
      questions: state.questions.filter((q) => q.id !== questionId),
    },
    promotedIds: [...promotedIds],
    supersededIds: [...supersededIds],
  };
}

/**
 * Which theme to boot into. An explicit stored choice wins; otherwise we follow
 * the OS. Default is dark on purpose: warm bone-black is Marrow's hero surface.
 */
export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark ? "dark" : "light";
}

/**
 * Bucket a node's provenance density into a 1..3 weight so the gold provenance
 * rule can thicken with the evidence behind a fact. A fact backed by nine spans
 * should visibly out-weigh one backed by a single span: trust you can scan.
 */
export function provenanceWeight(spanCount: number): 1 | 2 | 3 {
  if (spanCount <= 1) return 1;
  if (spanCount <= 3) return 2;
  return 3;
}

/** A confidence value rendered for the mono voice: always two decimals so the
 *  column aligns under tabular figures (0.82, 1.00). */
export function formatConfidence(value: number): string {
  return value.toFixed(2);
}

/** A confidence value as a whole-percent meter width (0..100). */
export function confidencePct(value: number): number {
  return Math.round(value * 100);
}

/**
 * A long evidence/node id shortened to its kind prefix plus the first eight hex
 * of the uuid (ev_aabe4c3f), stable and recognisable; the full id stays visible
 * in the trace panel where it can be copied.
 */
export function shortId(id: string): string {
  const underscore = id.indexOf("_");
  if (underscore === -1) return id.slice(0, 10);
  const prefix = id.slice(0, underscore);
  const rest = id.slice(underscore + 1).replace(/-/g, "");
  return `${prefix}_${rest.slice(0, 8)}`;
}

export type CopyTextResult = "clipboard" | "selection" | "none";

export interface CopyTextEnvironment {
  clipboard?: { writeText(text: string): Promise<void> | void };
  clipboardTimeoutMs?: number;
  selection?: { removeAllRanges(): void; addRange(range: unknown): void } | null;
  createRange?: () => unknown;
  selectRangeContents?: (range: unknown, target: unknown) => void;
}

function browserCopyEnvironment(): CopyTextEnvironment {
  const clipboard =
    typeof navigator !== "undefined" && navigator.clipboard ? navigator.clipboard : undefined;
  const selection =
    typeof window !== "undefined" && typeof window.getSelection === "function"
      ? window.getSelection()
      : null;
  const createRange =
    typeof document !== "undefined" && typeof document.createRange === "function"
      ? () => document.createRange()
      : undefined;
  const env: CopyTextEnvironment = {
    selection,
    selectRangeContents: (range, target) => {
      (range as Range).selectNodeContents(target as Node);
    },
  };
  if (clipboard) env.clipboard = clipboard;
  if (createRange) env.createRange = createRange;
  return env;
}

/**
 * Copy visible text, falling back to selecting it when clipboard access is
 * denied. That keeps the affordance useful in browsers and embedded previews
 * that block navigator.clipboard.
 */
export async function copyTextWithFallback(
  text: string,
  target: unknown | null | undefined,
  env: CopyTextEnvironment = browserCopyEnvironment(),
): Promise<CopyTextResult> {
  try {
    if (env.clipboard) {
      const wrote = await clipboardWriteWithTimeout(
        env.clipboard.writeText(text),
        env.clipboardTimeoutMs ?? 500,
      );
      if (wrote) return "clipboard";
    }
  } catch {
    // fall through to selecting the visible text.
  }

  const range = env.createRange?.();
  if (!target || !range || !env.selection || !env.selectRangeContents) return "none";

  try {
    env.selectRangeContents(range, target);
    env.selection.removeAllRanges();
    env.selection.addRange(range);
    return "selection";
  } catch {
    return "none";
  }
}

function clipboardWriteWithTimeout(
  result: Promise<void> | void,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    void Promise.resolve(result).then(
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
      () => {
        clearTimeout(timeout);
        resolve(false);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Console view types + formatting. The web holds no logic, only types: these
// mirror the /api JSON the console endpoints return (runs, metrics, connectors,
// evidence). Formatting is presentation, not product logic.
// ---------------------------------------------------------------------------

export type RunKind = "distill" | "search" | "drift" | "connector_sync" | "ingest";
export type RunStatus = "ok" | "error";

export interface RunView {
  id: string;
  kind: RunKind;
  status: RunStatus;
  label?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs: number;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RunKindMetrics {
  count: number;
  errorCount: number;
  costUsd: number;
  avgLatencyMs: number;
}
export interface MetricsView {
  count: number;
  errorCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  byKind: Record<string, RunKindMetrics>;
}

export interface ConnectorView {
  name: string;
  kind: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  hasSecret: boolean;
  lastStatus: "ok" | "error" | "never";
  lastRunAt?: string;
  lastError?: string;
  itemsLastRun?: number;
  totalItems: number;
  createdAt?: string;
  updatedAt: string;
}

export interface EvidenceView {
  id: string;
  source: string;
  createdAt: string;
  preview: string;
  chars: number;
}

export const RUN_KINDS: RunKind[] = ["distill", "search", "drift", "connector_sync", "ingest"];

/** The kinds the connector factory knows, for the "add connector" picker. */
export const CONNECTOR_KINDS = [
  "slack",
  "github",
  "linear",
  "notion",
  "figma",
  "zoom",
  "intercom",
  "email",
  "teams",
  "jira",
  "granola",
  "otter",
] as const;

/** A short human label for a run kind. */
export function runKindLabel(kind: string): string {
  return kind === "connector_sync" ? "sync" : kind;
}

/** A 2-letter monogram tile label for a connector kind. honest and lean: no
 *  icon library, no brand-logo hotlinking, on the bone palette. */
export function connectorMonogram(kind: string): string {
  const map: Record<string, string> = {
    slack: "Sl",
    github: "Gh",
    linear: "Ln",
    notion: "No",
    figma: "Fi",
    zoom: "Zo",
    intercom: "Ic",
    email: "Em",
    teams: "Te",
    jira: "Ji",
    granola: "Gr",
    otter: "Ot",
  };
  return map[kind] ?? kind.slice(0, 2).replace(/^\w/, (c) => c.toUpperCase());
}

/** A one-line description of what a connector pulls, for the card sub-text. */
export function connectorBlurb(kind: string): string {
  const map: Record<string, string> = {
    slack: "channels and threads",
    github: "issues and discussions",
    linear: "issues and project updates",
    notion: "pages and databases",
    figma: "file comments",
    zoom: "meeting transcripts",
    intercom: "support conversations",
    email: "watched inbox",
    teams: "channel messages",
    jira: "tickets and comments",
    granola: "meeting notes",
    otter: "meeting transcripts",
  };
  return map[kind] ?? "connected source";
}

/** Whole-dollar-aware USD: small model costs read as $0.42 or $12.80; larger
 *  ones round sensibly. always a leading $, tabular friendly. */
export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Token counts: 1.2k, 18.4k, 1.1M. tabular, compact. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Latency: 42ms, 1.8s, 1.0m. */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** A compact relative time: "just now", "8m ago", "3h ago", "2d ago", else a
 *  date. pure: takes an explicit now so it is testable. */
export function timeAgo(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The error rate as a whole percent (0..100), or 0 when there are no runs. */
export function errorRate(count: number, errorCount: number): number {
  if (count <= 0) return 0;
  return Math.round((errorCount / count) * 100);
}

/** Sum the items a connector_sync run reported ingesting, from its metadata.
 *  used by the overview "catches this week" tally. */
export function syncItems(metadata: Record<string, unknown> | undefined): number {
  const v = metadata?.itemsIngested;
  return typeof v === "number" ? v : 0;
}

/**
 * Total items connectors brought in since `sinceMs`, summed over successful
 * connector_sync runs. This is connector throughput — NOT drift catches, which
 * are a separate concept (see the Catches view). The Overview "items this week"
 * stat uses this; mislabelling it "catches" was the bug (F-WEB / Overview card).
 */
export function itemsIngestedSince(syncRuns: RunView[], sinceMs: number): number {
  return syncRuns
    .filter((s) => s.status === "ok" && new Date(s.createdAt).getTime() >= sinceMs)
    .reduce((n, s) => n + syncItems(s.metadata), 0);
}

// ---------------------------------------------------------------------------
// Catches view: drift detection receipts
// ---------------------------------------------------------------------------

/** A drift catch receipt as rendered in the Catches view. joins the catch_event
 *  with the decided node it violated and the hunk text for display. */
export interface CatchView {
  id: string; // the question id (drift question)
  status: "open" | "acted-on" | "dismissed";
  decisionId: string;
  decisionTitle: string;
  decisionSourceLabel: string; // e.g. "3 evidence spans"
  path: string | undefined; // file path from diff_span
  lineStart: number | undefined;
  lineEnd: number | undefined;
  hunkText: string; // the actual code hunk that triggered the catch
  verdict: "warn" | "contradiction"; // derived from confidence
  confidence: number;
  modelUsed: string | undefined;
  surfacedAt: string; // when the catch was created
  trigger: string; // "manual", "pre-commit", etc.
}

/** Aggregate catch metrics for the header strip. */
export interface CatchMetricsView {
  surfaced: number;
  actedOn: number;
  dismissed: number;
  precision: number; // 0..1
  dismissRate: number; // 0..1
}

/** A human label for the catch verdict. */
export function verdictLabel(verdict: "warn" | "contradiction"): string {
  return verdict === "contradiction" ? "contradiction" : "likely conflict";
}

/**
 * The request body for a catch action. The server's accept route expects
 * { resolution } and the dismiss route expects { reason } (see api.ts), so the
 * field name has to follow the action — otherwise a dismiss 400s ("reason is
 * required") even when the user typed one.
 */
export function catchActionBody(
  action: "accept" | "dismiss",
  text: string,
): { resolution: string } | { reason: string } {
  return action === "accept" ? { resolution: text } : { reason: text };
}

/**
 * Whether a catch can be accepted/dismissed. Only open catches are actionable,
 * and that is true regardless of which filter tab is showing — an open catch in
 * the "all" tab must still offer its actions.
 */
export function canActOnCatch(status: CatchView["status"]): boolean {
  return status === "open";
}

/** A short label for the catch status. */
export function catchStatusLabel(status: CatchView["status"]): string {
  switch (status) {
    case "open":
      return "open";
    case "acted-on":
      return "acted on";
    case "dismissed":
      return "dismissed";
    default:
      return "unknown";
  }
}
