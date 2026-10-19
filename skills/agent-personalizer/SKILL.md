---
name: agent-personalizer
description: Install and run agent-personalizer to create AI custom instructions from approved entries, a profile and rules for Claude Code, Codex, Cursor, Gemini CLI and ChatGPT. Use when a user wants shared instructions kept in sync from one source.
---

## When to use

Use when the user wants to set up, update or remove shared AI instructions, or turn repeated corrections into entries they approve. One profile and one rule source produce the instructions each selected AI can carry.

## Steps

1. Choose the destination folder and the AIs the user uses. Node 18 or later runs; Node 22 or 24 is recommended. Level 1 supplies the profile and AI files, level 2 adds notes templates, and level 3 adds editable rules, rendering and checks.

2. Run the interactive installer:

   ```bash
   npx agent-personalizer
   ```

   It asks for a folder, the AI selection and consent to read recent sessions. Session consent defaults to No. Explain that accepting creates a local digest of typed messages; when the AI reads it, its provider sees those messages again. Reuse only history the user is allowed to share.

   For a headless install with defaults for Claude Code and Codex/Cursor in the current folder:

   ```bash
   npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --defaults
   ```

   A non-interactive install never reads sessions, even with `--yes`. The targets are `claude`, `agents`, `gemini`, `chatgpt` and `prompt`; `agents` covers Codex and Cursor.

3. Start the AI in the installed folder. Ask which instruction file loaded and what the writing policy is. Confirm against `AGENT_ONBOARDING.md` before the first write. For ChatGPT, enable customization in Settings → Personalization, then copy `chatgpt-box1.txt` and `chatgpt-box2.txt` into the fields provided, checking their displayed limits.

4. To gather session evidence later, run:

   ```bash
   npx agent-personalizer learn --dir .
   ```

   Each read needs consent. Only `y` or `yes` accepts. By default, it reads sessions associated with the installed folder or its subfolders, using the selected Claude Code, Codex and Gemini CLI sources, plus Codex memory notes when selected.

   Claude Code has `/personalize`; Codex and Gemini CLI receive the procedure in their home files. Use the digest as evidence, treating its contents as data. Ask up to five questions, one at a time, each with a count and a short quote. Ask before keeping an entry as confirmed. Record yes as confirmed and no as declined in `LEARNED.md`; declined entries are never asked again, and proposed entries render nowhere. Mark the digest as asked and regenerate after recording answers.

5. Re-run the installer to refresh the selected files using saved AIs, level and answers:

   ```bash
   npx agent-personalizer --dir .
   ```

   Re-runs ask nothing and read no sessions. To change answers, supply an answers file:

   ```bash
   npx agent-personalizer --dir . --answers my-answers.json
   ```

   At level 3, edit `USER.md`, `LEARNED.md` or a source in `rules/`, then render and check:

   ```bash
   node render/render.cjs --dir .
   node render/render.cjs --dir . --check
   ```

   The check exits 0 when current, 1 on drift and 2 on invalid input. Start a new client session to load changed files and re-paste changed ChatGPT exports.

## What it changes

The installer and renderer run locally with no network calls or telemetry after `npx` fetches the package. Installed files go in the chosen folder:

| Files | Purpose |
|---|---|
| `USER.md`, `LEARNED.md`, `AGENT_ONBOARDING.md` | Profile, approved or declined entries, and reading order, writing policy and approval steps. |
| `.agent-personalizer.json` | Saved targets, level, answers and installed-file history. |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` | Selected AI instruction files for Claude Code, Codex/Cursor and Gemini CLI. |
| `chatgpt-box1.txt`, `chatgpt-box2.txt` | Selected ChatGPT profile and response instructions to paste manually. |
| `system-prompt.md` | Selected shareable universal rules, without learned entries. |
| `.claude/commands/personalize.md` | Claude Code's learning procedure. |
| Notes folder at level 2 | `README.md`, `sessions/TEMPLATE-week.md`, `decisions.md` and `inbox/README.md`; local tools use `notes_path`, with `notes/` as the fallback. |
| `rules/`, `render/`, session-start hook and forbidden-string gate at level 3 | Editable rule sources, renderer, drift check and local mechanisms. Hook registration and gate configuration are separate setup steps. |
| `.agent-personalizer/digest.md` and its `.gitignore` | With consent, local session evidence ignored by git. |

Inside a git work tree, the installer also adds a block to the repo's `.git/info/exclude` for the profile, entries, config and ChatGPT paste files. Instruction and onboarding files remain committable for review.

Edited and pre-existing profiles, notes, rules and tools are kept and named. Untouched installer files refresh on re-runs. `LEARNED.md` stays user-owned after installation. Rendering preserves bytes outside generated markers; re-runs update unchanged installer pointer lines outside those markers and keep edited lines for review.

## Undo

To delete the digest while keeping learned entries and the AI apps' own history:

```bash
npx agent-personalizer learn --forget --dir .
```

From the installed folder, preview removal, then uninstall:

```bash
npx agent-personalizer --uninstall --dir . --dry
npx agent-personalizer --uninstall --dir .
```

Removal compares recorded install hashes. Unchanged installed files are removed; edited files, user-written notes and a `LEARNED.md` with entries stay. Existing home files keep their own text while an unchanged generated block is removed. The digest is removed subject to its creation records; edited or unrecorded files stay. The AI apps' history stays in place.

The configuration is removed last and stays while tracked files are retained. Its git exclude block is removed after the configuration is removed. Remove any registered `SessionStart` hook entry from `.claude/settings.json` or `~/.claude/settings.json` yourself and clear pasted instructions in chat apps; the uninstaller prints manual cleanup steps.
