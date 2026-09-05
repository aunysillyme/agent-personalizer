#!/bin/sh
# Session-start contract for Claude Code. Prints every rule marked inject: true,
# in full, so it sits in context before the first message.
# Register in .claude/settings.json under hooks.SessionStart (see hooks/README.md).
# Resolves the project root from this script's location; works from any cwd.
# Exits non-zero when it cannot inject, so the failure is visible instead of silent.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "[agent-personalizer] node not found; session-start contract NOT injected. Rules remain reachable through CLAUDE.md pointers." >&2
  exit 1
fi
exec node "$ROOT/render/render.cjs" --dir "$ROOT" --contract --contract-target claude
