#!/bin/sh
# Every check in this repo, and proof that each one can fail. 30 checks. Exact exit codes are
# asserted (render drift = 1, refusals and setup errors = 2), never "any non-zero".
# exit 0 = all pass. Any non-zero = read the line above it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "pass: $1"; }

# Temp dirs: mk() runs in the PARENT shell (no command substitution), so TMPS is real and the
# trap can clean it; a failed mktemp stops the harness. Use: mk; T="$MK"
TMPS=""
cleanup() { for d in $TMPS; do [ -n "$d" ] && [ -d "$d" ] && rm -rf "$d"; done; }
trap cleanup EXIT HUP INT TERM
mk() { MK="$(mktemp -d)" || fail "mktemp -d failed"; [ -n "$MK" ] && [ -d "$MK" ] || fail "mktemp gave no directory"; case "$MK" in *[!A-Za-z0-9/._-]*) fail "mktemp path has unexpected characters: $MK";; esac; TMPS="$TMPS $MK"; }
# run <expected-exit> <label> cmd... ; asserts the exact exit code
expect() { want="$1"; label="$2"; shift 2; "$@" >/dev/null 2>&1; got=$?; [ "$got" -eq "$want" ] || fail "$label: expected exit $want, got $got"; }

# 1. the example renders clean
expect 0 "example render --check" node render/render.js --dir examples/freelance-illustrator --check
pass "example render --check is clean"

# 2. render --check exits exactly 1 on seeded drift
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"
printf '\nseeded drift line\n' >> "$T/rules/50-output-style.md"
expect 1 "render --check on drift" node render/render.js --dir "$T" --check
pass "render --check exits 1 on drift"

# 3. the gate can go red (self-test seeds two hits incl. an extension-less Dockerfile, one allowed string, one binary)
expect 0 "gate self-test" node check/gate.js --self-test
pass "gate self-test: red on seeded hits, green on allowed string, binary skipped"

# 4. the gate fails closed (exit 2) without its list, and on an empty allow entry
expect 2 "gate with no list" node check/gate.js --list /nonexistent/forbidden.txt
mk; T="$MK"; printf 'x\nallow:\n' > "$T/list.txt"; echo hello > "$T/a.md"
expect 2 "gate with empty allow" node check/gate.js --dir "$T" --list "$T/list.txt"
pass "gate exits 2 when the list is missing or malformed"

# 5. the gate does not follow directory symlinks
mk; T="$MK"; mk; O="$MK"; echo "seeded secret name" > "$O/outside.md"; ln -s "$O" "$T/link"; echo "seeded secret name" > "$T/list.txt"
expect 0 "gate ignores symlinked dir" node check/gate.js --dir "$T" --list "$T/list.txt"
pass "gate never follows a symlinked directory"

# 6. the repo itself passes the gate (needs check/forbidden.local.txt; a skip is printed as a skip)
if [ -f check/forbidden.local.txt ]; then
  expect 0 "repo gate" node check/gate.js --dir "$ROOT"
  pass "repo gate clean"
else
  echo "skip: check/forbidden.local.txt absent; repo gate NOT run (a skip, not a pass)"
fi

# 7. installer: level 3, five targets, clean temp dir, then check clean
mk; T="$MK"
expect 0 "installer level 3" node bin/agent-personalizer.js --dir "$T" --ai claude,agents,gemini,chatgpt,prompt --level 3 --yes
for f in USER.md CLAUDE.md AGENTS.md GEMINI.md chatgpt-custom-instructions.md system-prompt.md rules/50-output-style.md notes/README.md render/render.js check/gate.js hooks/claude-code/session-start.sh .agent-personalizer.json; do
  [ -f "$T/$f" ] || fail "installer did not write $f"
done
[ -x "$T/hooks/claude-code/session-start.sh" ] || fail "hook not executable"
expect 0 "installed copy check" node "$T/render/render.js" --dir "$T" --check
grep -q "agent-personalizer:begin" "$T/CLAUDE.md" || fail "no marker block in installed CLAUDE.md"
pass "installer: level 3, five targets, clean temp dir, check clean"

