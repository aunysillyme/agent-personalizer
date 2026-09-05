#!/bin/sh
# Every check in this repo, and proof that each one can fail. 60 checks. Exact exit codes are
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
trap cleanup EXIT
trap 'cleanup; trap - EXIT; echo "interrupted"; exit 130' HUP INT TERM
mk() { MK="$(mktemp -d)" || fail "mktemp -d failed"; [ -n "$MK" ] && [ -d "$MK" ] || fail "mktemp gave no directory"; case "$MK" in *[!A-Za-z0-9/._-]*) fail "mktemp path has unexpected characters: $MK";; esac; TMPS="$TMPS $MK"; }
# run <expected-exit> <label> cmd... ; asserts the exact exit code
expect() { want="$1"; label="$2"; shift 2; "$@" >/dev/null 2>&1; got=$?; [ "$got" -eq "$want" ] || fail "$label: expected exit $want, got $got"; }

# 1. the example renders clean
expect 0 "example render --check" node render/render.js --dir examples/freelance-illustrator --check
pass "example render --check is clean"

# 2. render --check exits exactly 1 on seeded drift
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
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
for f in USER.md AGENT_ONBOARDING.md CLAUDE.md AGENTS.md GEMINI.md chatgpt-custom-instructions.md system-prompt.md rules/50-output-style.md notes/README.md render/render.js render/onboarding.js check/gate.js hooks/claude-code/session-start.sh .agent-personalizer.json; do
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
mk; T="$MK"; mk; O="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf 'SENTINEL\n' > "$O/victim.md"; cp "$O/victim.md" "$O/victim.expected"
rm -f "$T/CLAUDE.md"; ln -s "$O/victim.md" "$T/CLAUDE.md"
expect 2 "render through symlink" node render/render.js --dir "$T" --targets claude
cmp -s "$O/victim.md" "$O/victim.expected" || fail "renderer wrote through a symlink"
pass "renderer refuses a symlinked target, outside file unchanged"

# 13. renderer refuses a traversal target name from a tampered targets.json
mk; T="$MK"; mk; O="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; mkdir -p "$T/render"; cp render/render.js render/onboarding.js "$T/render/"
printf 'SENTINEL\n' > "$O/victim.md"; cp "$O/victim.md" "$O/victim.expected"
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('render/targets.json','utf8'));t.claude.file='../'+process.argv[1]+'/victim.md';fs.writeFileSync(process.argv[2]+'/render/targets.json',JSON.stringify(t));" "$(basename "$O")" "$T"
expect 2 "render traversal" node "$T/render/render.js" --dir "$T" --targets claude
cmp -s "$O/victim.md" "$O/victim.expected" || fail "renderer wrote outside --dir via a traversal target name"
pass "renderer refuses a traversal target name, outside file unchanged"

# 14. renderer refuses to touch a file with a malformed marker block (BEGIN without END); file unchanged
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf 'top\n<!-- agent-personalizer:begin -->\nold\nHANDWRITTEN\n' > "$T/AGENTS.md"; cp "$T/AGENTS.md" "$T/AGENTS.expected"
expect 2 "render malformed markers" node render/render.js --dir "$T" --targets agents
cmp -s "$T/AGENTS.md" "$T/AGENTS.expected" || fail "renderer modified a file with malformed markers"
pass "renderer refuses malformed markers, file unchanged"

# 15. renderer refuses marker tokens inside USER.md and rule files
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '\n<!-- agent-personalizer:end -->\n' >> "$T/USER.md"
expect 2 "marker in USER.md" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '\n<!-- agent-personalizer:begin -->\n' >> "$T/rules/40-sign-every-edit.md"
expect 2 "marker in rule file" node render/render.js --dir "$T" --targets claude
pass "renderer refuses marker tokens in USER.md and in rule files"

# 16. renderer refuses malformed frontmatter (unclosed surfaces list, unknown surface, duplicate section)
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak 's/^surfaces: \[claude, agents, gemini\]$/surfaces: [claude, agents/' "$T/rules/20-one-owner-per-rule.md"; rm -f "$T/rules/"*.bak
expect 2 "unclosed surfaces" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak 's/^surfaces: \[claude, agents, gemini\]$/surfaces: [claude, nowhere]/' "$T/rules/20-one-owner-per-rule.md"; rm -f "$T/rules/"*.bak
expect 2 "unknown surface" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '\n## universal\nsecond copy\n' >> "$T/rules/40-sign-every-edit.md"
expect 2 "duplicate section" node render/render.js --dir "$T" --check
pass "renderer refuses malformed frontmatter and duplicate sections"

# 17. contract is target-aware: a prompt-only rule does not reach the claude contract; --no-personal drops personal
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
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
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; mkdir -p "$T/render" "$T/hooks/claude-code"; cp render/render.js render/onboarding.js render/targets.json "$T/render/"; cp hooks/claude-code/session-start.sh "$T/hooks/claude-code/"
/bin/sh "$T/hooks/claude-code/session-start.sh" > "$T/hook.out" || fail "hook failed with node present"
grep -q 'Session-start contract for claude' "$T/hook.out" || fail "hook printed no contract"
grep -q 'Read the profile first' "$T/hook.out" || fail "hook contract missing an inject:true rule"
# a PATH holding only the utilities the hook needs (dirname, pwd) and no node, whatever this machine has
mk; B="$MK"; ln -s "$(command -v dirname)" "$B/dirname"; ln -s "$(command -v pwd)" "$B/pwd"
# a fresh shell, so the parent's command hash table cannot answer for a PATH it never saw
env PATH="$B" /bin/sh -c 'command -v node' >/dev/null 2>&1 && fail "test PATH still finds node"
expect 1 "hook without node" env PATH="$B" /bin/sh "$T/hooks/claude-code/session-start.sh"
pass "hook: exit 0 with node, exactly 1 without it"

# 19. renderer refuses symlinked sources (USER.md, rules/, a rule file) instead of importing outside content
mk; T="$MK"; mk; O="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf 'OUTSIDE\n' > "$O/outside.md"
rm -f "$T/USER.md"; ln -s "$O/outside.md" "$T/USER.md"
expect 2 "symlinked USER.md" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; rm -rf "$T/rules"; ln -s "$O" "$T/rules"
expect 2 "symlinked rules/" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; rm -f "$T/rules/40-sign-every-edit.md"; ln -s "$O/outside.md" "$T/rules/40-sign-every-edit.md"
expect 2 "symlinked rule file" node render/render.js --dir "$T" --targets claude
pass "renderer refuses symlinked sources"

# 20. no partial render: a malformed second target means the first target is not written either
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf 'stale\n' > "$T/CLAUDE.md"; cp "$T/CLAUDE.md" "$T/CLAUDE.expected"
printf 'top\n<!-- agent-personalizer:begin -->\nold\n' > "$T/AGENTS.md"
expect 2 "partial render" node render/render.js --dir "$T" --targets claude,agents
cmp -s "$T/CLAUDE.md" "$T/CLAUDE.expected" || fail "first target was written before the second was refused"
pass "renderer writes nothing when any target is refused"

