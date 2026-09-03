# agent-personalizer

### Personalize any AI with dynamic instructions. One profile, one rule source, rendered everywhere.

Most people set up custom instructions once, in one app, and still get generic output. The instructions decay over a long chat, the AI forgets where things are, every app has its own copy that drifts, and the AI treats its own guesses about you as your rulings.

This repo is the fix, in four levels. Stop at the level you need.

| Level | You have | You get |
|---|---|---|
| **1. One file** | one AI, one app | a profile of you (`USER.md`) and a home file the AI reads first (`CLAUDE.md` or `AGENTS.md`). Copy three files, done. |
| **2. Dynamic docs** | a notes folder the AI may edit | folder indexes the AI keeps current, a weekly session log, a decisions log, a signature on every AI edit, an inbox that empties itself. |
| **3. Mechanisms** | a coding agent (Claude Code, Codex, Cursor) | one rule source rendered per AI, a session-start contract so rules win at decision time, a drift check that fails loudly. |
| **4. Hand-off** | several AIs | pointers to the multi-agent layer: routing, task bundles, verified CLI runs. |

Everything here is the generalized shape of a system that runs in production every day. The examples are invented. The failures the rules prevent are real.

---

## Quick start

```bash
npx github:aunysillyme/agent-personalizer
```

The installer asks which AIs you use and which level you want, then writes only the matching files into the folder you point it at. It never writes secrets.

No Node? Copy `templates/USER.md` and `templates/CLAUDE.md` (or `templates/AGENTS.md`) into your project by hand. That is level 1.

---

## The five tiers (why this works)

Your instructions live in five places, each with one job and one failure it prevents. Read [docs/tiers.md](docs/tiers.md) before writing a rule.

| Tier | What | Prevents |
|---|---|---|
| 1 | Style in the system prompt | rules decaying over a long chat |
| 2 | One always-loaded home file | the AI not knowing where anything is |
| 3 | Session-start injection | a tool's own instructions beating yours at the moment of decision |
| 4 | One owning document per rule | the same rule drifting in five copies |
| 5 | Memory with a status on every fact | the AI treating its own guess as your ruling |

---

## Level 1: one file

1. Fill in [`templates/USER.md`](templates/USER.md). Who you are, how to talk to you, how firmly you mean things, how you want output shaped.
2. Copy [`templates/CLAUDE.md`](templates/CLAUDE.md) for Claude, or [`templates/AGENTS.md`](templates/AGENTS.md) for Codex, Cursor and most other coding agents. Both are pointers: they tell the AI to read `USER.md` first and where everything else lives.
3. Paste the `USER.md` body into the "custom instructions" box of any chat app that has one.

**The one idea in level 1:** the home file carries pointers, not text. Text drifts. Pointers do not.

## Level 2: dynamic docs

The AI edits your notes under rules that keep them trustworthy. Templates in [`templates/`](templates/):

- **`FOLDER_README.md`**: every folder has an index. Any write to a folder means the index is corrected in the same pass. A stale index is worse than none, because the AI believes it.
- **`session-log.md`**: one note per week. Each session appends a dated section: decisions, corrections, preferences learned.
- **`decisions-log.md`**: one running file. What was decided, why, when. Read before re-deciding anything.
- **Signature line**: every AI edit ends with `Last edited by: <ai> <model> <date> · <ten words>`. One line, overwritten, never stacked.
- **Inbox pattern**: the AI drops notes in an inbox folder, one file per item. Finished items are deleted, not marked done. A resolved file in an inbox reads as open to the next agent.

A worked week for an invented user is in [`examples/freelance-illustrator/`](examples/freelance-illustrator/).

## Level 3: mechanisms

Three pieces, all in this repo, no dependencies beyond Node.

- **Rule source + renderer.** Each rule is one file in [`rules/`](rules/) with three fenced blocks: `universal` (any AI), `personal` (your curation), `binding:<ai>` (tool names and paths for one AI). [`render/render.js`](render/render.js) renders `USER.md` plus the rules into `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, ChatGPT custom-instruction boxes, or a plain system prompt. `--check` fails if any rendered file drifted from its source.
- **Session-start contract.** [`hooks/`](hooks/) shows how to inject the rules in full at the start of every Claude Code session, and the plain-prompt fallback for AIs without hooks.
- **Drift check.** `npm run check` in CI or a pre-commit hook. A rule stated in five places drifts in five places; this is how you find out the same day.
- **Zero-personal-data gate.** [`check/gate.js`](check/gate.js) scans every file git would ship (or every file under a folder, with `--all`) for terms in a gitignored list, never follows symlinks, and fails closed when the list is missing. This repo runs it on itself before every push. Copy `check/forbidden.example.txt` to `check/forbidden.local.txt` and fill it in.

## Level 4: hand-off

Once you run several AIs, personalization is not the problem any more; routing is. That is a separate layer: which model handles which task, task bundles for every delegation, and CLI runs that only count as success when a deliverable exists. It is being built as its own repo and will link from here when it ships. This repo stays the beginner tier of that stack.

---

## Every rule carries its story

Open any file in [`rules/`](rules/). Each ends with an `origin` block: the failure that produced the rule and the failure it prevents. Rules without a story get argued with. Rules with one get followed, by people and by models. When you write your own, fill the block in. It is the most useful thing in the file.

---

## Repo map

```
templates/   USER.md, CLAUDE.md, AGENTS.md, FOLDER_README.md, session-log.md, decisions-log.md, INBOX_README.md
rules/       example rules in the three-fence format, plus the format spec
render/      render.js and the target table
hooks/       Claude Code session-start contract, plain-prompt fallback
check/       gate.js, the forbidden-string gate this repo runs on itself
bin/         the npx installer
examples/    one invented user, end to end
docs/        tiers.md
test/        run.sh: 33 checks, exact exit codes, adversarial fixtures (symlinks, traversal, malformed markers, CRLF, partial renders)
```

## Contributing

Open an issue with the failure you hit, not the feature you want. Rules come from failures.

---

MIT. Built in public by [@AunySillyMe](https://x.com/AunySillyMe).
