/**
 * Builds the LaunchAgent plist for the daily sync (see scripts/launchd.ts).
 *
 * Kept separate from the script so the plist can be tested without touching launchd.
 */
import fs from "node:fs";
import path from "node:path";

export const LABEL = "com.mycelium.sync";

/** What launchd gives a job when the plist sets no PATH. */
const LAUNCHD_DEFAULT_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** A path inside one specific installed version, which an upgrade deletes. */
function isVersionedPath(p: string): boolean {
  return /\/Cellar\//.test(p);
}

/**
 * The node binary the LaunchAgent should run.
 *
 * `process.execPath` is the fully resolved path, which for Homebrew is
 * `/opt/homebrew/Cellar/node/<version>/bin/node`. `brew upgrade` deletes that
 * directory, and launchd then can't spawn the job at all (exit 78, EX_CONFIG,
 * nothing in the log). So prefer the first `node` on PATH, unresolved: e.g.
 * `/opt/homebrew/bin/node`, a symlink Homebrew repoints on every upgrade.
 * PATH entries inside node_modules (added by `npm run`) and Cellar
 * directories are skipped. Falls back to `execPath`.
 */
export function stableNodePath(
  execPath: string,
  pathEnv: string | undefined,
  exists: (p: string) => boolean = isExecutable,
): string {
  for (const dir of (pathEnv ?? "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    if (dir.split(path.sep).includes("node_modules")) continue;
    if (isVersionedPath(dir)) continue;
    const candidate = path.join(dir, "node");
    if (exists(candidate)) return candidate;
  }
  return execPath;
}

function xml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface PlistOptions {
  repo: string;
  node: string;
  hour: number;
}

export function buildPlist({ repo, node, hour }: PlistOptions): string {
  const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
  const log = path.join(repo, "data", "sync.log");
  const args = [node, tsx, "scripts/sync.ts", "--trigger=launchd"];
  // launchd's default PATH has no node, so anything the sync spawns that looks
  // node up by name would fail. Put node's directory first.
  const envPath = [path.dirname(node), ...LAUNCHD_DEFAULT_PATH.filter((d) => d !== path.dirname(node))].join(":");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(envPath)}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}