# 8. installer refuses (exit 2) an incomplete non-interactive run and a junk level
expect 2 "installer no flags" node bin/agent-personalizer.js --yes
mk; T="$MK"; expect 2 "installer junk level" node bin/agent-personalizer.js --dir "$T" --ai claude --level 3garbage --yes
pass "installer exits 2 on incomplete flags and on a junk level"

# 9. installer keeps an existing USER.md byte for byte
mk; T="$MK"; printf 'MINE\nline two\n' > "$T/USER.md"; cp "$T/USER.md" "$T/USER.md.expected"
expect 0 "installer level 1" node bin/agent-personalizer.js --dir "$T" --ai claude --level 1 --yes
cmp -s "$T/USER.md" "$T/USER.md.expected" || fail "installer changed an existing USER.md"
pass "installer keeps an existing USER.md byte for byte"

# 10. installer refuses to write through a symlinked directory; nothing lands outside
mk; T="$MK"; mk; O="$MK"; ln -s "$O" "$T/rules"
expect 2 "installer symlinked rules/" node bin/agent-personalizer.js --dir "$T" --ai claude --level 1 --yes
[ "$(ls "$O" | wc -l | tr -d ' ')" = "0" ] || fail "installer wrote into a directory outside the install folder"
pass "installer refuses a symlinked rules/ and writes nothing outside"

# 11. installer refuses a dangling USER.md symlink instead of creating its target
mk; T="$MK"; mk; O="$MK"; ln -s "$O/created-by-installer.md" "$T/USER.md"
expect 2 "installer dangling symlink" node bin/agent-personalizer.js --dir "$T" --ai claude --level 1 --yes
[ ! -e "$O/created-by-installer.md" ] || fail "installer created a file through a dangling symlink"
pass "installer refuses a dangling symlink"

# 12. renderer refuses a symlinked target file; the outside file is untouched
mk; T="$MK"; mk; O="$MK"; cp -R examples/freelance-illustrator/. "$T/"; printf 'SENTINEL\n' > "$O/victim.md"; cp "$O/victim.md" "$O/victim.expected"
rm -f "$T/CLAUDE.md"; ln -s "$O/victim.md" "$T/CLAUDE.md"
expect 2 "render through symlink" node render/render.js --dir "$T" --targets claude
cmp -s "$O/victim.md" "$O/victim.expected" || fail "renderer wrote through a symlink"
pass "renderer refuses a symlinked target, outside file unchanged"

# 13. renderer refuses a traversal target name from a tampered targets.json
mk; T="$MK"; mk; O="$MK"; cp -R examples/freelance-illustrator/. "$T/"; mkdir -p "$T/render"; cp render/render.js "$T/render/"
printf 'SENTINEL\n' > "$O/victim.md"; cp "$O/victim.md" "$O/victim.expected"
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('render/targets.json','utf8'));t.claude.file='../'+process.argv[1]+'/victim.md';fs.writeFileSync(process.argv[2]+'/render/targets.json',JSON.stringify(t));" "$(basename "$O")" "$T"
expect 2 "render traversal" node "$T/render/render.js" --dir "$T" --targets claude
cmp -s "$O/victim.md" "$O/victim.expected" || fail "renderer wrote outside --dir via a traversal target name"
pass "renderer refuses a traversal target name, outside file unchanged"

# 14. renderer refuses to touch a file with a malformed marker block (BEGIN without END); file unchanged
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"
printf 'top\n<!-- agent-personalizer:begin -->\nold\nHANDWRITTEN\n' > "$T/AGENTS.md"; cp "$T/AGENTS.md" "$T/AGENTS.expected"
expect 2 "render malformed markers" node render/render.js --dir "$T" --targets agents
cmp -s "$T/AGENTS.md" "$T/AGENTS.expected" || fail "renderer modified a file with malformed markers"
pass "renderer refuses malformed markers, file unchanged"