# 21. bytes outside the marker block are preserved exactly, CRLF included
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf 'crlf line\r\n<!-- agent-personalizer:begin -->\r\nold\r\n<!-- agent-personalizer:end -->\r\ntail\r\n' > "$T/AGENTS.md"
expect 0 "crlf render" node render/render.js --dir "$T" --targets agents
printf 'crlf line\r\n' > "$T/prefix.expected"; printf 'tail\r\n' > "$T/suffix.expected"
head -c 11 "$T/AGENTS.md" > "$T/prefix.got"; tail -c 6 "$T/AGENTS.md" > "$T/suffix.got"
cmp -s "$T/prefix.got" "$T/prefix.expected" || fail "bytes before the marker block changed"
cmp -s "$T/suffix.got" "$T/suffix.expected" || fail "bytes after the marker block changed"
expect 0 "crlf check" node render/render.js --dir "$T" --targets agents --check
pass "bytes outside the marker block are preserved (CRLF)"

# 22. frontmatter: CRLF is normalized, unclosed envelope / unknown key / duplicate key / stray rule file all exit 2
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak 's/$/\r/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 0 "crlf rule file" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak '6d' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "unclosed frontmatter" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak 's/^surfaces:/surface:/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "misspelled key" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak 's/^inject: false$/inject: false\ninject: true/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "duplicate key" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; cp "$T/rules/40-sign-every-edit.md" "$T/rules/stray.md"
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
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; mkdir -p "$T/render"; cp render/render.js render/onboarding.js "$T/render/"
printf 'stale\n' > "$T/CLAUDE.md"; cp "$T/CLAUDE.md" "$T/CLAUDE.expected"
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('render/targets.json','utf8'));t.agents.file='missing/AGENTS.md';fs.writeFileSync(process.argv[1]+'/render/targets.json',JSON.stringify(t));" "$T"
expect 2 "missing parent dir" node "$T/render/render.js" --dir "$T" --targets claude,agents
cmp -s "$T/CLAUDE.md" "$T/CLAUDE.expected" || fail "first target written although the second target's directory was missing"
pass "renderer refuses a target whose directory is missing, writes nothing"

# 27. markers inside a fenced block in the target are not the owned block: three-backtick, four-backtick
#     with a three-backtick line inside, tilde fence, a close line with trailing text (not a close),
#     and an unterminated fence (refused, file unchanged)
fence_case() { # $1 label, $2 file body (printf format)
  mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf "$2" > "$T/AGENTS.md"
  expect 0 "fence: $1" node render/render.js --dir "$T" --targets agents
  grep -q '^EXAMPLE$' "$T/AGENTS.md" || fail "fence: $1: quoted example inside the fence was replaced"
  [ "$(grep -c 'agent-personalizer:begin' "$T/AGENTS.md")" = "2" ] || fail "fence: $1: expected the fenced example plus one real block"
  expect 0 "fence: $1 check" node render/render.js --dir "$T" --targets agents --check
}
fence_case "three backticks" 'doc\n```\n<!-- agent-personalizer:begin -->\nEXAMPLE\n<!-- agent-personalizer:end -->\n```\nafter\n'
fence_case "four backticks with a three-backtick line inside" 'doc\n````md\n```\n<!-- agent-personalizer:begin -->\nEXAMPLE\n<!-- agent-personalizer:end -->\n```\n````\nafter\n'
fence_case "tildes" 'doc\n~~~\n<!-- agent-personalizer:begin -->\nEXAMPLE\n<!-- agent-personalizer:end -->\n~~~\nafter\n'
fence_case "close line with trailing text is not a close" 'doc\n```\n``` not a close\n<!-- agent-personalizer:begin -->\nEXAMPLE\n<!-- agent-personalizer:end -->\n```\nafter\n'
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf 'doc\n```\n<!-- agent-personalizer:begin -->\nEXAMPLE\n' > "$T/AGENTS.md"; cp "$T/AGENTS.md" "$T/AGENTS.expected"
expect 2 "unterminated fence" node render/render.js --dir "$T" --targets agents
cmp -s "$T/AGENTS.md" "$T/AGENTS.expected" || fail "unterminated fence: file was modified"
pass "fences: three/four backticks, tildes, false close, unterminated (refused)"

# 28. gate exits 2 (not walk) when git cannot run inside a repo; walk mode still works outside a repo
mk; T="$MK"; printf 'zzqqxx-no-such-term\n' > "$T/list.txt"
expect 2 "gate with git unavailable in a repo" env PATH=/nonexistent "$(command -v node)" check/gate.js --dir "$ROOT/templates" --list "$T/list.txt"
mk; O="$MK"; echo "zzqqxx-no-such-term here" > "$O/a.md"
expect 1 "gate walk outside a repo finds the seeded hit" env PATH=/nonexistent "$(command -v node)" check/gate.js --dir "$O" --list "$T/list.txt"
mk; O="$MK"; printf 'gitdir: /nonexistent\n' > "$O/.git"; echo clean > "$O/a.md"
expect 2 "gate with malformed .git metadata" node check/gate.js --dir "$O" --list "$T/list.txt"
pass "gate: git failure with metadata is exit 2 (malformed .git file included); plain folders walk and still catch hits"

# 29. missing rules/, unknown binding, hidden stray rule file all refused
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; rm -rf "$T/rules"
expect 2 "missing rules/" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '\n## binding:nowhere\nx\n' >> "$T/rules/40-sign-every-edit.md"
expect 2 "unknown binding" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; cp "$T/rules/40-sign-every-edit.md" "$T/rules/.99-hidden.md"
expect 2 "hidden stray rule" node render/render.js --dir "$T" --check
pass "missing rules/, unknown binding, hidden stray rule file all refused"

# 30. ChatGPT box 2 carries the chatgpt binding block, same composition as the contract
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf -- '---\nid: 97-gpt-binding\ntitle: GPT binding\ninject: false\nsurfaces: [claude, chatgpt]\n---\n\n## universal\nGPTUNIVERSAL\n\n## binding:chatgpt\nGPTBINDINGSENTINEL\n' > "$T/rules/97-gpt-binding.md"
expect 0 "chatgpt render" node render/render.js --dir "$T" --targets chatgpt,claude
grep -q 'How would you like ChatGPT to respond' "$T/chatgpt-custom-instructions.md" || fail "chatgpt render missing box 2"
grep -q GPTBINDINGSENTINEL "$T/chatgpt-custom-instructions.md" || fail "chatgpt box 2 missing its binding:chatgpt block"
grep -q GPTBINDINGSENTINEL "$T/CLAUDE.md" && fail "chatgpt binding leaked into the claude render"
pass "chatgpt box 2 includes the chatgpt binding and nothing else does"

# 31. a target that is not valid UTF-8 is refused, byte for byte unchanged
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf 'a\377b\n<!-- agent-personalizer:begin -->\nold\n<!-- agent-personalizer:end -->\n' > "$T/AGENTS.md"; cp "$T/AGENTS.md" "$T/AGENTS.expected"
expect 2 "invalid utf-8 target" node render/render.js --dir "$T" --targets agents
cmp -s "$T/AGENTS.md" "$T/AGENTS.expected" || fail "renderer rewrote a non-UTF-8 target"
pass "non-UTF-8 target refused, unchanged"

