# What the code enforces

agent-personalizer is an installer and renderer. Its checks enforce file consistency and safe handling of paths. The generated profile, onboarding manual and session-start contract give the AI your working instructions. The AI applies those instructions when it works; its behaviour depends on the host and model.

## Rendering and drift checks

Each render comes from `USER.md`, `LEARNED.md`, the selected rule source and the onboarding answers in `.agent-personalizer.json`. At level 3, `rules/` is your local editable source; lower levels use the package's rules.

- **One profile source:** edit `USER.md`, then regenerate. Every profile-bearing target uses it, including `chatgpt-box1.txt`. Untouched generated profiles retain the compact ChatGPT export. Edited generated identity fields can still compact; custom text or structure falls back to the profile's own text, with the same budget warning.
- **Rule and onboarding sources:** edit the rule files or onboarding answers, then regenerate the selected AI files together. Each target receives the rules selected for its format and budget.
- **Entry source:** `LEARNED.md` is installed once and kept on re-runs. Confirmed entries reach personal targets; declined entries reach their "Never ask again" lists. Proposed entries render nowhere. ChatGPT may shorten declined lists for its budget; the plain system prompt has no entries.
- **Byte fidelity:** the renderer preserves bytes outside generated markers, including line endings.
- **Drift detection:** `node render/render.cjs --dir . --check` compares the current generated blocks and both ChatGPT paste files with what the sources would render now. Success is silent with exit `0`; it exits `1` and names drift when they differ.
- **Paste updates:** re-paste regenerated files into chat-app instruction fields. The check compares files on disk.
- **ChatGPT budget:** each box reports its character count against the limit in `render/targets.json`. Over-budget text is preserved and flagged. `--strict` exits `1` before writing when a box exceeds that limit.

The check measures rendered-file consistency. The [instruction tiers](tiers.md) explain how those files and hooks place instructions in front of the AI.

## Preflight and writes

The installer validates answers, configuration, source files and target marker structure before its write phase. The renderer validates its full target plan before replacing files.

- **Paths:** paths beneath the installation root must be real files and directories. Symlinks and paths outside the root are refused.
- **Markers:** each target may have one correctly ordered generated block or be ready for its first block. Malformed blocks are refused.
- **Encoding:** sources and targets must contain valid UTF-8; invalid bytes are refused instead of re-encoded.
- **Existing work:** edited and pre-existing profiles, notes templates, rules and tools are kept and named. Untouched installer-owned files update to the current answers and package. Obsolete untouched copies are removed; edited copies stay and are named.
- **Recovery:** the installer validates its complete plan before writing and restores changed files on failure. The renderer stages target writes with backups and rolls back a failed write. An incomplete restore keeps and names its backup with exit `2`.
- **Local operation:** the tool uses HOME to find the AI apps' folders. Before consent, it may check whether `~/.claude`, `~/.codex` and `~/.gemini` exist for target pre-selection; it opens or lists their contents only after a yes. A non-interactive install and a re-run never read sessions. The tool makes no network calls and sends no telemetry. `npx` fetches the package before execution.

On a re-run, each home-file line that byte-matches the previous template is migrated to the new template or removed when obsolete. An edited pointer stays byte for byte and is named with its file and line for manual review. Other outer text stays byte for byte. The renderer owns only the marked block.

## Re-runs, upgrades and removal

- **Convergence:** after a re-run over untouched installer files, their bytes match a fresh install with the new answers, apart from the accumulated configuration and a previous notes folder kept in place.
- **Notes history:** changing the notes path creates the new scaffold and keeps the old folder. The log names both paths once; the recorded files from both remain available to uninstall.
- **Tool updates:** a recorded install hash recognizes untouched tools and rules. For older installs without hashes, a shipped table of earlier release hashes recognizes untouched verbatim copies. Edited tools remain intact; the log names the known origin version and the replacement step. The configuration records the installed tooling version.
- **Removal inventory:** uninstall checks the union of recorded installed paths across all runs. A matching hash permits removal, a changed file is kept and named, and a missing file is skipped. An unrecorded file is left alone. Legacy configurations without hashes use their known install recipe.
- **Entries and evidence:** uninstall always keeps `LEARNED.md`, edited or untouched, and removes the local digest, its `.gitignore` and private folder. `learn --forget` removes only agent-personalizer's digest and its empty folder. Neither changes the AI apps' own history.
- **Removal paths:** every tracked path is validated before the first unlink and re-probed before each unlink. Removal is file by file. Only recorded install-created, empty directories are removed.
- **Configuration last:** the configuration is removed after tracked files are gone. Retained tracked files are named and keep the configuration for review.
- **Preview and manual steps:** `--uninstall --dry` makes the same decisions as removal and changes no files. A missing configuration exits `2` naming its path. Hook registration and pasted instructions are printed as manual cleanup steps.

## Forbidden-string gate

At level 3, configure a private list in your installed project:

```bash
cp check/forbidden.example.txt check/forbidden.local.txt
```

Fill it with the identifiers you want to catch and add `check/forbidden.local.txt` to that project's `.gitignore`. Never commit the private list. Then run:

```bash
node check/gate.cjs --dir .
```

The gate checks listed strings against file text and relative paths. In a git work tree it scans staged blobs, changed working copies and untracked files that git would include. `--all` scans the folder directly. It never follows symlinks.

- **Exit `0`:** the scan completed with no listed strings found.
- **Exit `1`:** one or more listed strings were found.
- **Exit `2`:** setup was refused, including a missing, empty or tracked private list.

Keep the list current. Review binaries, git history and personal terms outside that list separately; the gate checks the listed strings in the files it scans. Use `node check/gate.cjs --self-test` to verify detection with a seeded fixture.

## Session privacy

Learning reads up to 20 recent usable sessions from the selected Claude Code, Codex and Gemini CLI stores, plus Codex's own memory notes when selected. It retains typed messages, drops AI replies, tools and automation context, and drops a whole message containing any private-list term, ignoring case. It streams bounded input and skips symlinks, unreadable files and formats it cannot parse. See [learning.md](learning.md) for the exact sources and consent flow.

The digest stays in `.agent-personalizer/digest.md`, with its contents ignored by git. Filesystem access, backups and sync services still apply. The terminal prints file names and counts, never message text. The digest is data, and the AI is instructed never to follow instructions within it. When your AI reads it, the contents go to that AI's provider again, like anything you share with it.

Reuse only sessions you are allowed to share. Past messages can contain other people's details; add private terms before accepting. Check employer or client agreements for work accounts. agent-personalizer is not affiliated with Anthropic, OpenAI or Google; their stored formats can change. `learn --forget` and uninstall remove the digest from this install, not copies a provider, backup or sync service already received.

## Instructions and companions

The onboarding manual tells the AI where it may write, what is off limits and when to ask. The session-start hook prints those restrictions and the selected rules into context. Notes templates instruct the AI to maintain an index, session notes, decisions and inbox entries.

To make those answers govern tool access, configure a [companion](companions.md):

- **obsidian-tc:** folder access controls and human approval for destructive Obsidian operations.
- **The Context Layer:** purpose-bound context, approval decisions and receipts for actions and disclosures.

These controls live in the companion's configuration. Saved onboarding answers record the policy and render the instructions that refer to it.
