#!/bin/sh
# Every check in this repo, and proof that each one can fail.
# exit 0 = all pass. Any non-zero = read the line above it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "pass: $1"; }

# 1. the example renders clean
node render/render.js --dir examples/freelance-illustrator --check >/dev/null || fail "example drifted from its source (re-render examples/)"
pass "example render --check is clean"

# 2. render --check goes red on seeded drift
TMP="$(mktemp -d)"; cp -R examples/freelance-illustrator/. "$TMP/"
printf '\nseeded drift line\n' >> "$TMP/rules/50-output-style.md"
if node render/render.js --dir "$TMP" --check >/dev/null; then rm -rf "$TMP"; fail "render --check stayed green after a rule changed"; fi
rm -rf "$TMP"; pass "render --check goes red on drift"

# 3. the gate can go red
node check/gate.js --self-test >/dev/null || fail "gate self-test"
pass "gate self-test: red on seeded hit, green on allowed string"

# 4. the gate fails closed without its list
if node check/gate.js --list /nonexistent/forbidden.txt >/dev/null 2>&1; then fail "gate passed with no list"; fi
pass "gate fails closed when the list is missing"

# 5. the repo itself passes the gate (needs check/forbidden.local.txt; skipped, not passed, if absent)
if [ -f check/forbidden.local.txt ]; then
  node check/gate.js --dir "$ROOT" >/dev/null || fail "repo has forbidden strings (run: node check/gate.js)"
  pass "repo gate clean"
else
  echo "skip: check/forbidden.local.txt absent; repo gate NOT run (this is a skip, not a pass)"
fi

# 6. installer runs end to end in a clean temp dir, non-interactive, level 3, then checks clean
TMP="$(mktemp -d)"
node bin/agent-personalizer.js --dir "$TMP" --ai claude,agents,gemini,chatgpt,prompt --level 3 --yes >/dev/null || { rm -rf "$TMP"; fail "installer exited non-zero"; }
for f in USER.md CLAUDE.md AGENTS.md GEMINI.md chatgpt-custom-instructions.md system-prompt.md rules/50-output-style.md notes/README.md render/render.js check/gate.js hooks/claude-code/session-start.sh .agent-personalizer.json; do
  [ -f "$TMP/$f" ] || { rm -rf "$TMP"; fail "installer did not write $f"; }
done
node "$TMP/render/render.js" --dir "$TMP" --check >/dev/null || { rm -rf "$TMP"; fail "installed copy drifted immediately"; }
grep -q "agent-personalizer:begin" "$TMP/CLAUDE.md" || { rm -rf "$TMP"; fail "no marker block in installed CLAUDE.md"; }
rm -rf "$TMP"; pass "installer: level 3, five targets, clean temp dir, check clean"

# 7. installer refuses a non-interactive run with missing flags
if node bin/agent-personalizer.js --yes >/dev/null 2>&1; then fail "installer ran without --dir/--ai/--level"; fi
pass "installer refuses incomplete non-interactive run"

# 8. installer never overwrites an existing USER.md
TMP="$(mktemp -d)"; mkdir -p "$TMP"; printf 'MINE\n' > "$TMP/USER.md"
node bin/agent-personalizer.js --dir "$TMP" --ai claude --level 1 --yes >/dev/null || { rm -rf "$TMP"; fail "installer level 1"; }
grep -q '^MINE$' "$TMP/USER.md" || { rm -rf "$TMP"; fail "installer overwrote an existing USER.md"; }
rm -rf "$TMP"; pass "installer keeps an existing USER.md"

echo; echo "all checks passed"