# 32. an unwritable second target means the first is not written either (preflight + staged writes)
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf 'stale\n' > "$T/CLAUDE.md"; cp "$T/CLAUDE.md" "$T/CLAUDE.expected"; chmod 444 "$T/AGENTS.md"
expect 2 "unwritable second target" node render/render.js --dir "$T" --targets claude,agents
cmp -s "$T/CLAUDE.md" "$T/CLAUDE.expected" || fail "first target written although the second was unwritable"
chmod 644 "$T/AGENTS.md"
[ -z "$(ls -A "$T" | grep '\.agent-personalizer\.tmp$')" ] || fail "staged temp files left behind"
pass "unwritable target: nothing written, no temp files left"

# 33. a section heading inside a fenced example in a rule is not a section
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf -- '---\nid: 96-fenced-heading\ntitle: Fenced heading\ninject: false\nsurfaces: [claude, prompt]\n---\n\n## universal\nBEFOREFENCE\n```\n## personal\nFENCEDTEXT\n```\nAFTERFENCE\n\n## personal\nREALPERSONAL\n' > "$T/rules/96-fenced-heading.md"
expect 0 "fenced heading render" node render/render.js --dir "$T" --targets prompt
grep -q AFTERFENCE "$T/system-prompt.md" || fail "text after a fenced heading was reclassified out of universal"
grep -q REALPERSONAL "$T/system-prompt.md" && fail "real personal block leaked into the prompt render"
pass "a heading inside a fenced example is not a section boundary"

# 34. staging cannot collide with a target: two targets on one file, or a target named with the staging suffix, are refused before any write
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; mkdir -p "$T/render"; cp render/render.js render/onboarding.js "$T/render/"
printf 'HANDWRITTEN\n' > "$T/AGENTS.md"; cp "$T/AGENTS.md" "$T/AGENTS.expected"
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('render/targets.json','utf8'));t.claude.file='AGENTS.md';fs.writeFileSync(process.argv[1]+'/render/targets.json',JSON.stringify(t));" "$T"
expect 2 "two targets one file" node "$T/render/render.js" --dir "$T" --targets claude,agents
cmp -s "$T/AGENTS.md" "$T/AGENTS.expected" || fail "colliding targets modified the file"
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('render/targets.json','utf8'));t.claude.file='.AGENTS.md.agent-personalizer.tmp';fs.writeFileSync(process.argv[1]+'/render/targets.json',JSON.stringify(t));" "$T"
expect 2 "staging-suffix target name" node "$T/render/render.js" --dir "$T" --targets claude,agents
cmp -s "$T/AGENTS.md" "$T/AGENTS.expected" || fail "staging-suffix target modified the file"
pass "staging collisions refused, nothing written"

# 35. a stale staging file from a crash does not block the next run, and is not deleted
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf 'stale\n' > "$T/.AGENTS.md.1-deadbeef.agent-personalizer.tmp"
expect 0 "render with stale tmp present" node render/render.js --dir "$T" --targets agents
[ -f "$T/.AGENTS.md.1-deadbeef.agent-personalizer.tmp" ] || fail "renderer deleted a stale staging file it did not create"
[ "$(ls -A "$T" | grep -c 'agent-personalizer\.\(tmp\|bak\)$')" = "1" ] || fail "renderer left its own temp or backup files behind"
pass "stale staging file: run proceeds, file kept, own temps cleaned"

# 36. invalid UTF-8 in a SOURCE is refused (rule file, then USER.md)
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '\nbad \377 byte\n' >> "$T/rules/40-sign-every-edit.md"
expect 2 "invalid utf-8 rule" node render/render.js --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '\nbad \377 byte\n' >> "$T/USER.md"
expect 2 "invalid utf-8 USER.md" node render/render.js --dir "$T" --targets claude
pass "non-UTF-8 sources refused"

# 37. malformed targets.json and malformed .agent-personalizer.json are refusals (exit 2), not crashes
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; mkdir -p "$T/render"; cp render/render.js render/onboarding.js "$T/render/"; printf '{ not json' > "$T/render/targets.json"
expect 2 "malformed targets.json" node "$T/render/render.js" --dir "$T" --targets claude
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '{ not json' > "$T/.agent-personalizer.json"
expect 2 "malformed config" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '{"targets": "claude"}' > "$T/.agent-personalizer.json"
expect 2 "config targets not a list" node render/render.js --dir "$T" --check
pass "malformed JSON inputs are refusals, not crashes"

# 38. --check refuses duplicate targets and staging-suffix names too
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
expect 2 "--check duplicate targets" node render/render.js --dir "$T" --targets claude,claude --check
pass "--check refuses duplicate targets"

# 39. an existing target keeps its mode across a render; a new target gets 0644
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; chmod 600 "$T/CLAUDE.md"; rm -f "$T/AGENTS.md"
expect 0 "mode render" node render/render.js --dir "$T" --targets claude,agents
m1="$(stat -f %Lp "$T/CLAUDE.md" 2>/dev/null || stat -c %a "$T/CLAUDE.md")"; m2="$(stat -f %Lp "$T/AGENTS.md" 2>/dev/null || stat -c %a "$T/AGENTS.md")"
[ "$m1" = "600" ] || fail "existing target mode changed to $m1"
[ "$m2" = "644" ] || fail "new target mode is $m2, expected 644"
pass "target modes preserved (600 kept, new file 644)"

# 40. mid-commit failure rolls back; a failed restore keeps the backup and says ROLLBACK INCOMPLETE
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
node test/rollback.test.js "$T" > "$T/rollback.out" 2>&1 || { cat "$T/rollback.out"; fail "rollback fault-injection test"; }
pass "rollback: complete on a commit failure; backup kept and named when a restore fails"

# 41. gate scans the INDEX blob: a leak staged then cleaned on disk is caught; a clean index with a leak on disk is caught too
mk; T="$MK"; printf 'zzqqxx-no-such-term\n' > "$T/list.txt"
mk; R="$MK"; git -C "$R" init -q; git -C "$R" config user.email t@t; git -C "$R" config user.name t
echo "zzqqxx-no-such-term staged" > "$R/leak.md"; git -C "$R" add leak.md; echo "clean now" > "$R/leak.md"
node check/gate.js --dir "$R" --list "$T/list.txt" > "$T/g1.txt" 2>&1; got=$?; [ "$got" -eq 1 ] || fail "gate missed a leak that is staged but cleaned on disk (exit $got)"
grep -q 'leak.md (index)' "$T/g1.txt" || fail "gate did not attribute the hit to the index blob"
echo "clean" > "$R/leak.md"; git -C "$R" add leak.md; echo "zzqqxx-no-such-term on disk" > "$R/leak.md"
node check/gate.js --dir "$R" --list "$T/list.txt" > "$T/g2.txt" 2>&1; got=$?; [ "$got" -eq 1 ] || fail "gate missed a leak on disk in a tracked file (exit $got)"
grep -q 'leak.md (working tree)' "$T/g2.txt" || fail "gate did not attribute the hit to the working tree"
echo "clean" > "$R/leak.md"; git -C "$R" add leak.md
expect 0 "gate clean index and tree" node check/gate.js --dir "$R" --list "$T/list.txt"
# symlinks: their target text ships as a blob, so it is scanned; staged, then untracked, then in walk mode
ln -s "/tmp/zzqqxx-no-such-term/private" "$R/link"; git -C "$R" add link
node check/gate.js --dir "$R" --list "$T/list.txt" > "$T/g3.txt" 2>&1; got=$?; [ "$got" -eq 1 ] || fail "gate missed a forbidden term in a staged symlink target (exit $got)"
grep -q 'link (index, symlink target)' "$T/g3.txt" || fail "staged symlink hit not attributed"
git -C "$R" rm -q --cached link
node check/gate.js --dir "$R" --list "$T/list.txt" > "$T/g4.txt" 2>&1; got=$?; [ "$got" -eq 1 ] || fail "gate missed a forbidden term in an untracked symlink target (exit $got)"
mk; W="$MK"; ln -s "/tmp/zzqqxx-no-such-term/private" "$W/link"
expect 1 "gate walk mode symlink target" node check/gate.js --dir "$W" --list "$T/list.txt"
pass "gate scans index blobs, differing working-tree copies, and symlink target text"