# 15. renderer refuses marker tokens inside USER.md and rule files
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; printf '\n<!-- agent-personalizer:end -->\n' >> "$T/USER.md"
expect 2 "marker in USER.md" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; printf '\n<!-- agent-personalizer:begin -->\n' >> "$T/rules/40-sign-every-edit.md"
expect 2 "marker in rule file" node render/render.js --dir "$T" --targets claude
pass "renderer refuses marker tokens in USER.md and in rule files"

# 16. renderer refuses malformed frontmatter (unclosed surfaces list, unknown surface, duplicate section)
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; sed -i.bak 's/^surfaces: \[claude, agents, gemini\]$/surfaces: [claude, agents/' "$T/rules/20-one-owner-per-rule.md"; rm -f "$T/rules/"*.bak
expect 2 "unclosed surfaces" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; sed -i.bak 's/^surfaces: \[claude, agents, gemini\]$/surfaces: [claude, nowhere]/' "$T/rules/20-one-owner-per-rule.md"; rm -f "$T/rules/"*.bak
expect 2 "unknown surface" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; printf '\n## universal\nsecond copy\n' >> "$T/rules/40-sign-every-edit.md"
expect 2 "duplicate section" node render/render.js --dir "$T" --check
pass "renderer refuses malformed frontmatter and duplicate sections"

# 17. contract is target-aware: a prompt-only rule does not reach the claude contract; --no-personal drops personal
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"
printf -- '---\nid: 99-prompt-only\ntitle: Prompt only\ninject: true\nsurfaces: [prompt]\n---\n\n## universal\nPROMPTONLYRULE\n\n## personal\nPERSONALBLOCK\n' > "$T/rules/99-prompt-only.md"
printf -- '---\nid: 98-claude-personal\ntitle: Claude personal\ninject: true\nsurfaces: [claude]\n---\n\n## universal\nCLAUDEUNIVERSAL\n\n## personal\nCLAUDEPERSONAL\n' > "$T/rules/98-claude-personal.md"
node render/render.js --dir "$T" --contract --contract-target claude > "$T/c-claude.txt" || fail "claude contract exited non-zero"
node render/render.js --dir "$T" --contract --contract-target prompt > "$T/c-prompt.txt" || fail "prompt contract exited non-zero"
node render/render.js --dir "$T" --contract --contract-target claude --no-personal > "$T/c-claude-np.txt" || fail "claude --no-personal contract exited non-zero"
grep -q PROMPTONLYRULE "$T/c-claude.txt" && fail "claude contract included a prompt-only rule"
grep -q PROMPTONLYRULE "$T/c-prompt.txt" || fail "prompt contract missed its own rule"
grep -q PERSONALBLOCK "$T/c-prompt.txt" && fail "prompt (personal:false) contract leaked a personal block"
grep -q CLAUDEPERSONAL "$T/c-claude.txt" || fail "claude contract dropped a personal block it should carry"
grep -q CLAUDEPERSONAL "$T/c-claude-np.txt" && fail "--no-personal leaked a personal block"
grep -q CLAUDEUNIVERSAL "$T/c-claude-np.txt" || fail "--no-personal dropped the universal block"
grep -q "sits next to \`CLAUDE.md\`" "$T/c-claude.txt" || fail "claude contract missing its binding:claude block"
pass "contract respects surfaces, target personal policy, --no-personal, and emits the binding"

# 18. hook exits non-zero when node is absent, zero when present
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; mkdir -p "$T/render" "$T/hooks/claude-code"; cp render/render.js render/targets.json "$T/render/"; cp hooks/claude-code/session-start.sh "$T/hooks/claude-code/"
expect 0 "hook with node" /bin/sh "$T/hooks/claude-code/session-start.sh"
# a PATH holding only the utilities the hook needs (dirname, pwd) and no node, whatever this machine has
mk; B="$MK"; ln -s "$(command -v dirname)" "$B/dirname"; ln -s "$(command -v pwd)" "$B/pwd"
# a fresh shell, so the parent's command hash table cannot answer for a PATH it never saw
env PATH="$B" /bin/sh -c 'command -v node' >/dev/null 2>&1 && fail "test PATH still finds node"
expect 1 "hook without node" env PATH="$B" /bin/sh "$T/hooks/claude-code/session-start.sh"
pass "hook: exit 0 with node, exactly 1 without it"

