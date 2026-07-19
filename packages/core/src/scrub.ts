// Secrets must be caught BEFORE the append: evidence is immutable by design,
// so an API key that reaches the insert is frozen in the brain forever. This
// pure module detects the common credential shapes and replaces each match
// with a stable placeholder; the Store runs it on every evidence insert, which
// is the single choke point every writer (ingest, connector sync, answers)
// goes through. The placeholder makes the alteration visible: evidence stays a
// faithful record of the room, minus the bytes nobody should ever replay.

export interface ScrubFinding {
  kind: string;
  count: number;
}

export interface ScrubResult {
  text: string;
  findings: ScrubFinding[];
  total: number;
}

// Fixed, conservative detectors. Each is anchored to a vendor prefix or an
// unambiguous format so ordinary product talk never matches; the generic
// assignment rule additionally requires a digit in the value, because real
// credentials have digits and placeholder prose ("your-key-goes-here") does not.
const DETECTORS: { kind: string; pattern: RegExp }[] = [
  { kind: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    kind: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { kind: "provider-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  // Stripe and Stripe-style secret/restricted keys use an underscore family
  // (sk_live_, sk_test_, rk_live_, rk_test_), which the sk- rule above misses.
  { kind: "provider-key", pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}\b/g },
];

// PEM private-key blocks are handled separately, not as a DETECTOR regex. The
// obvious /BEGIN...[\s\S]*?...END/ is O(n^2) on input that repeats a BEGIN
// header with no matching END: each header lazily scans to end-of-string
// looking for an END that never comes. A crafted multi-MB blob of BEGIN lines
// turns one evidence insert into a multi-second event-loop stall, denying every
// concurrent request the single Node process serves. This scanner is linear: it
// finds each BEGIN header, then jumps to the next END header by index. Both
// lastIndex cursors only move forward, so total work is O(n).
const PK_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const PK_END = /-----END [A-Z ]*PRIVATE KEY-----/g;

function redactPrivateKeys(text: string, counts: Map<string, number>): string {
  // Cheap reject: no header marker at all means nothing can match.
  if (!text.includes("PRIVATE KEY-----")) return text;
  PK_BEGIN.lastIndex = 0;
  let out = "";
  let copied = 0; // text up to here is already in `out`
  let begin: RegExpExecArray | null;
  while ((begin = PK_BEGIN.exec(text)) !== null) {
    PK_END.lastIndex = PK_BEGIN.lastIndex; // search for END after the BEGIN header
    const end = PK_END.exec(text);
    if (!end) break; // no closing END ahead: no further block can complete
    const blockEnd = end.index + end[0].length;
    out += text.slice(copied, begin.index) + "[redacted:private-key]";
    counts.set("private-key", (counts.get("private-key") ?? 0) + 1);
    copied = blockEnd;
    PK_BEGIN.lastIndex = blockEnd; // resume the BEGIN scan past the whole block
  }
  return out + text.slice(copied);
}

// key: value / key = value assignments where the value looks like a credential.
// The key name survives so the record still says what was shared, without the
// replayable bytes. Requires a digit in the value to spare placeholder prose.
const ASSIGNMENT =
  /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)(["']?)([A-Za-z0-9+/_.=-]{12,})\3/gi;

/** Whether scrubbing is active. MARROW_SCRUB=off is the explicit opt-out for
 *  brains that must store credentials verbatim (not recommended). */
export function scrubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MARROW_SCRUB !== "off";
}

/** Replace credential-shaped spans with [redacted:kind] placeholders.
 *  Idempotent: placeholders contain no credential shapes, so a second pass
 *  changes nothing. */
export function scrubSecrets(text: string): ScrubResult {
  const counts = new Map<string, number>();
  let out = redactPrivateKeys(text, counts);
  for (const { kind, pattern } of DETECTORS) {
    out = out.replace(pattern, () => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      return `[redacted:${kind}]`;
    });
  }
  out = out.replace(ASSIGNMENT, (whole, key: string, sep: string, quote: string, value: string) => {
    if (!/\d/.test(value)) return whole;
    counts.set("credential", (counts.get("credential") ?? 0) + 1);
    return `${key}${sep}${quote}[redacted:credential]${quote}`;
  });
  const findings = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  return {
    text: out,
    findings,
    total: findings.reduce((sum, finding) => sum + finding.count, 0),
  };
}
