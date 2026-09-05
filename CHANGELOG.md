# Changelog

All notable changes to this repo. Format after [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/). Dates are the day the change was pushed.

Every entry names the adversarial audit round that produced it where one did. The audits are Codex read-only passes against `AUDIT_BRIEF.md`; every finding was reproduced before its fix.

## [Unreleased]

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

[Unreleased]: https://github.com/aunysillyme/agent-personalizer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/aunysillyme/agent-personalizer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aunysillyme/agent-personalizer/releases/tag/v0.1.0