# 42. ChatGPT target rerenders and checks clean when USER.md and a rule carry fenced examples
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
printf '\n## Example\n\n```js\nexample()\n```\n\n````md\n```\nnested\n```\n````\n' >> "$T/USER.md"
printf -- '---\nid: 95-fenced-rule\ntitle: Fenced rule\ninject: false\nsurfaces: [claude, chatgpt]\n---\n\n## universal\nA rule with an example:\n```\ncode in a rule\n```\n' > "$T/rules/95-fenced-rule.md"
expect 0 "chatgpt first render" node render/render.js --dir "$T" --targets chatgpt,claude
for f in chatgpt-custom-instructions.md CLAUDE.md; do
  grep -q 'example()' "$T/$f" || fail "fenced profile content missing from $f"
  grep -q '^nested$' "$T/$f" || fail "nested fenced profile content missing from $f"
  grep -q 'code in a rule' "$T/$f" || fail "fenced rule content missing from $f"
  grep -q '^````md$' "$T/$f" || fail "four-backtick fence not preserved in $f"
done
grep -q '^`````$' "$T/chatgpt-custom-instructions.md" || fail "chatgpt wrapper fence is not longer than the content's longest run"
expect 0 "chatgpt rerender" node render/render.js --dir "$T" --targets chatgpt,claude
expect 0 "chatgpt check" node render/render.js --dir "$T" --targets chatgpt,claude --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '\n```js\nunterminated\n' >> "$T/USER.md"
expect 2 "unterminated fence in USER.md" node render/render.js --dir "$T" --targets claude
pass "fenced examples in sources survive rerender and --check; an unterminated one is refused"

# 43. the list file is excluded by exact path only: a shippable file whose name starts with the list's name is still scanned
mk; T="$MK"; mkdir -p "$T/check"; printf 'zzqqxx-no-such-term\n' > "$T/check/forbidden.local.txt"; echo "zzqqxx-no-such-term inside" > "$T/check/forbidden.local.txt (payload).md"
expect 1 "list-name impersonation" node check/gate.js --dir "$T" --list "$T/check/forbidden.local.txt" --all
pass "gate excludes the list by exact path, not by name prefix"

# 44. a bare repository is refused (exit 2), never walked
mk; R="$MK"; { git -C "$R" init -q && git -C "$R" config user.email t@t && git -C "$R" config user.name t && echo x > "$R/a.md" && git -C "$R" add a.md && git -C "$R" commit -q -m x; } || fail "bare fixture: repo setup"
mk; B="$MK"; git clone -q --bare "$R" "$B/bare.git" || fail "bare fixture: clone"; [ -d "$B/bare.git" ] || fail "bare fixture: no bare.git"
mk; T="$MK"; printf 'zzqqxx-no-such-term\n' > "$T/list.txt"
node check/gate.js --dir "$B/bare.git" --list "$T/list.txt" > "$T/bare.out" 2>&1; got=$?; [ "$got" -eq 2 ] || fail "bare repository: expected exit 2, got $got"
grep -q 'is a bare repository' "$T/bare.out" || fail "bare repository: wrong diagnostic"
pass "bare repository refused with the right diagnostic"

# 45. id and title must be non-empty text
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak 's/^title: .*$/title: []/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "title as list" node render/render.js --dir "$T" --check
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; sed -i.bak 's/^id: .*$/id: true/' "$T/rules/40-sign-every-edit.md"; rm -f "$T/rules/"*.bak
expect 2 "id as boolean" node render/render.js --dir "$T" --check
pass "id and title validated as text"

# 46. a tracked forbidden list is exit 2 (it would ship); an untracked one at the same path is fine
mk; R="$MK"; { git -C "$R" init -q && git -C "$R" config user.email t@t && git -C "$R" config user.name t && mkdir -p "$R/check" && printf 'zzqqxx-no-such-term\n' > "$R/check/forbidden.local.txt" && printf 'check/forbidden.local.txt\n' > "$R/.gitignore" && echo clean > "$R/a.md" && git -C "$R" add a.md .gitignore; } || fail "tracked-list fixture"
expect 0 "untracked list at the standard path" node check/gate.js --dir "$R" --list "$R/check/forbidden.local.txt"
git -C "$R" add -f check/forbidden.local.txt || fail "tracked-list fixture: force add"
node check/gate.js --dir "$R" --list "$R/check/forbidden.local.txt" > "$T/tl.out" 2>&1; got=$?; [ "$got" -eq 2 ] || fail "tracked list: expected exit 2, got $got"
grep -q 'forbidden list itself is tracked' "$T/tl.out" || fail "tracked list: wrong diagnostic"
mkdir -p "$R/sub"; echo clean > "$R/sub/b.md"; git -C "$R" add sub/b.md
node check/gate.js --dir "$R/sub" --list "$R/check/forbidden.local.txt" > "$T/tl2.out" 2>&1; got=$?; [ "$got" -eq 2 ] || fail "tracked list with nested --dir: expected exit 2, got $got"
grep -q 'forbidden list itself is tracked' "$T/tl2.out" || fail "tracked list nested: wrong diagnostic"
node check/gate.js --dir "$R" --list "$R/check/forbidden.local.txt" --all > "$T/tl3.out" 2>&1; got=$?; [ "$got" -eq 2 ] || fail "tracked list with --all: expected exit 2, got $got"
grep -q 'forbidden list itself is tracked' "$T/tl3.out" || fail "tracked list --all: wrong diagnostic"
pass "a git-tracked forbidden list is refused from the root, from a nested --dir, and with --all"

