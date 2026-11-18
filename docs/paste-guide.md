# Where each rendered file goes

The renderer writes one file per AI. This page says where each AI reads it, and what to do when you change an answer. Product menus move; the file names and the mechanism do not. Where a menu path is given it is as of this writing; if it has moved, search the product's settings for "custom instructions" or "project instructions".

| Rendered file | Who reads it | How it is read |
|---|---|---|
| `CLAUDE.md` | Claude Code | Automatically, from the project, or `~/.claude/CLAUDE.md` for every project with `--global`. Nothing to paste. |
| `AGENT_ONBOARDING.md` | any AI | Named as the second thing to read in `CLAUDE.md`, `AGENTS.md` and `GEMINI.md`. Paste or upload it where the AI does not read your local folder directly (below). |
| `AGENTS.md` | Codex CLI, Cursor, Hermes Agent, and other agents that adopted the AGENTS.md convention | Automatically, from the repository root; `--global` writes `~/.codex/AGENTS.md` (or `$CODEX_HOME/AGENTS.md` when `CODEX_HOME` is set) for all projects. Nothing to paste. |
| `GEMINI.md` | Gemini CLI and Google Antigravity | Automatically, from the folder; `--global` writes `~/.gemini/GEMINI.md` for all projects (also read by Google Antigravity alongside `~/.gemini/config/GEMINI.md`). Nothing to paste. |
| `SOUL.md` | Hermes Agent | `--global --ai hermes` appends a marked block to `~/.hermes/SOUL.md`. In a project, use `--ai agents` for `AGENTS.md`. A different `HERMES_HOME` changes where Hermes reads the global file. |
| `chatgpt-box1.txt`, `chatgpt-box2.txt` and `chatgpt-custom-instructions.md` | ChatGPT | Profile and response text to paste, with a preview and counts. |
| `system-prompt.md` | anything with a system-prompt field, shared bots, API calls | Paste as the system prompt. Universal rules only, no profile, safe to share. |

