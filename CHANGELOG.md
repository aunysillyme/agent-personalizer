# Changelog

All notable changes to this repo. Format after [Keep a Changelog](https://keepachangelog.com/en/2.0.0/) 2.0.0; versions follow [SemVer](https://semver.org/). Dates are the day the change was pushed.

Every entry names the adversarial audit round that produced it where one did. The audits are Codex read-only passes against `AUDIT_BRIEF.md`; every finding was reproduced before its fix.

## [Unreleased]

## [0.5.1] - 2026-09-12

Issue #25, filed on a recheck of 0.5.0 by the same outside reader as #19 to #24. Reproduced, then fixed, then handed to Codex as one adversarial read-only round against `AUDIT_BRIEF.md`, which returned six findings. All six were reproduced by hand and fixed here, and every fix has a harness assertion inside check 89 that goes red when the fix is backed out. The harness is 89 checks now.

### Fixed

- **The two files rendered from the onboarding answers no longer name a notes path that is not on disk** (#25). #19 fixed the home files: a level-1 `CLAUDE.md` / `AGENTS.md` collapsed four `notes/...` pointers into one line pointing at `AGENT_ONBOARDING.md`. The file that line points AT, and `USER.md`, still named `notes/README.md`, `notes/sessions/`, `notes/decisions.md` and `notes/inbox/`, so the first session was told to read and write into a folder the installer had not created. One predicate now owns the question for all of it, `onboarding.notesPending()`: a local notes folder is intended for every non-cloud tool, and the level-2 scaffold is what creates it, so below level 2 the renders say the folder is absent, tell the AI to propose writes and create nothing unasked, and defer the write policy to "once it exists" rather than dropping it. A cloud notes tool is untouched at any level, because it never gets a local folder. The session-start contract and both ChatGPT boxes carry the same pending line, compressed: it is never longer than the line it replaces, which the harness asserts, because the ChatGPT box budget has about two characters of slack on this repo's own fixture.
- **The disk is the truth about whether the notes folder is there; the level was only a proxy** (round 1, findings 3 to 5). The first cut of the #25 fix keyed on the install level, which is wrong in both directions: a hand-written `.agent-personalizer.json` carries no `level` at all, so a plain `render.cjs` run emitted live `notes/README.md`, session-log, decisions-log and inbox pointers into a folder that did not exist; a level-1 install landing in a folder that already had a notes folder told the AI that folder was absent; and a re-run at a lower level does not delete what a higher one created, so a 2-then-1 sequence rewrote `USER.md` to call a folder absent while `AGENT_ONBOARDING.md` still named its paths. One boolean now answers the question for the home-file collapse and both rendered files, from the presence of the folder README, which is the file the AI is told to read before it writes. The renders stay pure functions of the answers plus that boolean, because `render/onboarding.cjs` is copied into level-3 installs and the look at the disk belongs in the caller.
- **`ask-before-every-write` keeps "show what you would write and where" in the pending contract line** (round 1, finding 1). The compressed line had dropped it, and that clause is the consent: someone who pasted the two ChatGPT boxes and nothing else had no other copy of it. The three pending lines now each carry "create nothing unasked" plus their own policy, and all three are shorter than the line they replace; the harness installs every policy at level 1 and refuses an over-budget box, rather than asserting a proxy for it.
- **A read-only or unknown notes tool is no longer told its own notebook arrives at level 2** (round 1, finding 2). The pending section said "Notes will live in Microsoft OneNote ... once that folder exists", but level 2 creates the local fallback folder, not a OneNote notebook: only the fallback is pending, and the notebook exists already.
- **The stale-notes notice no longer keys on one sentence** (round 1, finding 6). Editing the sentence it matched silenced it while the other stale line stayed. A kept `USER.md` that does not name the folder README while the folder is there now earns the notice however it was worded.
- **A `--level 2` run puts the real paths back in `USER.md` too** (#25). `AGENT_ONBOARDING.md` is regenerated from the answers on every render, so it repointed itself once the renderer knew the level; `USER.md` is yours once it exists, so it is rewritten only when it still equals the render of the same answers at the previous level, byte for byte. If you edited it, it is kept and the run says which two lines are now stale, in place of repointing it underneath you.

### Changed

- **Three harness cases moved from level 1 to level 2** (#25). Checks 60, 64 and the obsidian-tc contract assertion install at level 2, because every path they assert on has to exist on disk to be named at all; their subject is the `notes_tool` table and the ChatGPT budget, not the install level. Check 89 covers the level-1 shape, including a mechanical loud negative: at level 1 every line naming a path under the notes base must also say the folder is not there yet, so a new line cannot quietly reintroduce a dead pointer.

## [0.5.0] - 2026-09-08

A first-run walkthrough of 0.4.3 by an outside reader, filed as issues #19 to #24. Every one was reproduced before its fix, and each has a harness check that fails on 0.4.3 and passes here (checks 84 to 88).

### Changed

- **The interview is short by default** (#23). A bare `npx agent-personalizer` asks the seven questions that change behaviour, not all 23. `--full` asks the rest. `--quick` still works and is now the default it used to name.
- **A conditional question is asked only when it applies** (#23). The Obsidian question is asked about an Obsidian vault and nothing else; the "name your tool" question only when the tool is `other`. That answer was previously asked of everyone and skipped by `--quick`, so a short interview could pick `other` and never name it. One exported rule, `onboarding.asks()`, decides this for the installer and for the harness, so the check tests the installer rather than a copy of it.
- **A level-1 install no longer names a notes folder it did not create** (#19). Level 1 writes four files and no folders, and its `CLAUDE.md` / `AGENTS.md` said to read `notes/README.md`, `notes/sessions/`, `notes/decisions.md` and `notes/inbox/`: four dead pointers in the first session. The home file now carries one line pointing at `AGENT_ONBOARDING.md`, and a later `--level 2` restores the four real pointers in the same run that creates the folder behind them, touching only lines this installer wrote.
- **One verb per file in the install log** (#20). The installer wrote a home file from its template and the renderer then filled its marker block, and both steps printed `wrote`; a re-run printed `kept` and then `wrote` the same file. The renderer now says what is true of that file: `wrote` a file that did not exist, `update ... (rendered block)` when the block changed, `ok ... (rendered block already current)` when it did not. The installer labels the template write `wrote CLAUDE.md (pointer file; the renderer fills its block below)`.
- **The success text names the folder that was installed, and the paste step** (#21). The rerun command printed `--dir .`, which writes into wherever it is pasted from, not where the install went; it now prints the absolute path. The same block separates the files an AI reads from the folder by itself (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) from the ones a human still has to paste (claude.ai, ChatGPT, a system prompt), and links `docs/paste-guide.md`. The companions line prints only when more than one AI was installed, which is what it is about.
- **Level 4 is no longer offered** (#22). It was listed as a peer of 1 to 3 and then described as reading material for a layer that ships nothing. The installer, its `--help`, and the README now stop at 3. `--level 4` is still accepted so an older script keeps working, and says outright that it installs exactly what level 3 installs.
- **The README stops mixing levels with tiers** (#22). The install table has three rows and one name for the choice; the five tiers are introduced as where instructions live once written, not as something to pick. The heading "Level 1: one file" said one file over a table that said four; it now says what it writes.
- **`--yes` and `--defaults` are documented as the different flags they are** (#23). `--defaults` is the answer source, `--yes` is non-interactive mode and needs `--dir`, `--ai` and `--level`.

### Fixed

- **The default profile told the AI to "settle facts itself" under a heading addressed to it** (#24). The interview asks the human about the AI, so its option labels are third person; `USER.md`, `AGENT_ONBOARDING.md` and the session-start contract address the AI, and now take a second-person phrasing where a choice carries one ("settle facts yourself"). Every default install shipped the wrong voice, and the same line was copied into the ChatGPT boxes.
- **Angle-bracket placeholders no longer vanish on GitHub** (#24). `Last edited by: <ai> <model> <date>` rendered as `Last edited by:  ·` in the four note templates, because GitHub treats the brackets as HTML. They, and five more in the same files (`# <Folder name>`, the week heading, the decisions-log example row), are now inside code spans. The README's own two occurrences were already fenced and rendered correctly; the files it links to were not. Check 88 scans every template, skipping fenced blocks and HTML comments, so a new one cannot reappear.

### Added

- Harness checks 84 to 88, one per issue, each verified to fail against the 0.4.3 tree and pass here. 88 checks in total.

## [0.4.3] - 2026-09-06

### Added

- `author` in `package.json`, so npm shows a byline: `aunysillyme (https://github.com/aunysillyme)`. It needs an `allow:` entry in the private forbidden list, which is the gate working as designed: attribution is opt-in, one exact string at a time.
- An npm version badge in the README, matching the other published package.
- The installer's last line now points at the repository, on the reasoning that the end of a successful install is the moment a user is most likely to act on it.

## [0.4.2] - 2026-09-05

### Added
- `--help`/`-h` and `--version`/`-v` on all three entry points, the gate included (#16, #17).

### Changed
- A non-terminal stdin with the flags present and no `--yes` still uses the defaults, and now says so on stderr and in the answers-source line (#18). With flags missing it refuses, as before.

## [0.4.1] - 2026-09-05

### Added
- **On npm.** `npx agent-personalizer` is the install path; 0.4.0 was the first version published (by hand, from the tag). From 0.4.1 every version is published by `publish.yml` with provenance through npm trusted publishing, so the package page shows where each version was built. `npx github:aunysillyme/agent-personalizer` still works.

### Changed
- The installer's usage text and rerun hint say `npx agent-personalizer`; the README quick start, privacy line and cache note follow.

## [0.4.0] - 2026-09-05

Two independent audits of v0.3.0 the same day: agy as code reviewer (91/100; it could not execute commands under its own settings) and Codex as a first-time user running the ten-step walkthrough in a fresh temp directory. Every finding was reproduced before its fix.

### Changed
- `signature: no` is now coherent across the whole installed tree: the signature rule file is not installed, `rules/README.md` loses its row, and the four note templates lose their `Last edited by:` line (Codex user seat; check 61 covers the tree).
- The installer's rerun hint prints the command that actually ran: the `npx github:` form when it ran from npm's cache, else the local `node .../bin/agent-personalizer.js` path (Codex user seat).
- The ChatGPT render says, above each fence, to copy only the text inside it (Codex user seat; check 64).
- CI matrix now runs Node 18, 20 and 22 on both OSes, so the `engines: >=18` claim is tested (agy).
- README: level 1 is "One profile" and states its footprint (about a dozen small files); the privacy line distinguishes the tool (no network) from the `npx` fetch that precedes it; macOS/Linux stated, Windows via WSL or Git Bash; a no-`sudo` recovery when npm's cache is unwritable (`npm_config_cache=./.npm-cache`).
- SECURITY.md said "60-check harness"; it is 72 (agy). CONTRIBUTING names where a new notes tool goes (agy).

### Added
- `--help` and `--version` on the installer; `--help` on the renderer.
- `--quick`: the seven questions that change behaviour (name, tone, length, notes tool and path, write policy, always-ask), the rest default. Interactive only.
- `--answers -` reads the answers JSON from stdin, so the scripted path runs in CI.
- `render.cjs --strict`: exit 1 and write nothing when a ChatGPT box is over its budget. `--rules <dir>` names the rule source explicitly.
- The ChatGPT target also writes `chatgpt-box1.txt` and `chatgpt-box2.txt`, the plain paste files, covered by `--check`.
- A Windows smoke job in CI (installer, renderer, gate, ESM install through Node); `.gitattributes` pins LF.
- `.github/workflows/publish.yml`: npm publish with provenance and trusted publishing, manual and dormant until the package exists on npm (RELEASING.md).
- A harness check that the quoted check count matches the number of checks, everywhere it is quoted.
- Upgrading a level-1 folder to level 3 repoints the home file's installer-written rule pointers at `rules/` (Codex round 24).

### Changed
- **Level 1 is three files.** USER.md, AGENT_ONBOARDING.md and the home file(s); the renderer reads the rules from the package when the folder has no `rules/`, so nothing is copied. `rules/` arrives at level 3, where it is yours to edit. The home file's rule pointers say "the rendered block below" until then. The default read-first list is `USER.md, AGENT_ONBOARDING.md`.
- Every rule's universal block ends with one plain-language "In practice:" line, for the stated audience.
- `AGENT_ONBOARDING.md` lost its "Standing habits" section (the rules and USER.md already carry it).
- `.agent-personalizer.json` stores only the answers that differ from the defaults, plus the six pinned safety answers (write policy, always-ask, off-limits, notes tool and path, signature) which are always stored so a future default can never move them (Codex round 24); `validate()` fills the rest.
- The `TOOL` table in `render/onboarding.cjs` is the single source for notes tools: the interview option, the kind and the prose derive from it.

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

[Unreleased]: https://github.com/aunysillyme/agent-personalizer/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/aunysillyme/agent-personalizer/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/aunysillyme/agent-personalizer/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/aunysillyme/agent-personalizer/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/aunysillyme/agent-personalizer/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/aunysillyme/agent-personalizer/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/aunysillyme/agent-personalizer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/aunysillyme/agent-personalizer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/aunysillyme/agent-personalizer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aunysillyme/agent-personalizer/releases/tag/v0.1.0
