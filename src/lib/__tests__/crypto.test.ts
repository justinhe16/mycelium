import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, parseKey } from "../crypto";

const key = randomBytes(32);

describe("token encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const token = "access-sandbox-12345678-aaaa-bbbb-cccc-1234567890ab";
    const ct = encrypt(token, key);
    expect(ct).not.toContain(token);
    expect(ct.startsWith("v1:")).toBe(true);
    expect(decrypt(ct, key)).toBe(token);
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("rejects a wrong key or tampered ciphertext", () => {
    const ct = encrypt("secret", key);
    expect(() => decrypt(ct, randomBytes(32))).toThrow();
    const parts = ct.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"), key)).toThrow();
  });

  it("validates the key format", () => {
    expect(() => parseKey(undefined)).toThrow(/keygen/);
    expect(() => parseKey("abc")).toThrow();
    expect(parseKey("a".repeat(64)).length).toBe(32);
  });
});
