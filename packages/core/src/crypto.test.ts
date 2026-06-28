import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./crypto.js";

const KEY = "test-secret-key-please-change-in-prod";

describe("connector secret crypto", () => {
  it("round-trips a secret with the same key", () => {
    const cipher = encryptSecret("xoxb-super-secret-token", KEY);
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(cipher).not.toContain("xoxb-super-secret-token");
    expect(decryptSecret(cipher, KEY)).toBe("xoxb-super-secret-token");
  });

  it("produces different ciphertext each time (random iv)", () => {
    const a = encryptSecret("same", KEY);
    const b = encryptSecret("same", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe("same");
    expect(decryptSecret(b, KEY)).toBe("same");
  });

  it("fails with the wrong key (GCM auth), never returns garbage", () => {
    const cipher = encryptSecret("secret", KEY);
    expect(() => decryptSecret(cipher, "a-different-key")).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-real-payload", KEY)).toThrow(/malformed/);
    expect(() => decryptSecret("v1:only:three", KEY)).toThrow(/malformed/);
  });

  it("requires a key, with a helpful message", () => {
    expect(() => encryptSecret("x", undefined)).toThrow(/MARROW_SECRET_KEY/);
    expect(() => decryptSecret("v1:a:b:c", undefined)).toThrow(/MARROW_SECRET_KEY/);
  });
});
