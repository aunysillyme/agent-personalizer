# Where each rendered file goes

The renderer writes one file per AI. This page says where each AI reads it, and what to do when you change an answer. Product menus move; the file names and the mechanism do not. Where a menu path is given it is as of this writing; if it has moved, search the product's settings for "custom instructions" or "project instructions".

| Rendered file | Who reads it | How it is read |
|---|---|---|
| `CLAUDE.md` | Claude Code | Automatically, from the folder you run it in (and from `~/.claude/CLAUDE.md` for every folder). Nothing to paste. |
| `AGENT_ONBOARDING.md` | any AI | Named as the second thing to read in `CLAUDE.md` and `AGENTS.md`. Paste it wherever the AI has no file access (below). |
| `AGENTS.md` | Codex CLI, Cursor, and other agents that adopted the AGENTS.md convention | Automatically, from the repository root. Nothing to paste. |
| `GEMINI.md` | Gemini CLI | Automatically, from the folder. Nothing to paste. |
| `chatgpt-custom-instructions.md` | ChatGPT | Two boxes to paste, below. |
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

Settings → Personalization → Custom instructions. Two boxes; `chatgpt-custom-instructions.md` is rendered as exactly those two:
1. "What would you like ChatGPT to know about you?" ← Box 1 (your profile).
2. "How would you like ChatGPT to respond?" ← Box 2 (universal rules and the ChatGPT binding).

Each box has a character limit (about 1,500 at the time of writing; the number lives in `render/targets.json`, not verified against the live product). With onboarding answers the render is built for that budget: Box 1 is the compact profile, Box 2 is the onboarding block (always-ask, off-limits, write policy, then style) followed by the `inject: true` rules only. Each box prints its count. If a box is still over, nothing is cut for you: it is written in full and flagged OVER BUDGET, and the lines are in order of consequence, so trim from the bottom. The rules that are not `inject: true` do not fit here by design; for those, make a ChatGPT Project and upload `AGENT_ONBOARDING.md` and `rules/` as project files.

## Codex CLI

Reads `AGENTS.md` from the repository root automatically (and from parent folders and `~/.codex/AGENTS.md`, nearest wins). Run the installer at the repo root and there is nothing to paste. For an adversarial read of your own repo, the same file tells Codex how to talk to you.

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

## What not to do

- Do not edit inside the marker block of a rendered file; edit `USER.md`, `rules/`, or your answers, and re-render. The next render overwrites the block.
- Do not paste `AGENT_ONBOARDING.md` into a shared bot. It names your off-limits topics and your working habits. `system-prompt.md` is the shareable one.
- Do not keep a hand-edited copy of a rule in two places. One owner, everything else points to it. [tiers.md](tiers.md), tier 4.
