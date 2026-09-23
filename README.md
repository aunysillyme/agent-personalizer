# agent-personalizer

[![npm](https://img.shields.io/npm/v/agent-personalizer.svg)](https://www.npmjs.com/package/agent-personalizer) [![harness](https://github.com/aunysillyme/agent-personalizer/actions/workflows/harness.yml/badge.svg)](https://github.com/aunysillyme/agent-personalizer/actions/workflows/harness.yml) [![release](https://img.shields.io/github/v/tag/aunysillyme/agent-personalizer?label=release)](https://github.com/aunysillyme/agent-personalizer/blob/main/CHANGELOG.md) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Answer a few questions once, and every AI you use gets the same profile and rules:** Claude Code, Codex, Cursor, Gemini and ChatGPT, rendered from one source and kept in sync.

**The problem:** custom instructions live in each app separately, drift apart, fade over a long chat, and an AI's guesses about you start to read like your rules.

**What you get:** one profile and one rule source, rendered into the exact file each AI reads, with a check that fails when a copy drifts and a status on every remembered fact.

## Quick start

```bash
npx agent-personalizer
```

The installer asks for the folder, which AIs you use, and the level. The short interview asks seven questions by default, plus any that apply to your notes tool. Enter accepts each default.

![Terminal recording of the short interview, its answers, and the profile, onboarding and AI instruction files it writes.](docs/demo.gif)

For a headless install with defaults:

```bash
npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --defaults
```

For the full interview, asking up to 23 questions, only the ones that apply to your notes tool:

```bash
npx agent-personalizer --full
```

Requires Node 18 or later. The npm package is published with provenance from this repository's workflow. To pin the GitHub source to this release, use `npx github:aunysillyme/agent-personalizer#v0.6.0`. See [installation](docs/install.md) for scripted answers, the npm cache fix, manual copying, and every flag.

Privacy:

- **Runs locally:** after `npx` fetches the package from npm or GitHub, the tool runs on your machine. That fetch is the one network step.
- **No telemetry:** the installer and renderer make no network calls and read no environment variables.
- **Writes only into the folder you name:** existing user files are preserved, and generated blocks update from their sources.

## What it writes

- **`USER.md`:** your profile, communication preferences, output shape, and the difference between your preferences and rules.
- **`AGENT_ONBOARDING.md`:** the AI's manual, including what to read first, where it may write, and what needs your approval.
- **AI instruction files:** your profile and rules in each selected AI's format.
- **`.agent-personalizer.json`:** the selected targets, level, and onboarding answers used by later runs.

Here is a real excerpt from the invented [freelance illustrator example](examples/freelance-illustrator/). The renderer copies the same profile into both home files.

[`USER.md`](examples/freelance-illustrator/USER.md):

```markdown
## Who I am

- **Name and pronouns:** Mara, she/her
- **What I do:** freelance illustrator. Book covers and editorial work, some client branding on the side.
```

Inside the generated block in [`CLAUDE.md`](examples/freelance-illustrator/CLAUDE.md):

```markdown
## Who I am

- **Name and pronouns:** Mara, she/her
- **What I do:** freelance illustrator. Book covers and editorial work, some client branding on the side.
```

Inside the generated block in [`AGENTS.md`](examples/freelance-illustrator/AGENTS.md):

```markdown
## Who I am

- **Name and pronouns:** Mara, she/her
- **What I do:** freelance illustrator. Book covers and editorial work, some client branding on the side.
```

## Works with

| AI | File | How it loads |
|---|---|---|
| Claude Code | `CLAUDE.md` | Reads it from the working folder automatically. |
| Codex and Cursor | `AGENTS.md` | Read it from the project root automatically. |
| Gemini CLI | `GEMINI.md` | Reads it from the folder automatically. |
| claude.ai and Claude Projects | `USER.md` and `AGENT_ONBOARDING.md` | Paste their bodies into custom or project instructions. |
| ChatGPT | `chatgpt-box1.txt` and `chatgpt-box2.txt` | Paste into the custom-instruction boxes; `chatgpt-custom-instructions.md` shows the same text with counts. |
| Other chat apps, bots and APIs | `system-prompt.md` | Paste into the system-prompt field. It contains the shareable universal rules. |

The [paste guide](docs/paste-guide.md) covers each app, ChatGPT's box budget, and what to re-paste after an update.

## Levels

Choose the files and tools you want the installer to add:

| Level | What it gives you | What it writes |
|---|---|---|
| **1. Profile and home files** | The same profile and rules for the AIs you pick. | `USER.md`, `AGENT_ONBOARDING.md`, one home file per AI, and `.agent-personalizer.json`. ChatGPT also gets plain paste files for its boxes. |
| **2. Dynamic docs** | A notes folder the AI keeps under your writing rules. | Everything in level 1, plus a folder index, weekly session-log template, decisions log and inbox for local notes tools. |
| **3. Mechanisms** | Editable rules and tools that keep the generated files in sync. | Everything above, plus your own `rules/`, renderer, session-start hook, drift check and forbidden-string gate. |

Level 2 creates a local notes folder for disk tools such as Obsidian, Logseq and plain markdown. OneNote, Evernote and other tools use a local fallback. Cloud tools such as Notion get connector pointers and keep their notes in the cloud. Existing local notes scaffolds are detected at any level.

The notes templates give the AI a place for session notes, decisions and inbox items. When you answer yes to signing edits, its instructions include `Last edited by: <ai> <model> <date> · <ten words>`, overwritten on each edit. The AI maintains these notes according to your instructions.

Level 3 adds four pieces:

- **Rule source and renderer:** edit one file in `rules/`; render its universal, personal and AI-specific text into each target.
- **Session-start contract:** put the onboarding restrictions and `inject: true` rules into context when a Claude Code session starts. [Register the hook](hooks/README.md), or generate a plain prompt for another AI.
- **Drift check:** compare generated blocks with what their sources render now, and fail when they differ.
- **Forbidden-string gate:** check file text and paths for strings in your private list before sharing. [Configure the gate](docs/guarantees.md#forbidden-string-gate).

The [five instruction tiers](docs/tiers.md) explain where style, home files, session contracts, rule owners and memory belong. [Guarantees](docs/guarantees.md) explains what the code enforces and how the instructions reach the AI.

## Keep it in sync

Re-run the installer to change your answers. Use the interview or supply a JSON file:

```bash
npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --answers my-answers.json
```

`AGENT_ONBOARDING.md` and the selected rendered blocks update together. `USER.md` updates when it still matches the previous answers byte for byte. An edited profile stays yours; the installer names changed answers for you to carry over.

At level 3, edit `USER.md` or `rules/`, then render and check:

```bash
node render/render.cjs --dir .
node render/render.cjs --dir . --check
```

`--check` exits 0 when current, 1 on drift, and 2 on invalid input. Files your AI reads automatically are ready for the next session. Re-paste the updated text into chat apps. See [installation](docs/install.md#updating-an-install) for the full update flow.

## Part of a set

Three open-source tools that work on their own and fit together:

| Repo | What it gives you |
|---|---|
| **agent-personalizer** | One interview writes the profile and rules every AI you use reads, kept in sync from one source. |
| [model-orchestrator](https://github.com/aunysillyme/model-orchestrator) | Routing rules that tell your agent which model handles each task, so frontier models do the hard work and cheaper tiers do the rest. |
| [website-build-skill](https://github.com/aunysillyme/website-build-skill) | A skill pack that teaches your AI current website-building expertise: research, design, code, accessibility, performance, search and security. |

## Companion tools

These optional tools turn onboarding answers into access controls and approval steps. [Companion setup](docs/companions.md) covers their configuration and how each notes tool is reached.

| Tool | What it gives you |
|---|---|
| [obsidian-tc](https://github.com/The-40-Thieves/obsidian-tc) | Governed Obsidian access: configure folder permissions from your off-limits answer and human approval from your always-ask answer. |
| [The Context Layer](https://sierracatalina.com/context-layer) | Purpose-bound context with receipts; its decide and vault stages apply your write policy and off-limits boundaries. |

## Uninstall

Preview removal, then run it:

```bash
npx agent-personalizer --uninstall --dir . --dry
npx agent-personalizer --uninstall --dir .
```

The uninstaller compares files with the current render and templates. Unchanged generated files are removed. Edited files and your notes stay, and kept files are named. Existing home files keep their own text; only an unchanged generated block is removed. Remove any session-start hook registration from your AI's settings when prompted. See [removal details](docs/install.md#uninstall).

## For agents

Read [`llms.txt`](llms.txt) for documentation links and [`AGENTS.md`](AGENTS.md) for contributor instructions. Headless setup: `npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --defaults`.

## Every rule carries its story

Each file in [`rules/`](rules/) ends with an `origin` block: the failure that produced the rule and the failure it prevents. Fill it in when you add a rule so a reader can see why it exists and when it applies.

## Docs

Start at the [documentation index](docs/README.md):

- **[Install and uninstall](docs/install.md):** flags, scripted answers, updates and removal.
- **[Instruction tiers](docs/tiers.md):** where each kind of instruction belongs.
- **[Paste guide](docs/paste-guide.md):** how each AI loads its files.
- **[Companions](docs/companions.md):** notes connectors and enforcement tools.
- **[Guarantees](docs/guarantees.md):** rendering, checks, preflight and runtime safety.
- **[Changelog](CHANGELOG.md):** release history.

## Common questions

**How do I keep the same custom instructions across Claude Code, Codex, Cursor and ChatGPT?** One interview writes `USER.md` and `rules/` once, and the renderer copies that same profile and rules into every AI's own file. Run `npx agent-personalizer` and pick every AI you use, for example `--ai claude,agents,gemini,chatgpt,prompt`.

**Which files does it write for each AI?** Claude Code reads `CLAUDE.md`, Codex and Cursor read `AGENTS.md`, Gemini CLI reads `GEMINI.md`, and ChatGPT takes `chatgpt-box1.txt` and `chatgpt-box2.txt` pasted into its two custom-instruction boxes. See [Works with](#works-with) for the full table and the [paste guide](docs/paste-guide.md) for every app.

**How do I change an answer later?** Re-run the installer with the interview, or supply a JSON answers file: `npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --answers my-answers.json`. `AGENT_ONBOARDING.md` and the rendered blocks update together, and `USER.md` regenerates only when it still matches your previous answers byte for byte. See [updating an install](docs/install.md#updating-an-install).

**How do I check that nothing drifted?** At level 3, run `node render/render.cjs --dir . --check`. It exits 0 when every generated file matches what its sources render now, and 1 when one has drifted.

**How do I remove it?** Preview first with `npx agent-personalizer --uninstall --dir . --dry`, then run `npx agent-personalizer --uninstall --dir .`. Unchanged generated files are removed, while edited files, your notes and a pre-existing home file's own text stay. See [removal details](docs/install.md#uninstall).

## Contributing

Contributions are welcome: a new AI target, a notes tool, an example user, or a failure you hit with steps to reproduce it. [CONTRIBUTING.md](CONTRIBUTING.md) covers the rule format and checks.

The harness (`test/run.sh: 91 checks`) tests exact exit codes and adversarial fixtures. Every push and pull request runs it on Ubuntu and macOS; Windows CI smoke-tests the Node entry points. The shell harness and hook run under WSL or Git Bash on Windows. The real forbidden-list check stays local and prints a skip when the private list is absent.

## License

[MIT](LICENSE). Use, change, share and sell copies under its terms. Attribution is appreciated: *Built with agent-personalizer (https://github.com/aunysillyme/agent-personalizer)*.

Security reports: [SECURITY.md](SECURITY.md). Releases: [RELEASING.md](RELEASING.md).

Built in public by [@AunySillyMe](https://x.com/AunySillyMe).
