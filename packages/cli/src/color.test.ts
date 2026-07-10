import { afterEach, describe, expect, it, vi } from "vitest";

// `enabled` is computed once at module load from the environment, so each case
// re-imports the module under a stubbed env with vi.resetModules().
describe("cli color", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is byte-clean when not a TTY, so piped output, CI, and --json stay plain", async () => {
    vi.resetModules();
    vi.stubEnv("FORCE_COLOR", "");
    vi.stubEnv("NO_COLOR", "");
    // vitest stdout is not a TTY, so color is off and no escape codes leak.
    const { colorStatus, colorEnabled } = await import("./color.js");
    expect(colorEnabled()).toBe(false);
    for (const s of ["decided", "open", "contested", "superseded", "ok", "error"]) {
      expect(colorStatus(s)).toBe(s);
    }
  });

  it("colors status by meaning when forced on", async () => {
    vi.resetModules();
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("TERM", "xterm");
    const { colorStatus } = await import("./color.js");
    expect(colorStatus("decided")).toBe("\x1b[32mdecided\x1b[39m"); // green: settled
    expect(colorStatus("open")).toBe("\x1b[33mopen\x1b[39m"); // yellow: needs a human
    expect(colorStatus("contested")).toBe("\x1b[31mcontested\x1b[39m"); // red: conflict
    expect(colorStatus("superseded")).toBe("\x1b[2msuperseded\x1b[22m"); // dim: retired
    expect(colorStatus("ok")).toBe("\x1b[32mok\x1b[39m");
    expect(colorStatus("error")).toBe("\x1b[31merror\x1b[39m");
    expect(colorStatus("unknown-status")).toBe("unknown-status"); // passes through
  });

  it("lets NO_COLOR win even when FORCE_COLOR is set", async () => {
    vi.resetModules();
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", "1");
    const { colorStatus, colorEnabled } = await import("./color.js");
    expect(colorEnabled()).toBe(false);
    expect(colorStatus("decided")).toBe("decided");
  });
});
