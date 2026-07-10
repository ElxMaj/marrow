// Minimal ANSI color for the terminal, no dependency (one Postgres, few deps).
// Color turns on only for an interactive terminal, so piped output and --json
// stay byte-clean: `marrow decisions | grep` and every test see plain text, no
// escape codes. NO_COLOR always wins; FORCE_COLOR forces it on (used to verify).
const forced = process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true";
const enabled =
  !process.env.NO_COLOR && process.env.TERM !== "dumb" && (forced || process.stdout.isTTY === true);

const wrap =
  (open: number, close: number) =>
  (s: string): string =>
    enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const red = wrap(31, 39);
export const dim = wrap(2, 22);

export const colorEnabled = (): boolean => enabled;

/**
 * Color a status token the way the whole product reads it: decided is settled
 * (green), open still needs a human (yellow), contested is an active conflict
 * (red), superseded is retired (dim). Run status maps the same way (ok green,
 * error red). This is the single distinction Marrow exists to make, legible at
 * a glance in the terminal instead of a wall of same-weight brackets.
 */
export function colorStatus(status: string): string {
  switch (status) {
    case "decided":
    case "ok":
      return green(status);
    case "open":
    case "warn":
      return yellow(status);
    case "contested":
    case "error":
      return red(status);
    case "superseded":
      return dim(status);
    default:
      return status;
  }
}
