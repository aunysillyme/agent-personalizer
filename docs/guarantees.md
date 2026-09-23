# What the code enforces

agent-personalizer is an installer and renderer. Its checks enforce file consistency and safe handling of paths. The generated profile, onboarding manual and session-start contract give the AI your working instructions. The AI applies those instructions when it works; its behaviour depends on the host and model.

## Rendering and drift checks

Each render comes from `USER.md`, the selected rule source and the onboarding answers in `.agent-personalizer.json`. At level 3, `rules/` is your local editable source; lower levels use the package's rules.

- **One source:** edit the profile, rule files or onboarding answers, then regenerate the selected AI files together.
- **Byte fidelity:** the renderer preserves bytes outside generated markers, including line endings.
- **Drift detection:** `node render/render.cjs --dir . --check` compares the current generated blocks with what the sources would render now. It exits `1` when they differ.
- **Paste updates:** re-paste regenerated files into chat-app instruction fields. The check compares files on disk.
- **ChatGPT budget:** each box reports its character count against the limit in `render/targets.json`. Over-budget text is preserved and flagged. `--strict` exits `1` before writing when a box exceeds that limit.

The check measures rendered-file consistency. The [instruction tiers](tiers.md) explain how those files and hooks place instructions in front of the AI.

## Preflight and writes

The installer validates answers, configuration, source files and target marker structure before its write phase. The renderer validates its full target plan before replacing files.

- **Paths:** paths beneath the installation root must be real files and directories. Symlinks and paths outside the root are refused.
- **Markers:** each target may have one correctly ordered generated block or be ready for its first block. Malformed blocks are refused.
- **Encoding:** sources and targets must contain valid UTF-8; invalid bytes are refused instead of re-encoded.
- **Existing work:** the installer keeps existing notes and rules. It regenerates `USER.md` only while the profile matches the previous answers byte for byte.
- **Renderer recovery:** target writes are staged, existing files are backed up, and a write failure triggers rollback. An incomplete restore keeps and names its backup with exit `2`.
- **Local operation:** the tool makes no network calls, sends no telemetry and reads no environment variables. `npx` fetches the package before execution.

The installer's upgrades can replace its own unchanged pointer lines as you add notes or local rules. The renderer's byte-fidelity promise applies to everything outside its marked block.

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

## Instructions and companions

The onboarding manual tells the AI where it may write, what is off limits and when to ask. The session-start hook prints those restrictions and the selected rules into context. Notes templates instruct the AI to maintain an index, session notes, decisions and inbox entries.

To make those answers govern tool access, configure a [companion](companions.md):

- **obsidian-tc:** folder access controls and human approval for destructive Obsidian operations.
- **The Context Layer:** purpose-bound context, approval decisions and receipts for actions and disclosures.

These controls live in the companion's configuration. The interview records the policy and renders the instructions that refer to it.