# 47. --all scans node_modules too; only .git is skipped
mk; T="$MK"; mk; L="$MK"; mkdir -p "$T/node_modules" "$T/.git"; printf 'zzqqxx-no-such-term\n' > "$L/list.txt"; echo "zzqqxx-no-such-term" > "$T/node_modules/leak.txt"; echo "zzqqxx-no-such-term" > "$T/.git/config"
node check/gate.js --dir "$T" --list "$L/list.txt" --all > "$T/all.out" 2>&1; got=$?; [ "$got" -eq 1 ] || fail "--all missed node_modules (exit $got)"
grep -q 'node_modules/leak.txt' "$T/all.out" || fail "--all hit not attributed to node_modules"
grep -q '\.git/config' "$T/all.out" && fail "--all scanned .git"
pass "--all scans node_modules, skips only .git"

# 48. tracked-list refusal survives pathspec metacharacters in the list name, an OUTER repository tracking it, and malformed .git metadata beside it
mk; R="$MK"; { git -C "$R" init -q && git -C "$R" config user.email t@t && git -C "$R" config user.name t && mkdir -p "$R/check" && printf 'zzqqxx-no-such-term\n' > "$R/check/forbid*den.txt" && echo clean > "$R/a.md" && git -C "$R" add a.md && git -C "$R" add -f -- ':(literal)check/forbid*den.txt'; } || fail "metachar fixture"
node check/gate.js --dir "$R" --list "$R/check/forbid*den.txt" > "$T/m1.out" 2>&1; got=$?; [ "$got" -eq 2 ] || fail "tracked list with metacharacters: expected exit 2, got $got"
grep -q 'forbidden list itself is tracked' "$T/m1.out" || fail "metachar: wrong diagnostic"
mk; O="$MK"; { git -C "$O" init -q && git -C "$O" config user.email t@t && git -C "$O" config user.name t && mkdir -p "$O/inner/check" && printf 'zzqqxx-no-such-term\n' > "$O/inner/check/forbidden.txt" && git -C "$O" add -f inner/check/forbidden.txt && git -C "$O/inner" init -q && echo clean > "$O/inner/a.md" && git -C "$O/inner" add a.md; } || fail "nested fixture"
node check/gate.js --dir "$O/inner" --list "$O/inner/check/forbidden.txt" > "$T/m2.out" 2>&1; got=$?; [ "$got" -eq 2 ] || fail "list tracked by an OUTER repo: expected exit 2, got $got"
grep -q 'forbidden list itself is tracked' "$T/m2.out" || fail "outer repo: wrong diagnostic"
mk; M="$MK"; printf 'gitdir: /nonexistent\n' > "$M/.git"; printf 'zzqqxx-no-such-term\n' > "$M/list.txt"; mk; C="$MK"; echo clean > "$C/a.md"
expect 2 "malformed .git beside the list" node check/gate.js --dir "$C" --list "$M/list.txt" --all
pass "tracked-list refusal: metacharacters, outer repository, malformed metadata beside the list"

# 49. installer refuses a duplicated --ai before creating anything
mk; T="$MK"
expect 2 "duplicate --ai" node bin/agent-personalizer.js --dir "$T" --ai claude,claude --level 3 --yes
[ -z "$(ls -A "$T")" ] || fail "installer created files before refusing a duplicate --ai"
pass "duplicate --ai refused, nothing created"

# 50. contract heading falls back to the filename when a rule has neither id nor title
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf -- '---\ninject: true\n---\n\n## universal\nNOTITLERULE\n' > "$T/rules/94-no-title.md"
node render/render.js --dir "$T" --contract --contract-target claude > "$T/c.txt" || fail "contract exited non-zero"
grep -q '^## 94-no-title.md$' "$T/c.txt" || fail "contract heading did not fall back to the filename"
grep -q 'undefined' "$T/c.txt" && fail "contract printed undefined"
pass "contract heading falls back to the filename"

# 51. a list reached through a symlinked directory alias is checked at its REAL path; a dangling .git beside it is metadata
mk; B="$MK"; { mkdir -p "$B/repo/check" "$B/clean" && git -C "$B/repo" init -q && git -C "$B/repo" config user.email t@t && git -C "$B/repo" config user.name t && printf 'zzqqxx-no-such-term\n' > "$B/repo/check/list.txt" && git -C "$B/repo" add -f check/list.txt && ln -s "$B/repo/check" "$B/list-alias" && echo clean > "$B/clean/a.txt"; } || fail "alias fixture"
node check/gate.js --dir "$B/clean" --list "$B/list-alias/list.txt" --all > "$B/o1.txt" 2>&1; got=$?; [ "$got" -eq 2 ] || fail "tracked list via symlinked alias: expected exit 2, got $got"
grep -q 'forbidden list itself is tracked' "$B/o1.txt" || fail "alias: wrong diagnostic"
mk; D="$MK"; mkdir -p "$D/site" "$D/clean"; ln -s /nonexistent "$D/site/.git"; printf 'zzqqxx-no-such-term\n' > "$D/site/list.txt"; echo clean > "$D/clean/a.txt"
expect 2 "dangling .git beside the list" node check/gate.js --dir "$D/clean" --list "$D/site/list.txt" --all
mk; L="$MK"; printf 'zzqqxx-no-such-term\n' > "$L/real.txt"; ln -s "$L/real.txt" "$L/link.txt"
expect 2 "symlinked list file" node check/gate.js --dir "$D/clean" --list "$L/link.txt" --all
mk; Q="$MK"; mkdir "$Q/list"
expect 2 "list is a directory" node check/gate.js --dir "$D/clean" --list "$Q/list" --all
pass "list checked at its real path; dangling .git, symlinked list, directory list all refused"

# 52. strict options everywhere: a repeated value option, an unknown option, a repeated flag are exit 2; the installer creates nothing
mk; T="$MK"
expect 2 "installer repeated --ai" node bin/agent-personalizer.js --dir "$T/x" --ai claude --ai agents --level 1 --yes
expect 2 "installer unknown option" node bin/agent-personalizer.js --dir "$T/x" --ai claude --level 1 --yes --bogus
[ ! -e "$T/x" ] || fail "installer created the folder before refusing bad options"
expect 2 "render repeated --dir" node render/render.js --dir examples/freelance-illustrator --dir examples/freelance-illustrator --check
expect 2 "render unknown option" node render/render.js --dir examples/freelance-illustrator --check --nope
expect 2 "gate repeated flag" node check/gate.js --self-test --self-test
pass "repeated or unknown options refused by installer, renderer and gate"

# 53. rule text before the first section heading is refused, never dropped
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf -- '---\nid: 93-preamble\ntitle: Preamble\n---\n\nMUST-PRESERVE-THIS\n\n## universal\ntext\n' > "$T/rules/93-preamble.md"
expect 2 "preamble text" node render/render.js --dir "$T" --targets claude
pass "text before the first section is refused"

# 54. from a nested --dir, a modified tracked file's working-tree copy is scanned (diff paths in the same coordinates as ls-files)
mk; R="$MK"; { mkdir -p "$R/sub" && git -C "$R" init -q && git -C "$R" config user.email t@t && git -C "$R" config user.name t && echo clean > "$R/sub/a.txt" && git -C "$R" add sub/a.txt && git -C "$R" commit -qm i; } || fail "nested wt fixture"
mk; L="$MK"; printf 'zzqqxx-no-such-term\n' > "$L/list.txt"; echo "zzqqxx-no-such-term now on disk" > "$R/sub/a.txt"
node check/gate.js --dir "$R/sub" --list "$L/list.txt" > "$L/o.txt" 2>&1; got=$?; [ "$got" -eq 1 ] || fail "nested --dir missed a modified tracked file (exit $got)"
grep -q 'a.txt (working tree)' "$L/o.txt" || fail "nested --dir hit not attributed to the working tree"
pass "nested --dir scans modified tracked files' working-tree copies"

