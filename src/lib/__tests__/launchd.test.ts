import { describe, expect, it } from "vitest";
import { buildPlist, stableNodePath } from "../launchd";

const CELLAR = "/opt/homebrew/Cellar/node/26.12.0/bin/node";

describe("stableNodePath", () => {
  it("prefers the Homebrew symlink over the versioned Cellar path", () => {
    const pathEnv = "/Users/me/code/mycelium/node_modules/.bin:/opt/homebrew/bin:/usr/bin";
    const exists = (p: string) => p === "/opt/homebrew/bin/node" || p === "/usr/bin/node";
    expect(stableNodePath(CELLAR, pathEnv, exists)).toBe("/opt/homebrew/bin/node");
  });

  it("skips node_modules and Cellar directories on PATH", () => {
    const pathEnv = "/repo/node_modules/.bin:/opt/homebrew/Cellar/node/26.12.0/bin:/usr/local/bin";
    const exists = () => true;
    expect(stableNodePath(CELLAR, pathEnv, exists)).toBe("/usr/local/bin/node");
  });

  it("skips fnm's per-shell directories, which vanish when the shell exits", () => {
    const pathEnv = "/Users/me/.local/state/fnm_multishells/123_456/bin:/opt/homebrew/bin";
    expect(stableNodePath(CELLAR, pathEnv, () => true)).toBe("/opt/homebrew/bin/node");
  });

  it("ignores empty and relative PATH entries", () => {
    expect(stableNodePath(CELLAR, ":.:bin:/usr/local/bin", (p) => p === "/usr/local/bin/node")).toBe(
      "/usr/local/bin/node",
    );
  });

  it("falls back to execPath when no node is on PATH", () => {
    expect(stableNodePath(CELLAR, "/usr/bin:/bin", () => false)).toBe(CELLAR);
    expect(stableNodePath(CELLAR, undefined, () => true)).toBe(CELLAR);
  });
});

describe("buildPlist", () => {
  const plist = buildPlist({ repo: "/Users/me/code/mycelium", node: "/opt/homebrew/bin/node", hour: 7 });

  it("runs the given node binary with tsx from the repo", () => {
    expect(plist).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(plist).toContain("<string>/Users/me/code/mycelium/node_modules/tsx/dist/cli.mjs</string>");
    expect(plist).toContain("<string>scripts/sync.ts</string>");
    expect(plist).toContain("<string>--trigger=launchd</string>");
    expect(plist).not.toContain("Cellar");
  });

  it("sets the working directory, log paths and schedule", () => {
    expect(plist).toContain("<key>WorkingDirectory</key><string>/Users/me/code/mycelium</string>");
    expect(plist).toContain("<key>StandardOutPath</key><string>/Users/me/code/mycelium/data/sync.log</string>");
    expect(plist).toContain("<key>StandardErrorPath</key><string>/Users/me/code/mycelium/data/sync.log</string>");
    expect(plist).toContain("<key>Hour</key><integer>7</integer>");
  });

  it("puts node's directory on the job's PATH", () => {
    expect(plist).toContain("<key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>");
  });

  it("escapes XML in paths", () => {
    const p = buildPlist({ repo: "/tmp/a&b", node: "/usr/local/bin/node", hour: 6 });
    expect(p).toContain("<string>/tmp/a&amp;b</string>");
    expect(p).not.toMatch(/a&b/);
  });
});