Use `npx agent-personalizer --global --ai claude,agents,gemini,hermes --yes` for one profile across projects. Its source lives in `~/.agent-personalizer/`; re-run with `--global` after editing it and start a new client session. Global mode accepts these four targets and level 1, excludes `--dir`, preserves text outside its markers and supports `--global --uninstall`. See [global installation](install.md#every-project-with-one-profile).

---

## Claude Code

1. Run the installer in the project folder. `CLAUDE.md` and `AGENT_ONBOARDING.md` land there and Claude Code reads `CLAUDE.md` on every session.
2. For rules that must win at the moment of decision, register the session-start hook: see [`hooks/README.md`](../hooks/README.md). It prints the inject-marked rules and your onboarding block into context before your first message.
3. For your output style specifically, Claude Code has a custom output-style slot that lives in the system prompt every turn (`/output-style`). Put the "How to talk" and "Output shape" lines from `AGENT_ONBOARDING.md` there; a style in the system prompt is re-sent every turn, so it does not fade the way a file read once does. Tier 1 in [tiers.md](tiers.md).

## claude.ai (web and desktop apps), Claude Projects

The apps do not read files from your disk. Paste:
1. The body of `USER.md` into the Project's instructions field (Projects → your project → Set project instructions), followed by the body of `AGENT_ONBOARDING.md`.
2. For a chat outside any Project, the account-level custom instructions field (Settings → Profile) takes the same text.

Re-paste after every re-render. `--check` verifies the files on disk; it cannot see the pasted copy.

## ChatGPT

Open Settings → Personalization (or Settings → Customize ChatGPT on iOS and Android) and enable customization. Copy the exported profile and response instructions into the fields your current interface provides, checking its displayed limits.

- **Profile:** `chatgpt-box1.txt` is the plain profile text. An edited or pre-existing `USER.md` is its source too. Confirmed entries from `LEARNED.md` reach the ChatGPT exports.
- **Response instructions:** `chatgpt-box2.txt` is the plain onboarding and selected rule text.
- **Preview:** `chatgpt-custom-instructions.md` carries both exports inside fences with their character counts.

The configured baseline budget is 1,500 characters per export in `render/targets.json`: ChatGPT Free and Go accounts cap Custom Instructions at 1,500 characters, while Plus, Pro, Business, Enterprise and Edu accounts allow up to 5,000 characters under Settings → Personalization (`More about you` and `Custom instructions`; `Customize ChatGPT` on mobile). With onboarding answers, box 1 compacts the generated profile while its structure still parses, and preserves custom profile text in full when it does not. Box 2 places the onboarding block (always-ask, off-limits, write policy, then style) before the selected session rules. Confirmed entries and declined "Never ask again" entries are both appended in full; nothing is truncated silently. Proposed entries are omitted. The preview reports each count; over-budget text is written in full and flagged `OVER BUDGET`, while `--strict` refuses the write. Review the text against your account's displayed limits. Account-level Custom Instructions do not read your local project folder directly, whereas file access in ChatGPT depends on the surface, uploads and enabled tools; for the full onboarding, entries and rule source in a ChatGPT Project, upload `AGENT_ONBOARDING.md`, `LEARNED.md` and `rules/` as project files (or add Project instructions under Project settings).

## Codex CLI

Run the installer at the repo root, then start Codex in that project. Codex builds its instruction chain once per run:

- **Global guidance:** the first non-empty `AGENTS.override.md` or `AGENTS.md` in the Codex home directory (`~/.codex`, or `$CODEX_HOME` when set). `--global --ai agents` writes to that effective Codex home and warns without modifying `AGENTS.override.md` when a non-empty override shadows `AGENTS.md`.
- **Project guidance:** files from the repository root down to the working directory are merged in that order. Deeper files take precedence over earlier guidance. With no project root, discovery checks the working directory.
- **Per directory:** `AGENTS.override.md` is tried before `AGENTS.md`, followed by configured fallback filenames. At most one file is selected per directory; project installs warn if a non-empty `AGENTS.override.md` in the target folder shadows `AGENTS.md`.
- **Size cap:** the combined guidance has a default limit of 32 KiB, configurable with `project_doc_max_bytes`.
- **Verify in a fresh session:** run `codex --ask-for-approval never "Summarize the current instructions."` (or `"List the instruction sources you loaded."`) from your repository root, check `echo $CODEX_HOME` if global guidance is missing, or inspect `codex -c log_dir=./.codex-log` (`./.codex-log/codex-tui.log`) to confirm which instruction files loaded.

Verified against [OpenAI's Codex AGENTS.md documentation](https://developers.openai.com/codex/guides/agents-md) on 2026-11-18. Restart Codex after an update so it rebuilds the instruction chain.

## Cursor

Reads `AGENTS.md` at the project root. Older setups use `.cursor/rules/`; if yours does, point one rule file at `AGENTS.md` rather than copying its text, so there is one owner.

## Gemini CLI and Google Antigravity

Gemini CLI reads `GEMINI.md` from the folder (and parent folders), plus `~/.gemini/GEMINI.md` when installed with `--global --ai gemini`. Project installs also add `.gemini/commands/personalize.toml` for `/personalize`, and level-3 installs provide `hooks/gemini-cli/session-start.sh` for `.gemini/settings.json` (see [`hooks/README.md`](../hooks/README.md)).

Google Antigravity also reads project `GEMINI.md` files (from the workspace root up to the current folder) and `~/.gemini/GEMINI.md` for compatibility; its primary global instruction file is `~/.gemini/config/GEMINI.md`, which enforces a 24,000-byte per-file limit after includes. Use `--compact` if a custom rule set approaches the 20,000-character warning budget.

## Anything else

Use `system-prompt.md`. It carries only the universal blocks: no profile, no personal blocks, no off-limits names. That is deliberate: a system prompt is often shared, logged, or sent to a vendor, and the profile is not for that.

---

## When you change an answer

1. Re-run the installer with new answers through `--answers`. It asks no questions on an existing install, regenerates `AGENT_ONBOARDING.md` and updates every rendered block. `USER.md` is regenerated only if you never edited it; otherwise it is kept and the installer names the changed answers for you to carry over by hand (or delete `USER.md` and re-run). Editing `USER.md`, `LEARNED.md` or a rule by hand: `node render/render.cjs --dir .` at level 3.
2. Files that are read automatically (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) are done.
3. Files that were pasted (claude.ai, ChatGPT, any system prompt) must be pasted again. Nothing can detect a stale paste for you; put "re-paste after re-render" in your own checklist.

## Keep it working

- **Edit the source:** change `USER.md`, `LEARNED.md`, `rules/`, or your answers, then re-render. The next render replaces the generated block.
- **Share the universal rules:** use `system-prompt.md` for a shared bot. Keep `AGENT_ONBOARDING.md` in your own setup because it names your off-limits topics and working habits.
- **Keep one rule owner:** link other files to the owning rule, or generate and check their copies. See [tiers.md](tiers.md), tier 4.