# 55. onboarding: --answers renders AGENT_ONBOARDING.md and USER.md from the answers; check clean; rerun keeps them; contract carries the block
mk; T="$MK"
expect 0 "installer with answers" node bin/agent-personalizer.js --dir "$T" --ai claude,agents --level 1 --answers test/fixtures/answers.json --yes
for f in AGENT_ONBOARDING.md USER.md .agent-personalizer.json; do [ -f "$T/$f" ] || fail "onboarding: $f not written"; done
grep -q 'Call them:\*\* Mara (she/her)' "$T/AGENT_ONBOARDING.md" || fail "onboarding: name/pronouns missing"
grep -q 'a kanban board the AI reads' "$T/AGENT_ONBOARDING.md" || fail "onboarding: tracker missing"
grep -q 'signed contracts' "$T/AGENT_ONBOARDING.md" || fail "onboarding: off-limits missing"
grep -q 'start a reply with Great question' "$T/AGENT_ONBOARDING.md" || fail "onboarding: never-list missing"
grep -q '^- \*\*delete\*\*' "$T/AGENT_ONBOARDING.md" || fail "onboarding: always-ask list missing"
grep -q 'settings' "$T/AGENT_ONBOARDING.md" && grep -q '^- \*\*settings\*\*' "$T/AGENT_ONBOARDING.md" && fail "onboarding: an always-ask item the user did not choose was rendered"
grep -q 'Name and pronouns:\*\* Mara, she/her' "$T/USER.md" || fail "USER.md not generated from answers"
grep -q 'AGENT_ONBOARDING.md' "$T/CLAUDE.md" || fail "CLAUDE.md does not point at the onboarding file"
expect 0 "onboarding check" node render/render.js --dir "$T" --check
printf 'MINE\n' > "$T/USER.md.expected"; cp "$T/USER.md" "$T/USER.md.expected"
expect 0 "installer rerun" node bin/agent-personalizer.js --dir "$T" --ai claude --level 1 --yes
cmp -s "$T/USER.md" "$T/USER.md.expected" || fail "rerun changed USER.md"
grep -q '"name": "Mara"' "$T/.agent-personalizer.json" || fail "rerun lost the onboarding answers"
node render/render.js --dir "$T" --contract --contract-target claude > "$T/c.txt" || fail "contract failed"
grep -q 'How to work with Mara' "$T/c.txt" || fail "contract missing the onboarding block"
node render/render.js --dir "$T" --contract --contract-target claude --no-personal > "$T/c2.txt" || fail "contract --no-personal failed"
grep -q 'How to work with Mara' "$T/c2.txt" && fail "--no-personal still emitted the onboarding block"
pass "onboarding: answers render both files, check clean, rerun keeps answers, contract carries the block"

# 56. onboarding: invalid answers are refused before anything is created
mk; T="$MK"; mk; F="$MK"
printf '{"tone": "rude"}' > "$F/bad1.json"; expect 2 "bad choice" node bin/agent-personalizer.js --dir "$T/a" --ai claude --level 1 --answers "$F/bad1.json" --yes
printf '{"favourite_colour": "blue"}' > "$F/bad2.json"; expect 2 "unknown key" node bin/agent-personalizer.js --dir "$T/b" --ai claude --level 1 --answers "$F/bad2.json" --yes
printf '{"never": "em dashes"}' > "$F/bad3.json"; expect 2 "list as string" node bin/agent-personalizer.js --dir "$T/c" --ai claude --level 1 --answers "$F/bad3.json" --yes
printf '{"always_ask": ["delete", "launch-missiles"]}' > "$F/bad4.json"; expect 2 "unknown multi value" node bin/agent-personalizer.js --dir "$T/d" --ai claude --level 1 --answers "$F/bad4.json" --yes
printf '{"name": "two\nlines"}' > "$F/bad5.json"; expect 2 "multiline text" node bin/agent-personalizer.js --dir "$T/e" --ai claude --level 1 --answers "$F/bad5.json" --yes
printf 'not json' > "$F/bad6.json"; expect 2 "answers not json" node bin/agent-personalizer.js --dir "$T/f" --ai claude --level 1 --answers "$F/bad6.json" --yes
expect 2 "answers and defaults together" node bin/agent-personalizer.js --dir "$T/g" --ai claude --level 1 --answers test/fixtures/answers.json --defaults --yes
for d in a b c d e f g; do [ ! -e "$T/$d" ] || fail "installer created $T/$d before refusing bad answers"; done
pass "onboarding: bad choice, unknown key, wrong type, unknown multi, multiline, non-JSON, exclusive flags all refused, nothing created"

# 57. onboarding: --yes without answers uses the defaults and says so; the onboarding target refuses without answers in the config
mk; T="$MK"
node bin/agent-personalizer.js --dir "$T" --ai claude --level 1 --yes > "$T/out.txt" || fail "installer defaults"
grep -q 'onboarding: defaults' "$T/out.txt" || fail "installer did not say it used defaults"
grep -q 'Call them:\*\* the user' "$T/AGENT_ONBOARDING.md" || fail "defaults not rendered"
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '{"targets": ["claude"]}' > "$T/.agent-personalizer.json"
expect 2 "onboarding target without answers" node render/render.js --dir "$T" --targets onboarding
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"; printf '{"targets": ["claude"], "onboarding": {"tone": "rude"}}' > "$T/.agent-personalizer.json"
expect 2 "invalid onboarding in config" node render/render.js --dir "$T" --check
pass "onboarding: defaults are explicit; missing or invalid answers in the config are refusals"

