#!/bin/sh
# Gemini CLI SessionStart hook: injects the rendered session-start contract as JSON additionalContext.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node -e '
const { spawnSync } = require("child_process");
const path = require("path");
const root = process.argv[1];
const r = spawnSync(process.execPath, [path.join(root, "render/render.cjs"), "--dir", root, "--contract", "--contract-target", "gemini"], { encoding: "utf8" });
if (r.status !== 0) {
  process.stderr.write(r.stderr || r.stdout || "");
  process.exit(r.status || 1);
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: r.stdout } }) + "\n");
' "$ROOT"
