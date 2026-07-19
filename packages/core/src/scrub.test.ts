import { describe, expect, it } from "vitest";

import { scrubEnabled, scrubSecrets } from "./scrub.js";

describe("scrubSecrets", () => {
  it("redacts the common credential shapes", () => {
    const text = [
      "aws: AKIAIOSFODNN7EXAMPLE",
      "github: ghp_abcDEF1234567890abcDEF1234567890",
      "openai-style: sk-proj-abc123DEF456ghi789",
      "slack: xoxb-1234567890-abcdefghij",
      "jwt: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P",
    ].join("\n");
    const result = scrubSecrets(text);
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.text).not.toContain("ghp_");
    expect(result.text).not.toContain("sk-proj");
    expect(result.text).not.toContain("xoxb-1234567890");
    expect(result.text).not.toContain("eyJhbGciOiJIUzI1NiJ9.");
    expect(result.text).toContain("[redacted:aws-access-key]");
    expect(result.text).toContain("[redacted:github-token]");
    expect(result.text).toContain("[redacted:provider-key]");
    expect(result.text).toContain("[redacted:slack-token]");
    expect(result.text).toContain("[redacted:jwt]");
    expect(result.total).toBe(5);
  });

  it("redacts Stripe-style underscore secret keys the sk- rule would miss", () => {
    // build the fixtures by concatenation so the source file carries no
    // contiguous key literal for push-protection secret scanners to flag.
    const body = "AbCdEfGhIjKlMnOpQrStUvWx"; // 24 chars, matches {16,}
    const skLive = `sk_live_${body}`;
    const skTest = `sk_test_${body}`;
    const rkLive = `rk_live_${body}`;
    const text = `stripe secret: ${skLive}\nstripe test: ${skTest}\nrestricted: ${rkLive}`;
    const result = scrubSecrets(text);
    expect(result.text).not.toContain(skLive);
    expect(result.text).not.toContain(skTest);
    expect(result.text).not.toContain(rkLive);
    expect(result.text).not.toContain(body);
    expect(result.text).toContain("[redacted:provider-key]");
    expect(result.total).toBe(3);
  });

  it("redacts PEM private key blocks whole", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\nmore lines\n-----END RSA PRIVATE KEY-----`;
    const result = scrubSecrets(`the key was pasted:\n${pem}\nend of paste`);
    expect(result.text).not.toContain("MIIEpAIBAAKCAQEA7");
    expect(result.text).toContain("[redacted:private-key]");
    expect(result.text).toContain("end of paste");
  });

  it("redacts multiple PEM blocks and keeps the text between them", () => {
    const block = (n: number) =>
      `-----BEGIN RSA PRIVATE KEY-----\nBODY${n}0000lines\n-----END RSA PRIVATE KEY-----`;
    const text = `first:\n${block(1)}\nmiddle prose\n${block(2)}\nlast prose`;
    const result = scrubSecrets(text);
    expect(result.text).not.toContain("BODY10000");
    expect(result.text).not.toContain("BODY20000");
    expect(result.text).toContain("middle prose");
    expect(result.text).toContain("last prose");
    expect(result.findings).toEqual([{ kind: "private-key", count: 2 }]);
  });

  it("stays linear (not O(n^2)) on a crafted BEGIN-repeat blob with no END", () => {
    // The old lazy /BEGIN...[\s\S]*?...END/ scanned to end-of-string once per
    // header looking for an END that never comes, so this ~2MB input took
    // multiple seconds and stalled the single event loop. With no closing END no
    // block completes, so the linear scanner leaves the text untouched, fast.
    const blob = "-----BEGIN A PRIVATE KEY-----\n".repeat(70_000);
    const started = performance.now();
    const result = scrubSecrets(blob);
    const elapsedMs = performance.now() - started;
    expect(result.text).toBe(blob);
    expect(result.total).toBe(0);
    expect(elapsedMs).toBeLessThan(2000); // old code: several seconds
  });

  it("redacts credential assignments but keeps the key name", () => {
    const result = scrubSecrets('the config had password = "hunter2hunter42" in it');
    expect(result.text).toContain('password = "[redacted:credential]"');
    expect(result.text).not.toContain("hunter2hunter42");
    expect(result.findings).toEqual([{ kind: "credential", count: 1 }]);
  });

  it("leaves ordinary product talk and placeholder prose untouched", () => {
    const text = [
      "we decided soft delete is recoverable for 30 days",
      "set api_key: your-key-goes-here before running",
      "the token budget for prepare_task stays capped",
      "password reset emails go through the magic link flow",
    ].join("\n");
    const result = scrubSecrets(text);
    expect(result.text).toBe(text);
    expect(result.total).toBe(0);
  });

  it("is idempotent: placeholders never re-match", () => {
    const once = scrubSecrets("aws AKIAIOSFODNN7EXAMPLE leaked");
    const twice = scrubSecrets(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.total).toBe(0);
  });

  it("scrubEnabled honors the MARROW_SCRUB=off escape hatch", () => {
    expect(scrubEnabled({})).toBe(true);
    expect(scrubEnabled({ MARROW_SCRUB: "off" })).toBe(false);
    expect(scrubEnabled({ MARROW_SCRUB: "anything-else" })).toBe(true);
  });
});