# 58. markdown-adversarial answers render inertly; a render-marker in an answer is refused; malformed stored config is refused before any write
mk; T="$MK"; mk; F="$MK"
cat > "$F/adv.json" <<'JSON'
{"name": "# Not A Heading", "work": "<!-- not a comment --> and <b>tags</b>", "never": ["~~~", "```", "- a list item", "1. numbered", "> quoted", "| pipe | table |", "[link](http://x)"], "off_limits": ["~~~"], "read_first": ["~~~", "USER.md"], "tracker": "*stars* and _under_"}
JSON
expect 0 "adversarial answers install" node bin/agent-personalizer.js --dir "$T" --ai claude,chatgpt,prompt --level 1 --answers "$F/adv.json" --yes
expect 0 "adversarial answers check" node render/render.js --dir "$T" --check
grep -q '^- \\~\\~\\~' "$T/AGENT_ONBOARDING.md" || fail "tilde fence in a list answer was not escaped"
grep -q '^\\# Not A Heading\|\\# Not A Heading' "$T/AGENT_ONBOARDING.md" || fail "heading marker in name was not escaped"
grep -q '\\<!-- not a comment --\\>' "$T/AGENT_ONBOARDING.md" || fail "HTML comment delimiters were not escaped"
grep -q '\\- a list item' "$T/AGENT_ONBOARDING.md" || fail "leading list marker in an answer was not escaped"
grep -c '^~~~' "$T/AGENT_ONBOARDING.md" | grep -q '^0$' || fail "a raw fence line reached the generated file"
node render/render.js --dir "$T" --contract --contract-target claude > "$T/c.txt" || fail "contract with adversarial answers"
grep -q 'agent-personalizer:end' "$T/c.txt" && fail "contract contains a marker token"
printf '{"name": "x <!-- agent-personalizer:end --> y"}' > "$F/marker.json"
expect 2 "marker token in an answer" node bin/agent-personalizer.js --dir "$T/m" --ai claude --level 1 --answers "$F/marker.json" --yes
[ ! -e "$T/m" ] || fail "marker-token answer created a folder"
mk; C="$MK"; printf '{"targets": "prompt"}' > "$C/.agent-personalizer.json"; cp "$C/.agent-personalizer.json" "$C/cfg.expected"
expect 2 "stored targets not a list" node bin/agent-personalizer.js --dir "$C" --ai claude --level 1 --yes
cmp -s "$C/.agent-personalizer.json" "$C/cfg.expected" || fail "installer rewrote a malformed config"
[ ! -e "$C/USER.md" ] || fail "installer wrote files despite a malformed config"
mk; C="$MK"; printf '{"targets": ["claude", "not-a-target"]}' > "$C/.agent-personalizer.json"
expect 2 "stored unknown target" node bin/agent-personalizer.js --dir "$C" --ai claude --level 1 --yes
mk; C="$MK"; printf '{"targets": ["claude"], "level": "junk"}' > "$C/.agent-personalizer.json"
expect 2 "stored level junk" node bin/agent-personalizer.js --dir "$C" --ai claude --level 1 --yes
mk; C="$MK"; printf '{"targets": ["claude"], "level": 999}' > "$C/.agent-personalizer.json"
expect 2 "stored level out of range" node bin/agent-personalizer.js --dir "$C" --ai claude --level 1 --yes
mk; C="$MK"; printf '{"targets": ["agents"], "level": 2}' > "$C/.agent-personalizer.json"
expect 0 "stored valid config merges" node bin/agent-personalizer.js --dir "$C" --ai claude --level 1 --yes
grep -q '"agents"' "$C/.agent-personalizer.json" && grep -q '"claude"' "$C/.agent-personalizer.json" && grep -q '"level": 2' "$C/.agent-personalizer.json" || fail "merge lost a stored target or lowered the level"
[ -f "$C/AGENTS.md" ] || fail "merged target list was not rendered"
expect 0 "merged config renders plain" node render/render.js --dir "$C" --check
pass "adversarial answers inert, marker answers refused, malformed stored config refused untouched, valid config merged and rendered"

# 59. --contract validates the stored config like every other mode: malformed targets or level is exit 2 with no output
mk; T="$MK"; cp -R examples/freelance-illustrator/. "$T/" || fail "fixture copy"
node -e 'const fs=require("fs");const o=require("./render/onboarding.js");fs.writeFileSync(process.argv[1]+"/.agent-personalizer.json",JSON.stringify({targets:"prompt",level:"junk",onboarding:o.defaults()}));' "$T"
node render/render.js --dir "$T" --contract --contract-target claude > "$T/c.txt" 2>"$T/e.txt"; got=$?; [ "$got" -eq 2 ] || fail "contract accepted a malformed config (exit $got)"
[ ! -s "$T/c.txt" ] || fail "contract emitted output on a malformed config"
node -e 'const fs=require("fs");const o=require("./render/onboarding.js");fs.writeFileSync(process.argv[1]+"/.agent-personalizer.json",JSON.stringify({targets:["claude","claude"],onboarding:o.defaults()}));' "$T"
node render/render.js --dir "$T" --contract --contract-target claude > "$T/c2.txt" 2>/dev/null; got=$?; [ "$got" -eq 2 ] || fail "contract duplicate targets: expected exit 2, got $got"; [ ! -s "$T/c2.txt" ] || fail "contract emitted output on duplicate targets"
node -e 'const fs=require("fs");const o=require("./render/onboarding.js");fs.writeFileSync(process.argv[1]+"/.agent-personalizer.json",JSON.stringify({targets:["claude"],level:9,onboarding:o.defaults()}));' "$T"
node render/render.js --dir "$T" --contract --contract-target claude > "$T/c3.txt" 2>/dev/null; got=$?; [ "$got" -eq 2 ] || fail "contract level out of range: expected exit 2, got $got"; [ ! -s "$T/c3.txt" ] || fail "contract emitted output on a bad level"
pass "--contract refuses malformed stored config with no output"

# 60. notes_tool: all nine options render a consistent write section; companions doc ships; unknown tool refused
[ -f docs/companions.md ] || fail "docs/companions.md missing"
grep -q 'obsidian-tc' docs/companions.md && grep -q 'sierracatalina.com/context-layer' docs/companions.md || fail "companions doc missing a companion"
mk; T="$MK"; mk; F="$MK"
render_tool() { # $1 tool, $2 extra json fields; sets OUT (onboarding file) and HINT (installer output)
  printf '{"notes_tool": "%s"%s}' "$1" "$2" > "$F/$1.json"
  node bin/agent-personalizer.js --dir "$T/$1" --ai claude --level 1 --answers "$F/$1.json" --yes > "$F/$1.hint" 2>&1 || fail "install for $1"
  OUT="$T/$1/AGENT_ONBOARDING.md"; HINT="$F/$1.hint"
  node render/render.js --dir "$T/$1" --check >/dev/null || fail "check for $1"
}
# on-disk tools: filesystem rules present
for tool in obsidian logseq folder; do
  render_tool "$tool" ', "notes_path": "MyVault"'
  grep -q 'MyVault/sessions/' "$OUT" || fail "$tool: session-log path missing"
  grep -q 'Every folder you write into has a README' "$OUT" || fail "$tool: README rule missing"
  grep -q 'No filesystem writes' "$OUT" && fail "$tool: cloud rule leaked into a disk render"
  grep -q '`MyVault/README.md`' "$T/$tool/USER.md" || fail "$tool: USER.md does not point at the vault README"
  grep -q 'index page of' "$T/$tool/USER.md" && fail "$tool: USER.md points at an external index for a disk tool"
  node render/render.js --dir "$T/$tool" --contract --contract-target claude | grep -q 'at MyVault\.' || fail "$tool: contract line wrong"
