import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/*
 * Plaid access tokens are encrypted at rest with AES-256-GCM, keyed by
 * MYCELIUM_ENC_KEY (64 hex chars). The SQLite file can then be read by agents or
 * copied to a backup without exposing a usable credential.
 *
 * Format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>
 */

const ALGO = "aes-256-gcm";

export function parseKey(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex.trim())) {
    throw new Error("MYCELIUM_ENC_KEY must be 64 hex characters. Run `npm run keygen` to create one.");
  }
  return Buffer.from(hex.trim(), "hex");
}

export function encryptionKey(): Buffer {
  return parseKey(process.env.MYCELIUM_ENC_KEY);
}

export function encrypt(plain: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string, key: Buffer = encryptionKey()): string {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognized ciphertext format.");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