# 19. renderer refuses symlinked sources (USER.md, rules/, a rule file) instead of importing outside content
mk; T="$MK"; mk; O="$MK"; cp -R examples/freelance-illustrator/. "$T/"; printf 'OUTSIDE\n' > "$O/outside.md"
rm -f "$T/USER.md"; ln -s "$O/outside.md" "$T/USER.md"
expect 2 "symlinked USER.md" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; rm -rf "$T/rules"; ln -s "$O" "$T/rules"
expect 2 "symlinked rules/" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; rm -f "$T/rules/40-sign-every-edit.md"; ln -s "$O/outside.md" "$T/rules/40-sign-every-edit.md"
expect 2 "symlinked rule file" node render/render.js --dir "$T" --targets claude
pass "renderer refuses symlinked sources"

# 20. no partial render: a malformed second target means the first target is not written either
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"
printf 'stale\n' > "$T/CLAUDE.md"; cp "$T/CLAUDE.md" "$T/CLAUDE.expected"
printf 'top\n<!-- agent-personalizer:begin -->\nold\n' > "$T/AGENTS.md"
expect 2 "partial render" node render/render.js --dir "$T" --targets claude,agents
cmp -s "$T/CLAUDE.md" "$T/CLAUDE.expected" || fail "first target was written before the second was refused"
pass "renderer writes nothing when any target is refused"

# 21. bytes outside the marker block are preserved exactly, CRLF included
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"
printf 'crlf line\r\n<!-- agent-personalizer:begin -->\r\nold\r\n<!-- agent-personalizer:end -->\r\ntail\r\n' > "$T/AGENTS.md"
expect 0 "crlf render" node render/render.js --dir "$T" --targets agents
printf 'crlf line\r\n' > "$T/prefix.expected"; printf 'tail\r\n' > "$T/suffix.expected"
head -c 11 "$T/AGENTS.md" > "$T/prefix.got"; tail -c 6 "$T/AGENTS.md" > "$T/suffix.got"
cmp -s "$T/prefix.got" "$T/prefix.expected" || fail "bytes before the marker block changed"
cmp -s "$T/suffix.got" "$T/suffix.expected" || fail "bytes after the marker block changed"
expect 0 "crlf check" node render/render.js --dir "$T" --targets agents --check
pass "bytes outside the marker block are preserved (CRLF)"

# 22. frontmatter: CRLF is normalized, unclosed envelope / unknown key / duplicate key / stray rule file all exit 2
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; sed -i.bak 's/$/\r/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 0 "crlf rule file" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; sed -i.bak '6d' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "unclosed frontmatter" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; sed -i.bak 's/^surfaces:/surface:/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "misspelled key" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; sed -i.bak 's/^inject: false$/inject: false\ninject: true/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "duplicate key" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; cp "$T/rules/40-sign-every-edit.md" "$T/rules/stray.md"
expect 2 "stray rule file" node render/render.js --dir "$T" --check
pass "frontmatter: CRLF ok; unclosed, misspelled, duplicate, stray file all refused"

# 23. empty --dir is refused by renderer, installer and gate
expect 2 "render empty --dir" node render/render.js --dir "" --check
expect 2 "installer empty --dir" node bin/agent-personalizer.js --dir "" --ai claude --level 1 --yes
expect 2 "gate empty --dir" node check/gate.js --dir ""
pass "empty --dir refused everywhere"

# 24. gate in git mode from a subfolder of this repo still uses git enumeration (not the walk)
mk; T="$MK"; printf 'zzqqxx-no-such-term\n' > "$T/list.txt"
node check/gate.js --dir "$ROOT/templates" --list "$T/list.txt" > "$T/out.txt" 2>&1; got=$?; [ "$got" -eq 0 ] || fail "gate on repo subfolder: expected exit 0, got $got"
grep -q "files git would ship" "$T/out.txt" || fail "gate used walk mode inside a repo subfolder"
pass "gate uses git enumeration from a repo subfolder"

