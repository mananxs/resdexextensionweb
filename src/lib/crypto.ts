import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-GCM for secrets stored in the database (each HR's own Groq / Gemini keys).
 * Key material: APP_ENCRYPTION_KEY (preferred; any string — 32 random bytes base64 recommended), falling back to SESSION_SECRET.
 * Stored format: v1.<iv>.<tag>.<ciphertext>  (all base64url).
 */
function keyBytes(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!raw || raw.length < 16) throw new Error("Set APP_ENCRYPTION_KEY (or SESSION_SECRET) to a long random string to store personal API keys");
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const [v, iv, tag, enc] = blob.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null; // wrong/rotated encryption key → behave as "no personal key" instead of crashing every request
  }
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const sha1 = (data: string | Buffer) => createHash("sha1").update(data).digest("hex");

/** "gsk_abcd…wxyz" → "…wxyz" (never show more than the last 4 characters of a secret). */
export const maskKey = (k: string) => `…${k.slice(-4)}`;
