#!/bin/sh
# First-run proof from the packed package, in a consumer project outside the source tree.
# Exit 0 = all pass. Any non-zero = read the FAIL line.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)" || exit 1
fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

WORK="$(mktemp -d)" || fail "mktemp -d failed"
cleanup() { [ -n "$WORK" ] && [ -d "$WORK" ] && rm -rf "$WORK"; }
trap cleanup 0
trap 'exit 130' HUP INT TERM
WORK="$(cd "$WORK" && pwd -P)" || fail "cannot resolve temp directory"
case "$WORK/" in "$ROOT/"*) fail "temp directory must be outside the source tree";; esac
CONSUMER="$(mktemp -d "$WORK/consumer.XXXXXX")" || fail "consumer mktemp failed"

cd "$ROOT" || fail "cannot enter source tree"
VERSION="$(node -p 'require("./package.json").version')" || fail "cannot read package version"
npm pack --offline --ignore-scripts --cache "$WORK/cache" --pack-destination "$WORK" >"$WORK/pack.log" 2>&1 || fail "npm pack failed"
set -- "$WORK"/*.tgz
[ "$#" -eq 1 ] && [ -f "$1" ] || fail "npm pack must produce one tarball"
TARBALL="$1"
pass "npm pack produced one tarball"

cd "$CONSUMER" || fail "cannot enter consumer project"
printf '{"private":true}\n' > package.json || fail "cannot write consumer package.json"
npm install "$TARBALL" --offline --no-audit --no-fund --ignore-scripts --cache "$WORK/cache" >"$WORK/install.log" 2>&1 || fail "consumer npm install failed"
pass "consumer installed the tarball offline"

# Resolve once, validate, then invoke that exact path for every installer call.
BIN="$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$CONSUMER/node_modules/.bin/agent-personalizer")" || fail "cannot resolve installed bin"
case "$BIN" in "$CONSUMER/node_modules/"*) ;; *) fail "resolved bin is outside consumer node_modules";; esac
[ -x "$BIN" ] || fail "installed bin is not executable"
pass "resolved bin is under consumer node_modules and executable"
ACTUAL_VERSION="$("$BIN" --version)" || fail "installed bin --version failed"
[ "$ACTUAL_VERSION" = "$VERSION" ] || fail "installed bin version differs from package.json"
pass "installed bin --version matches package.json"

ONE="$CONSUMER/level-1"
"$BIN" --dir "$ONE" --ai claude,agents --level 1 --yes --defaults >"$WORK/level-1.log" 2>&1 || fail "level 1 install failed"
pass "level 1 install succeeded"
for f in .agent-personalizer.json AGENTS.md AGENT_ONBOARDING.md CLAUDE.md USER.md; do
  [ -f "$ONE/$f" ] || fail "level 1 missing $f"
  pass "level 1 has $f"
done
[ ! -e "$ONE/notes" ] && [ ! -L "$ONE/notes" ] || fail "level 1 created notes/"
pass "level 1 leaves notes/ absent"
[ -s "$ONE/AGENT_ONBOARDING.md" ] && grep -Fq 'This is a level-1 install:' "$ONE/AGENT_ONBOARDING.md" || fail "level 1 onboarding missing its level-specific text"
pass "level 1 onboarding is non-empty and describes level 1"
node "$CONSUMER/node_modules/agent-personalizer/render/render.cjs" --dir "$ONE" --check >"$WORK/render.log" 2>&1 || fail "level 1 packed renderer --check failed"
pass "level 1 packed renderer --check exits 0"

TWO="$CONSUMER/level-2"
"$BIN" --dir "$TWO" --ai claude,agents --level 2 --yes --defaults >"$WORK/level-2.log" 2>&1 || fail "level 2 install failed"
pass "level 2 install succeeded"
for f in notes/README.md notes/decisions.md; do
  [ -f "$TWO/$f" ] || fail "level 2 missing $f"
  pass "level 2 has $f"
done
for d in notes/inbox notes/sessions; do
  [ -d "$TWO/$d" ] || fail "level 2 missing $d/"
  pass "level 2 has $d/"
done
[ -s "$TWO/AGENT_ONBOARDING.md" ] && grep -Fq '**Session log:** append a dated section' "$TWO/AGENT_ONBOARDING.md" || fail "level 2 onboarding missing its notes write instructions"
grep -Fq 'This is a level-1 install:' "$TWO/AGENT_ONBOARDING.md" && fail "level 2 onboarding still describes level 1"
pass "level 2 onboarding replaces the level 1 text with notes write instructions"

CHAT="$CONSUMER/chatgpt"
"$BIN" --dir "$CHAT" --ai chatgpt --level 1 --yes --defaults >"$WORK/chatgpt.log" 2>&1 || fail "ChatGPT install failed"
pass "ChatGPT level 1 install succeeded"
for f in chatgpt-box1.txt chatgpt-box2.txt chatgpt-custom-instructions.md; do
  [ -f "$CHAT/$f" ] && [ -s "$CHAT/$f" ] || fail "ChatGPT missing or empty $f"
  pass "ChatGPT has non-empty $f"
done
[ ! -e "$CHAT/CLAUDE.md" ] && [ ! -L "$CHAT/CLAUDE.md" ] || fail "ChatGPT install created CLAUDE.md"
pass "ChatGPT leaves CLAUDE.md absent"

echo "all consumer-install checks passed"