# 25. gate self-test leaves no temp dir behind
before="$(ls -d "${TMPDIR:-/tmp}"/gate-selftest-* 2>/dev/null | wc -l | tr -d ' ')"
expect 0 "gate self-test again" node check/gate.js --self-test
after="$(ls -d "${TMPDIR:-/tmp}"/gate-selftest-* 2>/dev/null | wc -l | tr -d ' ')"
[ "$after" -le "$before" ] || fail "gate self-test left a temp dir behind"
pass "gate self-test cleans up"

# 26. no partial render when a target's parent directory is missing (tampered targets.json)
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; mkdir -p "$T/render"; cp render/render.js "$T/render/"
printf 'stale\n' > "$T/CLAUDE.md"; cp "$T/CLAUDE.md" "$T/CLAUDE.expected"
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('render/targets.json','utf8'));t.agents.file='missing/AGENTS.md';fs.writeFileSync(process.argv[1]+'/render/targets.json',JSON.stringify(t));" "$T"
expect 2 "missing parent dir" node "$T/render/render.js" --dir "$T" --targets claude,agents
cmp -s "$T/CLAUDE.md" "$T/CLAUDE.expected" || fail "first target written although the second target's directory was missing"
pass "renderer refuses a target whose directory is missing, writes nothing"

# 27. markers inside a fenced block in the target are not the owned block
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"
printf 'doc\n```\n<!-- agent-personalizer:begin -->\nEXAMPLE\n<!-- agent-personalizer:end -->\n```\nafter\n' > "$T/AGENTS.md"
expect 0 "fenced markers" node render/render.js --dir "$T" --targets agents
grep -q '^EXAMPLE$' "$T/AGENTS.md" || fail "renderer replaced a quoted example inside a code fence"
[ "$(grep -c 'agent-personalizer:begin' "$T/AGENTS.md")" = "2" ] || fail "expected the fenced example plus one real block"
expect 0 "fenced markers check" node render/render.js --dir "$T" --targets agents --check
pass "markers inside a code fence are ignored; real block appended after"

# 28. gate exits 2 (not walk) when git cannot run inside a repo; walk mode still works outside a repo
mk; T="$MK"; printf 'zzqqxx-no-such-term\n' > "$T/list.txt"
expect 2 "gate with git unavailable in a repo" env PATH=/nonexistent "$(command -v node)" check/gate.js --dir "$ROOT/templates" --list "$T/list.txt"
mk; O="$MK"; echo hello > "$O/a.md"
expect 0 "gate walk outside a repo" env PATH=/nonexistent "$(command -v node)" check/gate.js --dir "$O" --list "$T/list.txt"
pass "gate: git failure inside a repo is exit 2; plain folders still walk"

# 29. missing rules/, unknown binding, hidden stray rule file all refused
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; rm -rf "$T/rules"
expect 2 "missing rules/" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; printf '\n## binding:nowhere\nx\n' >> "$T/rules/40-sign-every-edit.md"
expect 2 "unknown binding" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"; cp "$T/rules/40-sign-every-edit.md" "$T/rules/.99-hidden.md"
expect 2 "hidden stray rule" node render/render.js --dir "$T" --check
pass "missing rules/, unknown binding, hidden stray rule file all refused"

# 30. ChatGPT box 2 carries the chatgpt binding block, same composition as the contract
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/"
expect 0 "chatgpt render" node render/render.js --dir "$T" --targets chatgpt
grep -q 'How would you like ChatGPT to respond' "$T/chatgpt-custom-instructions.md" || fail "chatgpt render missing box 2"
grep -q 'Paste the universal block into' "$T/chatgpt-custom-instructions.md" || fail "chatgpt box 2 missing its binding:chatgpt block"
pass "chatgpt box 2 includes the target binding"

echo; echo "all checks passed"
