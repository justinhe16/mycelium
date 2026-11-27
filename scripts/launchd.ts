/**
 * Install or remove the daily sync as a macOS LaunchAgent.
 *
 *   npm run launchd:install     # runs `npm run sync` every day at 07:00
 *   npm run launchd:uninstall
 *
 * launchd runs a missed calendar job when the Mac wakes, and the app also
 * catches up on first page load, so a closed laptop doesn't lose a day.
 * Output goes to data/sync.log.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { LABEL, buildPlist, stableNodePath } from "../src/lib/launchd";

const HOUR = Number(process.env.MYCELIUM_SYNC_HOUR ?? 7);
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const repo = process.cwd();
const domain = `gui/${process.getuid?.() ?? 501}`;
const node = stableNodePath(process.execPath, process.env.PATH);

function bootout() {
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  } catch {
    // Not loaded.
  }
}

const cmd = process.argv[2];
if (cmd === "install") {
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.join(repo, "data"), { recursive: true });
  bootout();
  fs.writeFileSync(plistPath, buildPlist({ repo, node, hour: HOUR }));
  execFileSync("launchctl", ["bootstrap", domain, plistPath], { stdio: "inherit" });
  console.log(`Installed ${LABEL}: daily sync at ${String(HOUR).padStart(2, "0")}:00.`);
  console.log(`  plist: ${plistPath}`);
  console.log(`  node:  ${node}`);
  console.log(`  log:   ${path.join(repo, "data", "sync.log")}`);
  console.log(`Run it now with: launchctl kickstart ${domain}/${LABEL}`);
} else if (cmd === "uninstall") {
  bootout();
  if (fs.existsSync(plistPath)) fs.rmSync(plistPath);
  console.log(`Removed ${LABEL}.`);
} else {
  console.error("Usage: tsx scripts/launchd.ts install|uninstall");
  process.exit(1);
}
