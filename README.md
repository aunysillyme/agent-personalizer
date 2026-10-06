# agent-personalizer

[![npm](https://img.shields.io/npm/v/agent-personalizer.svg)](https://www.npmjs.com/package/agent-personalizer) [![harness](https://github.com/aunysillyme/agent-personalizer/actions/workflows/harness.yml/badge.svg)](https://github.com/aunysillyme/agent-personalizer/actions/workflows/harness.yml) [![release](https://img.shields.io/github/v/tag/aunysillyme/agent-personalizer?label=release)](https://github.com/aunysillyme/agent-personalizer/blob/main/CHANGELOG.md) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Answer a few questions once, and every AI you use gets the same profile and the rules it can carry:** Claude Code, Codex, Cursor, Gemini CLI and ChatGPT, rendered from one source and kept in sync.

**The problem:** Custom instructions live in each app separately, drift apart and fade over a long chat.

**What you get:** One profile and one rule source, rendered into the exact file each AI reads, with a check that fails when a generated copy drifts.

## Quick start

```bash
npx agent-personalizer
```

![Terminal recording of the short interview, its answers, and the profile, onboarding and AI instruction files it writes.](docs/demo.gif)

## What it sets up

| Part | What it gives you |
|---|---|
| `USER.md` | Your profile, communication preferences and how firmly you mean things. It owns the profile in every profile export. |
| `AGENT_ONBOARDING.md` | Your AI's reading order, writing policy, off-limits topics and approval steps. |
| `CLAUDE.md` | Your profile and selected rules in Claude Code's project instruction file. |
| `AGENTS.md` | Your profile and selected rules in the project file used by Codex and Cursor. |
| `GEMINI.md` | Your profile and selected rules in Gemini CLI's instruction file. |
| ChatGPT paste files | `chatgpt-box1.txt` for your profile and `chatgpt-box2.txt` for response instructions, plus a preview with counts. |
| `system-prompt.md` | Shareable universal rules for another chat app, bot or API. |
| Notes folder, level 2 | A folder index, weekly session template, decisions log and inbox for local or fallback notes tools. |
| `rules/`, level 3 | Editable rule sources with universal, personal, AI-specific and origin sections. |
| Renderer, level 3 | Regenerate the selected AI files from your profile, rules and onboarding answers. |
| Drift check, level 3 | A failing check when a generated block or ChatGPT paste file differs from its source. |
| Session-start contract, level 3 | Put your onboarding restrictions and selected rules into context at session start. |
| Forbidden-string check, level 3 | Catch text and paths matching your private list before sharing files. |
| `.agent-personalizer.json` | Your targets, level, answers and installed-file history for later runs and removal. |

## After you install

Start your AI in the installed project folder. Ask it which instruction file loaded and what your writing policy is. Confirm those answers against AGENT_ONBOARDING.md before the first write.

For ChatGPT, open Settings → Personalization and enable customization. Copy the exported profile (`chatgpt-box1.txt`) and response instructions (`chatgpt-box2.txt`) into the fields your current interface provides, checking its displayed limits. Re-paste after updates; the [paste guide](docs/paste-guide.md) covers each app.

File generation, re-runs and uninstall run in CI on Linux, macOS and Windows; your client's context view confirms loading on your setup.

## Part of a set

Three open-source tools that work on their own and fit together:

| Repo | What it gives you |
|---|---|
| **agent-personalizer** | One interview writes the profile and rules every AI you use reads, kept in sync from one source. |
| [model-orchestrator](https://github.com/aunysillyme/model-orchestrator) | Model router for AI coding agents: installs routing rules, 8 subagents, hooks and a CLI runner so your AI picks model and effort per task and saves tokens. |
| [website-build-skill](https://github.com/aunysillyme/website-build-skill) | A skill pack that teaches your AI current website-building expertise: research, design, code, accessibility, performance, search and security. |

## Choose your setup

The short interview asks seven base questions, plus any that apply to your notes tool. Enter accepts each default. For the full interview, which asks up to 23 applicable questions:

```bash
npx agent-personalizer --full
```

| Level | What you get |
|---|---|
| **1. Profile and home files** | The profile, onboarding and target-specific instructions for the AIs you pick. |
| **2. Dynamic docs** | Everything above, plus local notes templates maintained under your writing policy. Cloud notes tools use connector pointers. |
| **3. Mechanisms** | Everything above, plus local rule sources, the renderer, drift check, hook and forbidden-string gate. |

For a headless install with defaults:

```bash
npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --defaults
```

Node 22 or 24 (active LTS) is recommended; 18 or later runs. Published on npm with provenance. [Installation](docs/install.md) covers scripted answers, every flag, notes tools and manual copying.

The tool runs locally after `npx` fetches the package. The installer and renderer make no network calls, send no telemetry and read no environment variables. Writes stay inside the folder you name, with edited files preserved and named.

## Keep it in sync

Re-run the installer to change answers or upgrade an install. Use the interview or supply a JSON file:

```bash
npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --answers my-answers.json
```

Untouched installer files update to what a fresh install with those answers would create. Edited files stay yours. Home pointer lines that still match the previous template update or disappear when obsolete; edited lines stay byte for byte and are named for manual review. Changing the notes path keeps the old folder and names it next to the new one. Upgrading refreshes untouched tools and rule copies; edited copies are kept with a replacement step.

`USER.md` updates while it remains an untouched installer profile. An edited or pre-existing profile stays the source for every profile export, including ChatGPT. Changed onboarding answers are named so you can carry them into your profile by hand.

At level 3, edit `USER.md` or a source in `rules/`, then render and check:

```bash
node render/render.cjs --dir .
node render/render.cjs --dir . --check
```

`--check` exits 0 when current, 1 on drift and 2 on invalid input. Start a new client session to load changed files and re-paste exports into chat apps. Each rule's `origin` section explains the failure it prevents; keep that story when adding a rule. See [updating an install](docs/install.md#updating-an-install).

## Put the contract in context

At level 3, [register the Claude Code hook](hooks/README.md) to inject the onboarding restrictions and `inject: true` rules at session start. For another AI, generate a prompt to paste into its first message:

```bash
node render/render.cjs --dir . --contract > contract.txt
```

The [instruction tiers](docs/tiers.md) explain where style, home files, contracts, rule owners and memory belong. The contract puts your instructions in context; your host and model apply them.

## Check for private strings

At level 3, copy the example list, fill it with your identifiers and keep it in your project's `.gitignore`:

```bash
cp check/forbidden.example.txt check/forbidden.local.txt
node check/gate.cjs --dir .
```

The gate checks file text and paths against that list. A missing or malformed list is refused. [Configure the gate](docs/guarantees.md#forbidden-string-gate) for your project before sharing it.

## Companion tools

Select your notes tool during the full interview:

```bash
npx agent-personalizer --full
```

[Companion setup](docs/companions.md) explains notes connectors and how to turn onboarding answers into tool permissions and approval steps.

| Tool | What it gives you |
|---|---|
| [obsidian-tc](https://github.com/The-40-Thieves/obsidian-tc) | Governed Obsidian access: configure folder permissions from your off-limits answer and human approval from your always-ask answer. |
| [The Context Layer](https://sierracatalina.com/context-layer) | Purpose-bound context with receipts; its decide and vault stages apply your write policy and off-limits boundaries. |

## Common questions

### How do I share custom instructions across Claude Code, Codex, Cursor and ChatGPT?

Run `npx agent-personalizer` and select the AIs you use. One profile and rule source produce the instructions each target can carry; ChatGPT gets its profile and selected session rules as paste files.

### Which instruction files does each AI use?

Choose targets with `npx agent-personalizer --dir . --ai claude,agents,gemini,chatgpt --level 1 --yes --defaults`. It creates `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and the ChatGPT exports shown in [What it sets up](#what-it-sets-up); the [paste guide](docs/paste-guide.md) explains loading and activation.

### How do I update my AI profile or change an answer?

For answers, run `npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --answers my-answers.json`. At level 3, edit `USER.md` or `rules/`, then run `node render/render.cjs --dir .`; re-paste changed chat exports.

### How do I check generated instructions for drift?

At level 3, run `node render/render.cjs --dir . --check`. Exit 0 means the generated blocks and paste files match their sources; exit 1 identifies drift and exit 2 names invalid input.

### How do I upgrade installed tools safely?

Re-run `npx agent-personalizer --dir . --ai claude,agents --level 3 --yes --defaults` with the newer package. Untouched tools refresh, edited copies stay and the log gives the replacement step.

### How do I uninstall agent-personalizer and keep my notes?

Preview with `npx agent-personalizer --uninstall --dir . --dry`, then run `npx agent-personalizer --uninstall --dir .`. Edited files and user-written notes stay, and the log names retained installed files.

## Uninstall

Preview with --uninstall --dry. Removal compares recorded install hashes, keeps edited files and notes, and lists any hook registration you must remove.

```bash
npx agent-personalizer --uninstall --dir . --dry
npx agent-personalizer --uninstall --dir .
```

The inventory covers every path recorded by any install run, including earlier notes folders and rules omitted by later answers. Existing home files keep their own text while an unchanged generated block is removed. Only install-created empty folders are removed; the configuration goes last and stays while tracked files are retained. See [removal details](docs/install.md#uninstall).

## Read next

Start at the [documentation index](docs/README.md):

- **[Install and uninstall](docs/install.md):** flags, scripted answers, re-runs, upgrades and removal.
- **[Instruction tiers](docs/tiers.md):** where each kind of instruction belongs.
- **[Paste guide](docs/paste-guide.md):** how each AI loads its files and how to activate exports.
- **[Companions](docs/companions.md):** notes connectors and enforcement tools.
- **[Guarantees](docs/guarantees.md):** source ownership, drift checks, preflight and runtime safety.
- **[Changelog](CHANGELOG.md):** release history.
- **[Support](SUPPORT.md):** question, bug, feature and private security routes.

**For agents:** read [`llms.txt`](llms.txt) for documentation links and [`AGENTS.md`](AGENTS.md) for contributor instructions. Headless setup: `npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --defaults`.

## Contributing

Contributions are welcome: a new AI target, a notes tool, an example user, or a failure you hit with steps to reproduce it. [CONTRIBUTING.md](CONTRIBUTING.md) covers the rule format and checks; [MAINTAINERS.md](MAINTAINERS.md) names the owner and release responsibilities.

The harness (`test/run.sh: 98 checks`) tests exact exit codes and adversarial fixtures. The real forbidden-list check stays local and prints a skip when the private list is absent.

## License

[MIT](LICENSE). Use, change, share and sell copies under its terms. Attribution is appreciated: *Built with agent-personalizer (https://github.com/aunysillyme/agent-personalizer)*.

Security reports: [SECURITY.md](SECURITY.md). Releases: [RELEASING.md](RELEASING.md).

Built in public by [@AunySillyMe](https://x.com/AunySillyMe).
