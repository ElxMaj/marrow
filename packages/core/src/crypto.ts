import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Connector secrets (tokens, api keys) are encrypted at rest with AES-256-GCM
// before they touch the database. the key is derived from MARROW_SECRET_KEY so
// a self-hoster controls it and a database dump alone never leaks a token. no
// new dependency: node's crypto is enough.

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  // derive a 32-byte key from the configured secret. a fixed salt is acceptable
  // here: the secret is the entropy, and we are protecting stored API tokens,
  // not hashing user passwords.
  return scryptSync(secret, "marrow.connector.secret.v1", 32);
}

function requireSecret(secret: string | undefined, op: string): string {
  if (!secret) {
    throw new Error(
      `${op}: MARROW_SECRET_KEY is not set. Set it to a long random string to store connector secrets.`,
    );
  }
  return secret;
}

/** Encrypt a connector secret. Returns a self-describing string that carries the
 *  version, iv, auth tag, and ciphertext, all base64. */
export function encryptSecret(
  plaintext: string,
  secret: string | undefined = process.env.MARROW_SECRET_KEY,
): string {
  const key = keyFrom(requireSecret(secret, "encryptSecret"));
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Decrypt a string produced by encryptSecret. throws on a malformed payload or
 *  a wrong key (GCM auth failure), never returns garbage. */
export function decryptSecret(
  payload: string,
  secret: string | undefined = process.env.MARROW_SECRET_KEY,
): string {
  const key = keyFrom(requireSecret(secret, "decryptSecret"));
  const parts = payload.split(":");
  const [version, ivB64, tagB64, ctB64] = parts;
  if (parts.length !== 4 || version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("decryptSecret: malformed ciphertext");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
