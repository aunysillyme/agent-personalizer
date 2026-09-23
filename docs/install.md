# Install and use agent-personalizer

The installer writes a profile, an onboarding manual and the instruction files for the AIs you choose. It stores your answers in `.agent-personalizer.json` so later runs can update the files together.

## Requirements

Use Node 18 or later. The installer, renderer and gate run on macOS, Linux and Windows. The shell harness and session-start hook need a POSIX shell; use WSL or Git Bash on Windows.

## Interactive setup

```bash
npx agent-personalizer
```

Choose the destination folder, AI targets and install level. The default interview asks seven questions that change behaviour, plus any question that applies to your notes tool. Enter accepts the displayed default.

For the full interview:

```bash
npx agent-personalizer --full
```

This asks up to 23 questions; questions that do not apply to your notes tool are skipped. `--quick` explicitly selects the short interview, which is already the default. Both interview flags require a terminal and the interactive answer source.

To run one specific release, add the version:

```bash
npx agent-personalizer@<version>
```

## Answer sources and headless runs

| Option | What it does |
|---|---|
| `--defaults` | Accepts every default answer. It works with interactive folder selection or with `--yes`. |
| `--answers my-answers.json` | Loads your answers from a JSON file. |
| `--answers -` | Reads the answer JSON from stdin. |
| `--yes` | Selects non-interactive mode. Supply `--dir`, `--ai` and `--level`. It uses defaults when an answer source is omitted. |

Default answers:

```bash
npx agent-personalizer --dir . --ai claude,agents --level 1 --yes --defaults
```

Your answers:

```bash
npx agent-personalizer --dir . --ai claude,agents --level 2 --yes --answers my-answers.json
```

Answers from stdin:

```bash
npx agent-personalizer --dir . --ai claude,agents --level 2 --yes --answers - < my-answers.json
```

Use [`test/fixtures/answers.json`](../test/fixtures/answers.json) as a complete example. Partial answer objects take defaults for the remaining fields. Unknown keys, invalid types and unknown choices are refused before writing files. Choose either `--answers` or `--defaults` for a run. A rerun using defaults preserves previously stored onboarding answers.

## Installer flags

| Flag | Purpose |
|---|---|
| `--dir <folder>` | Destination folder; prompted in interactive mode. |
| `--ai claude,agents,gemini,chatgpt,prompt` | Comma-separated targets. Choose the ones you use. |
| `--level 1`, `--level 2`, `--level 3` | Profile and home files; add local notes; add editable rules and mechanisms. |
| `--answers <file.json>` or `--answers -` | Script the interview. |
| `--defaults` | Accept default answers. |
| `--yes` | Run without interactive prompts. |
| `--full` | Run the full applicable interview in a terminal. |
| `--quick` | Run the short interview in a terminal. |
| `--uninstall` | Remove unchanged installed files using the stored configuration. |
| `--dry` | Preview `--uninstall` without writing. |
| `--help`, `-h` | Print usage. |
| `--version`, `-v` | Print the package version. |

For compatibility with older scripts, `--level 4` remains an alias of `--level 3` and installs exactly the same files. For routing between agents, use [model-orchestrator](https://github.com/aunysillyme/model-orchestrator).

Installer exit codes: `0` completed, `1` unexpected error, `2` refused or invalid input.

## What each level adds

- **Level 1:** `USER.md`, `AGENT_ONBOARDING.md`, the files for your AI targets, and `.agent-personalizer.json`. Rules render from the package. The default target selection is `claude,agents`, so it produces both `CLAUDE.md` and `AGENTS.md`.
- **Level 2:** a local notes scaffold with `README.md`, `sessions/TEMPLATE-week.md`, `decisions.md` and `inbox/README.md`. Disk tools use your `notes_path`; read-only and other tools use the local `notes/` fallback. Cloud tools get connector pointers and keep their notes in their service.
- **Level 3:** your editable `rules/` copy, `render/` tools, the Claude Code session-start hook and the forbidden-string gate. [Register the hook](../hooks/README.md) in your AI settings and [configure the gate](guarantees.md#forbidden-string-gate).

An existing local notes scaffold is detected at any level. Existing notes and rule files stay yours. A `signature: no` answer omits the signature rule and its template lines; answering yes includes the signature line.

## Updating an install

Re-run the installer with your destination, AI selection and level. An interview or `--answers` file supplies new onboarding answers. Existing targets remain in the stored selection, so the renderer updates them together.

`AGENT_ONBOARDING.md` and rendered blocks regenerate from the answers. `USER.md` regenerates only when its bytes still match the previous answers. An edited profile stays; the installer names changed answers so you can update the profile by hand. Home-file text outside the markers is preserved, with installer-owned pointer lines updated when you add notes or local rules.

At level 3, render your edited profile and rules:

```bash
node render/render.cjs --dir .
node render/render.cjs --dir . --check
```

The check returns `0` for current files, `1` for drift, and `2` for invalid inputs. `--targets claude,agents` selects specific renders; `--rules <folder>` selects a rule source. `--strict` returns `1` and writes nothing when a ChatGPT box is over the configured budget. Run `node render/render.cjs --help` for contract and target options.

Re-paste changed text into chat apps. See the [paste guide](paste-guide.md) for the files each app needs.

## npm cache permissions

If `npx` reports `EPERM` and root-owned files in `~/.npm`, give this run a writable cache in the current folder:

```bash
npm_config_cache=./.npm-cache npx agent-personalizer
```

## Manual copying

For a setup without Node, download this repository and copy [`templates/USER.md`](../templates/USER.md) plus [`templates/CLAUDE.md`](../templates/CLAUDE.md) or [`templates/AGENTS.md`](../templates/AGENTS.md) into your project. Fill in the profile and adapt the home template's pointers to the files you keep. For a chat app, paste the profile body into its instruction field.

The interview, automatic rendering and drift check are available when you use the Node installer. [The paste guide](paste-guide.md) covers manual app setup.

## Uninstall

Run from anywhere and name the installed folder:

```bash
npx agent-personalizer --uninstall --dir /path/to/project --dry
npx agent-personalizer --uninstall --dir /path/to/project
```

The uninstaller reads `/path/to/project/.agent-personalizer.json` and compares tracked files with what the stored answers and current sources would produce. Install records the exact bytes it wrote for each tracked file, so uninstall recognizes them correctly even after the package itself has moved on to a newer release.

- **Generated files:** removed when unchanged. Edited files are kept and named in the output.
- **Existing home files:** user text stays; only an unchanged generated block is removed.
- **`USER.md`:** removed only when it still matches the render of the stored answers.
- **Notes scaffold:** unchanged template files are removed. Your notes stay, and folders are removed only when empty.
- **Rules and tools:** unchanged installed copies are removed file by file, including the session-start hook. Edited copies stay.
- **Hook registration:** remove the matching `SessionStart` entry from `.claude/settings.json` or `~/.claude/settings.json` yourself. The uninstaller prints this step; it never edits settings outside the installation.
- **Paths:** the uninstaller never follows symlinks or removes a path outside the named folder. A refused path leaves the removal plan unapplied.
- **Configuration:** `.agent-personalizer.json` is removed last, only after every path it tracks is gone. A retained file, including a pre-existing home file with its block removed, keeps the configuration available for review.

`--dry` previews the same decisions without writing. A missing configuration exits `2` and names the expected path. Keep the configuration while reviewing any edited files the uninstaller retained.
