# agent-personalizer

[![harness](https://github.com/aunysillyme/agent-personalizer/actions/workflows/harness.yml/badge.svg)](https://github.com/aunysillyme/agent-personalizer/actions/workflows/harness.yml) [![release](https://img.shields.io/github/v/tag/aunysillyme/agent-personalizer?label=release)](https://github.com/aunysillyme/agent-personalizer/blob/main/CHANGELOG.md) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

### Personalize any AI with dynamic instructions. One profile, one rule source, rendered everywhere.

Most people set up custom instructions once, in one app, and still get generic output. The instructions decay over a long chat, the AI forgets where things are, every app has its own copy that drifts, and the AI treats its own guesses about you as your rulings.

This repo is the fix, in four levels. Stop at the level you need.

| Level | You have | You get |
|---|---|---|
| **1. One profile** | one AI, one app | three files: a profile of you (`USER.md`), an agent onboarding file written from your answers (`AGENT_ONBOARDING.md`), and a home file the AI reads first (`CLAUDE.md` or `AGENTS.md`) with the rules rendered into it. Plus the installer's own `.agent-personalizer.json`. Nothing else. |
| **2. Dynamic docs** | a notes folder the AI may edit | templates and rules for the AI to follow: folder indexes it keeps current, a weekly session log, a decisions log, a signature on every edit (if you want one), an inbox convention (one file per item, deleted when done). Instructions, not automation: the AI does the keeping. |
| **3. Mechanisms** | a coding agent (Claude Code, Codex, Cursor) | the automation: your own copy of `rules/` to edit, one rule source rendered per AI, a session-start contract that puts your rules in context at decision time, a drift check that fails loudly, a forbidden-string gate. |
| **4. Hand-off** | several AIs | reading material only for now: pointers to the multi-agent layer (routing, task bundles, verified CLI runs) and to two companion tools that enforce what this repo can only state. |

Everything here is the generalized shape of a system that runs in production every day. The examples are invented. The failures the rules prevent are real.

**What this tool does, and does not do.** It writes files: a profile, an onboarding manual generated from your answers, rule files, rendered instruction files, a session-start hook, a drift check and a privacy gate. Those are the implemented parts and the harness tests every one of them. What it does not do: make an AI comply. Text in a file, or injected at session start, is the strongest placement available, and the stories in `docs/tiers.md` are one setup's experience of what held; they are not a measured guarantee across models or hosts, and nothing here measures compliance. Anything described as the AI "keeping" or "doing" is an instruction the AI is given, not a process this repo runs. The two [companion tools](#companion-tools) are where a rule becomes something a machine enforces.

**Privacy:** the tool itself runs entirely on your machine: no network calls, no telemetry, no environment variables read, writes only into the folder you name. The one network step is `npx` fetching the package from the npm registry (or GitHub) before the tool runs; nothing in this repo opens a connection after that. Runs on macOS and Linux, and the Node entry points (installer, renderer, gate) are smoke-tested on Windows in CI; the harness and the session hook are POSIX shell, so on Windows run those under WSL or Git Bash.

---

## Quick start

```bash
npx agent-personalizer
```

Published on npm with provenance from this repository's own workflow (`npx github:aunysillyme/agent-personalizer` still works and runs the same code straight from the tag). The installer asks which AIs you use and which level you want, then writes only the matching files into the folder you point it at. It never writes secrets. `--help` lists every flag; `--quick` asks the seven questions that change behaviour and defaults the rest; `--answers file.json` (or `--answers -` from stdin) scripts it.

No Node? Copy `templates/USER.md` and `templates/CLAUDE.md` (or `templates/AGENTS.md`) into your project by hand. That is level 1.

If `npx` stops with `EPERM` and a note about root-owned files in `~/.npm`, npm cannot write its cache. Point it at a local one for this run, no `sudo` needed:

```bash
npm_config_cache=./.npm-cache npx agent-personalizer
```

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

## Where each rendered file goes

[docs/paste-guide.md](docs/paste-guide.md): which file each AI reads and how (Claude Code and Codex, Cursor and Gemini read theirs from the folder automatically; claude.ai and ChatGPT take a paste), and what to re-paste when you change an answer.

## The agent onboarding file

The installer asks you how an AI should work with you, then writes the answers to `AGENT_ONBOARDING.md`: how to talk to you, how to shape output, what to read first and in what order, where it may write, how to save a file, and what it must always ask before doing. It is generated from your answers in `.agent-personalizer.json`, so every AI you point at the folder gets the same manual, and re-running the installer changes it everywhere at once.

- **Interactive**: run the installer without `--yes` and answer the questions. Enter accepts the default.
- **Scripted**: `--answers my-answers.json` (see [`test/fixtures/answers.json`](test/fixtures/answers.json) for the shape). Unknown keys, wrong types or unknown choices are refused before anything is written.
- **Defaults**: `--defaults` or `--yes`. The defaults are one working setup: direct, short, one-line corrections, settle facts yourself and ask only when the answer changes what gets built, verdict first, bullets, evidence inline, sign every edit, always ask before delete / publish / send / spend / settings / standing rules. Every one is a question you can answer differently.

`USER.md` is generated from the same answers the first time and is then yours to edit. Re-running with changed answers regenerates `AGENT_ONBOARDING.md` and every rendered block; `USER.md` is regenerated only if you never edited it (it still equals the render of the previous answers), otherwise it is kept and the installer names the answers that changed so you can carry them over by hand. Two rules depend on answers: the signature rule renders only when you answered yes, and the output-style rule defers to your stated shape instead of imposing one. The session-start contract carries a short version of the onboarding block, restrictions first, so it is present at the moment of decision, not only in a file.

ChatGPT has two custom-instruction boxes with a character budget, so its render is the compact profile plus the onboarding block and only the `inject: true` rules, each box measured against the budget, and written twice: inside `chatgpt-custom-instructions.md` with the counts, and as two plain paste files, `chatgpt-box1.txt` and `chatgpt-box2.txt`. `render.cjs --strict` exits 1 instead of writing when a box is over budget, for people who wire the render into CI. Nothing is cut silently: an over-budget box is written in full and flagged, ordered so the last lines are the cheapest to trim. For the rest of the rules, use a ChatGPT Project and upload `AGENT_ONBOARDING.md` and `rules/` as files.

## Level 1: one file

1. Fill in [`templates/USER.md`](templates/USER.md), or let the installer generate it from your onboarding answers. Who you are, how to talk to you, how firmly you mean things, how you want output shaped.
2. Copy [`templates/CLAUDE.md`](templates/CLAUDE.md) for Claude, or [`templates/AGENTS.md`](templates/AGENTS.md) for Codex, Cursor and most other coding agents. Both are pointers: they tell the AI to read `USER.md` first and where everything else lives.
3. Paste the `USER.md` body into the "custom instructions" box of any chat app that has one.

**The one idea in level 1:** the home file carries pointers, not hand-maintained copies. Text you retype drifts. A pointer does not, and neither does a block the renderer regenerates and `--check` compares (level 3): that block is a generated snapshot, with one owner and a drift check, which is the other acceptable shape.

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

- **Rule source + renderer.** Each rule is one file in [`rules/`](rules/), copied into your folder at level 3 (levels 1 and 2 render from the package's rules and copy nothing), with three fenced blocks: `universal` (any AI), `personal` (your curation), `binding:<ai>` (tool names and paths for one AI). [`render/render.cjs`](render/render.cjs) renders `USER.md` plus the rules into `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, ChatGPT custom-instruction boxes, or a plain system prompt. A rule can say `requires: signature=yes` and then renders only when the answer matches. `--check` fails if any rendered file drifted from its source. The runtime files are `.cjs` so they run inside a `"type": "module"` project too.
- **Session-start contract.** [`hooks/`](hooks/) shows how to inject the rules in full at the start of every Claude Code session, and the plain-prompt fallback for AIs without hooks. The contract carries the onboarding block first, in order of consequence (always-ask, off-limits, write policy, then style), so a token budget trims style before it trims a restriction. Injection puts the text in context; whether the model follows it is host- and model-dependent.
- **Drift check.** `node render/render.cjs --dir . --check` in CI or a pre-commit hook (`npm run check` inside this repo). It compares each rendered block with what the sources would render now: it detects rendering drift, not whether two hand-written files agree in meaning.
- **Forbidden-string gate.** [`check/gate.cjs`](check/gate.cjs) scans every file git would ship (or every file under a folder, with `--all`), text and file paths, for the exact strings in a gitignored list, never follows symlinks, and fails closed when the list is missing. This repo runs it on itself before every push. Copy `check/forbidden.example.txt` to `check/forbidden.local.txt` and fill it in. It is a check for the strings you listed, not a proof that no personal data ships: unknown terms, git history and binary files are outside it.

## Companion tools

Two companions turn the onboarding answers from advice into enforcement. Neither is required. [docs/companions.md](docs/companions.md) has the detail and a table of how each note tool is reached.

- **[obsidian-tc](https://github.com/The-40-Thieves/obsidian-tc)** for Obsidian vaults: governed MCP access. Your **off-limits** answer becomes a folder ACL, your **always-ask** answer becomes its human-in-the-loop list, and destructive tools fail closed until you confirm. `npx obsidian-tc /path/to/vault`.
- **[The Context Layer](https://sierracatalina.com/context-layer)** by Sierra Catalina: purpose-bound context with receipts. Capture → normalize → vault → decide → bundle → act; memory writes remain proposals. Your **write policy** and **off-limits** answers are its decide and vault stages in miniature. Read the essay first, then run the starter.

## Level 4: hand-off

Once you run several AIs, personalization is not the problem any more; routing is. That is a separate layer: which model handles which task, task bundles for every delegation, and CLI runs that only count as success when a deliverable exists. It is being built as its own repo and will link from here when it ships. This repo stays the beginner tier of that stack.

---

## Every rule carries its story

Open any file in [`rules/`](rules/). Each ends with an `origin` block: the failure that produced the rule and the failure it prevents. Rules without a story get argued with. Rules with one get followed, by people and by models. When you write your own, fill the block in. It is the most useful thing in the file.

---

## Repo map

```
templates/   USER.md, CLAUDE.md, AGENTS.md, FOLDER_README.md, session-log.md, decisions-log.md, INBOX_README.md
render/onboarding.cjs   the interview questions, their defaults, and the USER.md / AGENT_ONBOARDING.md / contract renders
rules/       example rules in the three-fence format, plus the format spec
render/      render.cjs and the target table
hooks/       Claude Code session-start contract, plain-prompt fallback
check/       gate.cjs, the forbidden-string gate this repo runs on itself
bin/         the npx installer
examples/    one invented user, end to end
docs/        tiers.md, companions.md, paste-guide.md
CHANGELOG.md keyed on audit rounds
.github/     harness.yml: the checks on every push and PR, Ubuntu and macOS x Node 18/20/22, plus a Windows smoke job; publish.yml: npm publish with provenance, dispatched per tag
test/        run.sh: 82 checks, exact exit codes, adversarial fixtures (symlinks, traversal, malformed markers, CRLF, partial renders)
```

## Changelog

[CHANGELOG.md](CHANGELOG.md). Every entry names the audit round that produced it.

## Contributing

Open an issue with the failure you hit, not the feature you want. Rules come from failures. [CONTRIBUTING.md](CONTRIBUTING.md) has the checks, the rule format and how to add a notes tool or an AI target. Every push and pull request runs the harness on Ubuntu and macOS ([.github/workflows/harness.yml](.github/workflows/harness.yml)); the privacy gate against a real forbidden list stays local by design, so CI shows that one check as a skip.

---

## License

MIT ([LICENSE](LICENSE)). You may use, change, share and sell copies for any purpose; keep the notice; no warranty, no endorsement implied. Attribution is appreciated, not required: *Built with agent-personalizer (https://github.com/aunysillyme/agent-personalizer)*.

Security reports: [SECURITY.md](SECURITY.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Releases: [RELEASING.md](RELEASING.md).

Built in public by [@AunySillyMe](https://x.com/AunySillyMe).
