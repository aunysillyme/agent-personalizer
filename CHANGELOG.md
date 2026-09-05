# Changelog

All notable changes to this repo. Format after [Keep a Changelog](https://keepachangelog.com/en/2.0.0/) 2.0.0; versions follow [SemVer](https://semver.org/). Dates are the day the change was pushed.

Every entry names the adversarial audit round that produced it where one did. The audits are Codex read-only passes against `AUDIT_BRIEF.md`; every finding was reproduced before its fix.

## [Unreleased]

Two independent audits of v0.3.0 the same day: agy as code reviewer (91/100; it could not execute commands under its own settings) and Codex as a first-time user running the ten-step walkthrough in a fresh temp directory. Every finding was reproduced before its fix.

### Changed
- `signature: no` is now coherent across the whole installed tree: the signature rule file is not installed, `rules/README.md` loses its row, and the four note templates lose their `Last edited by:` line (Codex user seat; check 61 covers the tree).
- The installer's rerun hint prints the command that actually ran: the `npx github:` form when it ran from npm's cache, else the local `node .../bin/agent-personalizer.js` path (Codex user seat).
- The ChatGPT render says, above each fence, to copy only the text inside it (Codex user seat; check 64).
- CI matrix now runs Node 18, 20 and 22 on both OSes, so the `engines: >=18` claim is tested (agy).
- README: level 1 is "One profile" and states its footprint (about a dozen small files); the privacy line distinguishes the tool (no network) from the `npx` fetch that precedes it; macOS/Linux stated, Windows via WSL or Git Bash; a no-`sudo` recovery when npm's cache is unwritable (`npm_config_cache=./.npm-cache`).
- SECURITY.md said "60-check harness"; it is 72 (agy). CONTRIBUTING names all four places a new notes tool touches in `render/onboarding.cjs` (agy).

## [0.3.0] - 2026-09-05

Thirteen issues (#3 to #15) filed against `5972b32` by an independent installation-and-behaviour audit, every one reproduced against HEAD before its fix. One fix per issue; the harness grew from 60 to 72 checks, one regression check per issue.

### Changed
- **Answers drive the rules** (#3). A rule can declare `requires: <answer>=<value>` in its frontmatter and then renders, and enters the contract, only when the stored answer matches; `rules/40-sign-every-edit.md` requires `signature=yes`, and the installer drops its pointer line from the home files on `signature=no`. `rules/50-output-style.md` no longer hard-codes one shape (bullets, one-line corrections); it defers to the onboarding answers and states neutral defaults for when none are given. `rules/00-read-the-profile-first.md` no longer targets ChatGPT or the plain system prompt, which cannot open files.
- **Re-running with changed answers** (#4) regenerates `AGENT_ONBOARDING.md` and every rendered block, and regenerates `USER.md` only when it still equals the render of the previous answers byte for byte; an edited `USER.md` is kept and the installer names the changed answers as a conflict. README and paste guide now describe exactly that.
- **Runtime files are `.cjs`** (#5): `render/render.cjs`, `render/onboarding.cjs`, `check/gate.cjs`, so an installed copy runs inside a `"type": "module"` project. The hook, templates, docs and harness follow.
- **ChatGPT render is budgeted** (#6). With answers, Box 1 is a compact profile and Box 2 is the onboarding block (always-ask, off-limits, write policy, then style) plus the `inject: true` rules; each box prints its count against the configured limit; an over-budget box is written in full and flagged, never cut; the file says where the remaining rules go (a ChatGPT Project). Without answers the old full render remains as the fallback and says so.
- **`notes_path` is honoured** (#7): the level-2 scaffold and the `CLAUDE.md` / `AGENTS.md` pointers use it for disk tools; a cloud tool gets no local notes folder and a one-line pointer to the onboarding file; read-only and unknown tools use the `notes/` fallback. For disk tools the path is validated as a plain relative path (no `..`, no leading `/`). The default read-first list no longer hard-codes `notes/README.md`; the onboarding file adds the notes index from the answer.
- **The session-start contract carries the write policy** (#8), and is ordered by consequence: always-ask, off-limits, writes and location, read order, then how to talk.
- **Installed files reference only what the destination has** (#12): public, version-pinned doc links (`DOCS` in `render/onboarding.cjs`, checked against `package.json` by the harness) replace `docs/...` paths; direct `node` commands replace `npm run` in `hooks/README.md` and `rules/README.md`.
- **Docs say what the tool does** (#13, #14, #15). README: a "what this does, and does not do" paragraph; level 2 described as instructions the AI follows, level 3 as the automation, level 4 as reading material; "wins at decision time" and "cannot decay" softened to what injection can promise; the gate described as a forbidden-string check with named limits. `docs/tiers.md`: the stories are one setup's experience, not measurements; the pointers rule allows a generated, drift-checked block and forbids hand-maintained copies. `docs/paste-guide.md`: the ChatGPT budget and overflow strategy.

### Fixed
- **Gate: symlinked parent directories** (#9). A working-tree path whose parent is a symlink is not read (it lies outside the scan root); the skip is counted and printed; the index blob is still scanned.
- **Gate: forbidden terms in file names** (#10). Every shipped path is scanned as well as its text; a path hit is labelled `(path)` and can be allow-listed.
- **Installer preflight** (#11). Every path is probed and every existing rendered target is decoded and marker-checked before the first write, so a malformed marker block, invalid UTF-8 or an unwritable target refuses the run with nothing written. Codex round 23 then showed the same gap for sources already in the folder (a kept `rules/*.md`, a kept `USER.md`): the renderer now exports a source preflight the installer runs first, so those refuse with nothing written too.

## [0.2.0] - 2026-09-05

### Added
- **Agent onboarding interview.** The installer asks how an AI should work with you (tone, length, mistakes, when unsure, output shape, never-list, read order, where you keep notes, write policy, file naming, signature, off-limits, always-ask-before) and writes `AGENT_ONBOARDING.md` from the answers. `--answers <json>` scripts it; `--defaults` or `--yes` accepts the defaults. `USER.md` is generated from the same answers when absent. Answers live in `.agent-personalizer.json`, validated on every load.
- **Notes tool pick-list.** Obsidian, Notion, Google Docs, Apple Notes, OneNote, Evernote, Logseq, a plain folder, or other (named). The rendered write section branches by kind: disk tools get filesystem rules, cloud tools get connector rules and an explicit "no filesystem writes", read-only tools get a local fallback folder, other asks before its first write.
- **Companions.** `docs/companions.md`: obsidian-tc (optional, `obsidian_tc` question) and Sierra Catalina's Context Layer, each mapped to the answers it enforces. Per-tool connector table.
- **Paste guide.** `docs/paste-guide.md`: which rendered file each AI reads and how, and the re-paste rule.
- **CI.** `.github/workflows/harness.yml` runs the harness and the rollback fault cases on every push and pull request, Ubuntu and macOS. The privacy gate stays local by design and shows as a skip.
- **Session-start contract** carries a short onboarding block when the target allows personal content.

### Changed
- Markdown-active answers are backslash-escaped in prose contexts, so an answer of `~~~` or `<!--` cannot restructure the generated file (audit round 17).
- `.agent-personalizer.json` is validated before the installer's first write, and on every renderer load including `--contract` (rounds 17, 18).
- `other` names its tool; Apple Notes is described as a separately installed local MCP; obsidian-tc is optional in the render, not mandatory (rounds 20, 21).
- File modes in the harness are read with Node; GNU `stat -f` is filesystem status, which the first CI run caught.

### Fixed
- Cloud tools were handed filesystem write rules and paths named after the workspace (round 20).
- The `other` contract line said read-only; `USER.md` pointed read-only tools at an external index (round 21).

## [0.1.0] - 2026-09-04

### Added
- `USER.md` profile template with the four firmness rungs; `CLAUDE.md` and `AGENTS.md` pointer templates.
- Seven rules in the three-fence format (`universal` / `personal` / `binding:<ai>`), each with its origin story.
- `render/render.js`: renders `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, ChatGPT boxes and a plain system prompt from one source; byte-preserving marker splice; `--check` for drift; `--contract` for session-start hooks.
- `check/gate.js`: the zero-personal-data gate over exactly what git would ship, against a gitignored list; fails closed.
- `bin/agent-personalizer.js`: `npx` installer by AI and level; never overwrites a file it did not create.
- Claude Code session-start hook and the plain-prompt fallback.
- `docs/tiers.md`: the five tiers and the failure each prevents.
- A worked example (an invented illustrator, one week of notes).
- Harness `test/run.sh` and `test/rollback.test.js`.

### Changed, across sixteen audit rounds before the first public commit
- Renderer: target paths validated under the real project root, symlinks refused everywhere, CommonMark-correct fence tracking, invalid UTF-8 refused, staged writes with backup and rollback, generated output re-parsed before staging (rounds 1 to 9).
- Gate: scans index blobs plus differing working-tree copies, symlink target text, every enclosing repository with literal pathspecs; refuses a tracked or symlinked list, bare repos, malformed `.git` metadata; `--all` walks everything but `.git` (rounds 7 to 15).
- Installer: safe destination resolution, strict options, duplicate `--ai` refused, `--dir` created one level at a time.
- Harness: exact exit codes, adversarial fixtures, fault injection for the rollback path.

[Unreleased]: https://github.com/aunysillyme/agent-personalizer/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/aunysillyme/agent-personalizer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/aunysillyme/agent-personalizer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aunysillyme/agent-personalizer/releases/tag/v0.1.0