done
# obsidian without obsidian-tc (default): plain files, companion recommended, contract does not claim obsidian-tc
grep -q 'as plain files (obsidian-tc is not installed' "$T/obsidian/AGENT_ONBOARDING.md" || fail "obsidian without tc: plain-files line missing"
grep -q 'rather than raw filesystem access' "$T/obsidian/AGENT_ONBOARDING.md" && fail "obsidian without tc: rendered as mandatory"
grep -q 'answer yes' "$F/obsidian.hint" || fail "obsidian without tc: hint should recommend installing it"
node render/render.js --dir "$T/obsidian" --contract --contract-target claude | grep -q 'through obsidian-tc' && fail "contract claims obsidian-tc when not installed"
# obsidian with obsidian-tc
printf '{"notes_tool": "obsidian", "obsidian_tc": "yes", "notes_path": "MyVault"}' > "$F/tc.json"
node bin/agent-personalizer.js --dir "$T/tc" --ai claude --level 1 --answers "$F/tc.json" --yes > "$F/tc.hint" 2>&1 || fail "install obsidian with tc"
grep -q 'through \*\*obsidian-tc\*\*' "$T/tc/AGENT_ONBOARDING.md" || fail "obsidian with tc: route line missing"
grep -q 'routes the AI through obsidian-tc' "$F/tc.hint" || fail "obsidian with tc: hint missing"
node render/render.js --dir "$T/tc" --contract --contract-target claude | grep -q 'through obsidian-tc' || fail "contract missing the obsidian-tc line"
grep -q 'obsidian-tc' "$T/folder/AGENT_ONBOARDING.md" && fail "folder render mentions obsidian-tc"
# cloud tools: connector named, no filesystem instructions, posture present
for tool in notion google-docs apple-notes; do
  render_tool "$tool" ', "notes_path": "Studio Wiki"'
  grep -q 'No filesystem writes' "$OUT" || fail "$tool: no-filesystem rule missing"
  grep -q 'Studio Wiki/' "$OUT" && fail "$tool: workspace name rendered as a filesystem path"
  grep -q '/sessions/' "$OUT" && fail "$tool: filesystem session-log path leaked"
  grep -q 'Every folder you write into has a README' "$OUT" && fail "$tool: folder README rule leaked into a cloud render"
  grep -q 'Session log' "$OUT" || fail "$tool: session log unit missing"
  grep -q 'Studio Wiki/README.md' "$T/$tool/USER.md" && fail "$tool: USER.md renders a filesystem README path"
  grep -q 'of "Studio Wiki"' "$T/$tool/USER.md" || fail "$tool: USER.md missing the index-unit rule"
  node render/render.js --dir "$T/$tool" --contract --contract-target claude | grep -q 'through its connector, no filesystem writes' || fail "$tool: contract line wrong"
  grep -qE 'where the app offers one|separately installed' "$HINT" || fail "$tool: hint missing"
done
grep -q "Notion's own MCP connector" "$T/notion/AGENT_ONBOARDING.md" && grep -q 'never create one unasked' "$T/notion/AGENT_ONBOARDING.md" || fail "notion connector or posture missing"
grep -q 'Google Drive / Docs connector' "$T/google-docs/AGENT_ONBOARDING.md" || fail "google-docs connector missing"
grep -q 'separately installed local Apple Notes MCP' "$T/apple-notes/AGENT_ONBOARDING.md" && grep -q 'separately installed' "$F/apple-notes.hint" || fail "apple-notes: MCP caveat missing in render or hint"
grep -q 'Studio Wiki/README.md' "$T/notion/USER.md" && fail "notion USER.md renders a filesystem README path"
grep -q 'index page of "Studio Wiki"' "$T/notion/USER.md" || fail "notion USER.md missing the index-page rule"
node render/render.js --dir "$T/notion" --contract --contract-target claude | grep -q 'through its connector, no filesystem writes' || fail "notion contract line wrong"
grep -q 'where the app offers one' "$F/notion.hint" || fail "notion hint missing"
grep -q 'where the app offers one' "$F/google-docs.hint" || fail "google-docs hint missing"
# read-only tools: read-only stated, local fallback folder used
for tool in onenote evernote; do
  render_tool "$tool" ', "notes_path": "Work Notebook"'
  grep -q 'read-only' "$OUT" || fail "$tool: not rendered as read-only"
  grep -q 'Local fallback folder:\*\* `notes/`' "$OUT" || fail "$tool: fallback folder missing"
  grep -q 'Work Notebook/' "$OUT" && fail "$tool: notebook name rendered as a path"
  grep -q '`notes/README.md` (the local fallback folder' "$T/$tool/USER.md" || fail "$tool: USER.md does not point at the fallback README"
  grep -q 'index page of' "$T/$tool/USER.md" && fail "$tool: USER.md points at an external index for a read-only tool"
  node render/render.js --dir "$T/$tool" --contract --contract-target claude | grep -q 'read-only; local fallback folder notes/' || fail "$tool: contract line wrong"
  grep -q 'no first-class agent door' "$HINT" || fail "$tool: hint missing"
done
# other: the named tool appears, conservative posture, fallback folder
render_tool other ', "notes_tool_name": "Roam Research", "notes_path": "Daily graph"'
grep -q 'Notes live in Roam Research' "$OUT" || fail "other: tool name not rendered"
grep -q 'Ask before the first write into it' "$OUT" || fail "other: conservative posture missing"
grep -q 'Roam Research' "$F/other.hint" || fail "other: hint missing the tool name"
node render/render.js --dir "$T/other" --contract --contract-target claude | grep -q 'unknown tool: ask before the first write there' || fail "other: contract claims read-only or omits the posture"
grep -q '`notes/README.md` (the local fallback folder' "$T/other/USER.md" || fail "other: USER.md does not point at the fallback README"
render_tool other ''
grep -q 'an unnamed notes tool' "$OUT" || fail "other without a name: placeholder missing"
grep -q 'your notes tool' "$HINT" || fail "other without a name: hint missing"
printf '{"notes_tool": "other", "notes_tool_name": "~~~ <!-- x"}' > "$F/advname.json"
expect 0 "adversarial tool name" node bin/agent-personalizer.js --dir "$T/an" --ai claude --level 1 --answers "$F/advname.json" --yes
grep -q 'Notes live in \\~\\~\\~ \\<!-- x' "$T/an/AGENT_ONBOARDING.md" || fail "tool name not escaped exactly once"
grep -q '\\\\\\~' "$T/an/AGENT_ONBOARDING.md" && fail "tool name double-escaped"
# adversarial location in a prose (cloud) render
printf '{"notes_tool": "notion", "notes_path": "~~~ <!-- x"}' > "$F/adv.json"
expect 0 "adversarial notes_path in prose" node bin/agent-personalizer.js --dir "$T/p" --ai claude --level 1 --answers "$F/adv.json" --yes
grep -c '^~~~' "$T/p/AGENT_ONBOARDING.md" | grep -q '^0$' || fail "notes_path reached prose unescaped"
expect 0 "adversarial notes_path check" node render/render.js --dir "$T/p" --check
# unknown tool refused, nothing created
printf '{"notes_tool": "roam"}' > "$F/bad.json"
expect 2 "unknown notes tool" node bin/agent-personalizer.js --dir "$T/x" --ai claude --level 1 --answers "$F/bad.json" --yes
[ ! -e "$T/x" ] || fail "unknown notes tool created a folder"
pass "notes_tool: disk tools get filesystem rules, cloud tools get connector rules and no paths, read-only and other get the fallback folder; unknown refused"

echo; echo "all checks passed"
