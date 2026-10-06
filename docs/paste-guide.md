# Where each rendered file goes

The renderer writes one file per AI. This page says where each AI reads it, and what to do when you change an answer. Product menus move; the file names and the mechanism do not. Where a menu path is given it is as of this writing; if it has moved, search the product's settings for "custom instructions" or "project instructions".

| Rendered file | Who reads it | How it is read |
|---|---|---|
| `CLAUDE.md` | Claude Code | Automatically, from the folder you run it in (and from `~/.claude/CLAUDE.md` for every folder). Nothing to paste. |
| `AGENT_ONBOARDING.md` | any AI | Named as the second thing to read in `CLAUDE.md` and `AGENTS.md`. Paste it wherever the AI has no file access (below). |
| `AGENTS.md` | Codex CLI, Cursor, and other agents that adopted the AGENTS.md convention | Automatically, from the repository root. Nothing to paste. |
| `GEMINI.md` | Gemini CLI | Automatically, from the folder. Nothing to paste. |
| `chatgpt-box1.txt`, `chatgpt-box2.txt` and `chatgpt-custom-instructions.md` | ChatGPT | Profile and response text to paste, with a preview and counts. |
| `system-prompt.md` | anything with a system-prompt field, shared bots, API calls | Paste as the system prompt. Universal rules only, no profile, safe to share. |

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

Open Settings → Personalization and enable customization. Copy the exported profile and response instructions into the fields your current interface provides, checking its displayed limits.

- **Profile:** `chatgpt-box1.txt` is the plain profile text. An edited or pre-existing `USER.md` is its source too.
- **Response instructions:** `chatgpt-box2.txt` is the plain onboarding and selected rule text.
- **Preview:** `chatgpt-custom-instructions.md` carries both exports inside fences with their character counts.

The configured budget is 1,500 characters per export in `render/targets.json`; your current interface displays its own limits. With onboarding answers, box 1 compacts the generated profile while its structure still parses, and preserves custom profile text in full when it does not. Box 2 places the onboarding block (always-ask, off-limits, write policy, then style) before the `inject: true` rules. The preview reports each count. Over-budget text is written in full and flagged OVER BUDGET; `--strict` refuses the write. Review the text against your displayed limits. For the full onboarding and rule source, create a ChatGPT Project and upload `AGENT_ONBOARDING.md` and `rules/` as project files.

## Codex CLI

Run the installer at the repo root, then start Codex in that project. Codex builds its instruction chain once per run:

- **Global guidance:** the first non-empty `AGENTS.override.md` or `AGENTS.md` in the Codex home directory, normally `~/.codex`.
- **Project guidance:** files from the repository root down to the working directory are merged in that order. Deeper files take precedence over earlier guidance. With no project root, discovery checks the working directory.
- **Per directory:** `AGENTS.override.md` is tried before `AGENTS.md`, followed by configured fallback filenames. At most one file is selected per directory.
- **Size cap:** the combined guidance has a default limit of 32 KiB, configurable with `project_doc_max_bytes`.

Verified against [OpenAI's Codex AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md) on 2026-10-05. Restart Codex after an update so it rebuilds the instruction chain.

## Cursor

Reads `AGENTS.md` at the project root. Older setups use `.cursor/rules/`; if yours does, point one rule file at `AGENTS.md` rather than copying its text, so there is one owner.

## Gemini CLI

Reads `GEMINI.md` from the folder (and parent folders). Run the installer with `--ai gemini` and there is nothing to paste.

## Anything else

Use `system-prompt.md`. It carries only the universal blocks: no profile, no personal blocks, no off-limits names. That is deliberate: a system prompt is often shared, logged, or sent to a vendor, and the profile is not for that.

---

## When you change an answer

1. Re-run the installer with the new answers (`--answers` or the interview). It regenerates `AGENT_ONBOARDING.md` and every rendered block. `USER.md` is regenerated only if you never edited it; otherwise it is kept and the installer names the changed answers for you to carry over by hand (or delete `USER.md` and re-run). Editing `USER.md` or a rule by hand: `node render/render.cjs --dir .` at level 3.
2. Files that are read automatically (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) are done.
3. Files that were pasted (claude.ai, ChatGPT, any system prompt) must be pasted again. Nothing can detect a stale paste for you; put "re-paste after re-render" in your own checklist.

## Keep it working

- **Edit the source:** change `USER.md`, `rules/`, or your answers, then re-render. The next render replaces the generated block.
- **Share the universal rules:** use `system-prompt.md` for a shared bot. Keep `AGENT_ONBOARDING.md` in your own setup because it names your off-limits topics and working habits.
- **Keep one rule owner:** link other files to the owning rule, or generate and check their copies. See [tiers.md](tiers.md), tier 4.
