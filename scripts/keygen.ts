/**
 * Create .env.local with a fresh MYCELIUM_ENC_KEY (or print one if it exists).
 *
 *   npm run keygen
 *
 * Keep the key: losing it means re-linking every account (the stored Plaid
 * tokens can't be decrypted without it). Your data stays readable either way.
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("hex");
const target = ".env.local";

if (fs.existsSync(target)) {
  const current = fs.readFileSync(target, "utf8");
  if (/^MYCELIUM_ENC_KEY=[0-9a-fA-F]{64}\s*$/m.test(current)) {
    console.log(".env.local already has MYCELIUM_ENC_KEY; leaving it alone.");
  } else {
    fs.appendFileSync(target, `${current.endsWith("\n") || !current ? "" : "\n"}MYCELIUM_ENC_KEY=${key}\n`);
    console.log("Added MYCELIUM_ENC_KEY to .env.local.");
  }
  fs.chmodSync(target, 0o600);
} else {
  const template = fs.existsSync(".env.example") ? fs.readFileSync(".env.example", "utf8") : "";
  const body = template.replace(/^#?\s*MYCELIUM_ENC_KEY=.*$/m, `MYCELIUM_ENC_KEY=${key}`);
  fs.writeFileSync(target, body.includes("MYCELIUM_ENC_KEY=") ? body : `${body}\nMYCELIUM_ENC_KEY=${key}\n`, {
    mode: 0o600,
  });
  console.log("Created .env.local with a new MYCELIUM_ENC_KEY. Add your Plaid keys to it next.");
}
