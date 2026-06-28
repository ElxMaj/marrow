import { type RunKind } from "@marrowhq/shared";

import { type RunDraft, type Store } from "./store.js";

// Observability without a second system. Every model, retrieval, drift, and
// connector operation is wrapped in traced(), which writes one append-only run
// to the same Postgres. This is the Langfuse-shaped value (latency, tokens,
// cost, errors, a trace you can read) on one store, no extra infra.

/** What an instrumented operation reports back so the run is rich. All fields
 *  optional: a keyword search reports a count, a model call reports tokens. */
export interface RunReport {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  inputSummary?: string;
  outputSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceSpec {
  kind: RunKind;
  label?: string | undefined;
  parentId?: string | undefined;
}

// Approximate public list prices, USD per million tokens, keyed by a substring
// of the model id. Used ONLY to estimate the cost of a run for the dashboard.
// It is an estimate, never a bill, and an unknown model returns undefined so the
// UI shows "unknown" instead of a misleading zero. Update as prices change.
const PRICE_PER_MTOK: { match: RegExp; in: number; out: number }[] = [
  { match: /opus/i, in: 15, out: 75 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /haiku/i, in: 0.8, out: 4 },
  { match: /4o-mini|4\.1-mini|o4-mini/i, in: 0.15, out: 0.6 },
  { match: /gpt-4o|gpt-4\.1|gpt-4-/i, in: 2.5, out: 10 },
  { match: /gpt-3\.5/i, in: 0.5, out: 1.5 },
];

/**
 * Estimate the USD cost of a completion from its model id and token counts.
 * Returns undefined when the model is unknown or unpriced: an honest "we do not
 * know" beats a fabricated zero. Never used for billing, only for the dashboard.
 */
export function estimateCostUsd(
  model: string | undefined,
  tokensIn = 0,
  tokensOut = 0,
): number | undefined {
  if (!model) return undefined;
  const price = PRICE_PER_MTOK.find((p) => p.match.test(model));
  if (!price) return undefined;
  return (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
}

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

function draftFrom(
  spec: TraceSpec,
  status: "ok" | "error",
  latencyMs: number,
  report: RunReport,
  error?: string,
): RunDraft {
  const costUsd =
    report.costUsd ?? estimateCostUsd(report.model, report.tokensIn ?? 0, report.tokensOut ?? 0);
  return {
    kind: spec.kind,
    status,
    label: spec.label,
    parentId: spec.parentId,
    model: report.model,
    tokensIn: report.tokensIn,
    tokensOut: report.tokensOut,
    costUsd,
    latencyMs,
    inputSummary: report.inputSummary,
    outputSummary: report.outputSummary,
    error,
    metadata: report.metadata,
  };
}

async function safeRecord(store: Pick<Store, "recordRun">, draft: RunDraft): Promise<void> {
  try {
    await store.recordRun(draft);
  } catch {
    // telemetry is best-effort: a failure to record a run must never mask the
    // real result or the real error of the wrapped operation.
  }
}

/**
 * Run an async operation and record exactly one run for it. Measures latency,
 * captures whatever the operation reports through the `report` callback, and
 * writes status 'ok' on success or 'error' (with the message) on throw, then
 * rethrows. The operation's own result and errors pass through untouched.
 */
export async function traced<T>(
  store: Pick<Store, "recordRun">,
  spec: TraceSpec,
  fn: (report: (r: RunReport) => void) => Promise<T>,
): Promise<T> {
  const start = nowMs();
  let acc: RunReport = {};
  const report = (r: RunReport): void => {
    acc = { ...acc, ...r };
  };
  try {
    const result = await fn(report);
    await safeRecord(store, draftFrom(spec, "ok", nowMs() - start, acc));
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeRecord(store, draftFrom(spec, "error", nowMs() - start, acc, message));
    throw err;
  }
}
