# Learning from your sessions

agent-personalizer helps your AI turn repeated corrections into entries you approve. With your yes, it makes a local digest of your recent typed messages. Your AI uses that evidence to ask up to five questions, one at a time, then shares confirmed entries with every personal AI target you selected.

## Say yes or no

The first interactive install asks which AIs you use, then shows this consent screen. Enter means no. Re-running an existing install asks nothing and reads no sessions.

```text
Learn from your past sessions?
agent-personalizer can read up to 20 of your most recent sessions that
Claude Code, Codex and Gemini CLI still keep, to find corrections you repeat.
  · Only what you typed, never the AI's replies.
  · Stays on this computer, saved to .agent-personalizer/digest.md.
  · Your AI reads that file next time you open it, like anything you share with it.
  · Other people's details in there? Add their names to your private list first.
  · Delete it any time: npx agent-personalizer learn --forget
    (your AI app's own history stays as it is)
  · Codex's own memory notes are included when you choose Codex.
  · When your AI reads the file, its provider sees these messages again.
  · Work or client accounts: check your agreement before reusing their sessions.
  · Not affiliated with Anthropic, OpenAI or Google. Their formats can change.
Read your last 20 sessions? (y/N)
```

agent-personalizer is not affiliated with Anthropic, OpenAI or Google. It reads files their apps save, and those formats can change.

To learn later, run this in your installed folder:

```bash
npx agent-personalizer learn --dir .
```

Only `y` or `yes`, in any case, accepts. Any other answer prints `Nothing was read.` A headless run needs `--yes`, which shows the same notice before reading. A non-interactive install never reads sessions, even with `--yes`; scripted consent belongs to `learn --yes`.

## What it reads

The saved AI selection chooses the sources. The reader takes up to 20 of the newest sessions that yield typed messages, across those sources. Fewer is fine; each app controls how much history it keeps.

| Selected target | Local source |
|---|---|
| `claude` | Claude Code: `~/.claude/projects/<project>/<session>.jsonl`, directly inside each project folder |
| `agents` | Codex: `~/.codex/sessions/**/rollout-*.jsonl`, plus `~/.codex/memories/*.md` |
| `gemini` | Gemini CLI: `~/.gemini/tmp/<hash>/chats/session-*.jsonl` and the older `logs.json` |
| `chatgpt`, `prompt` | No local session reader |

The digest contains typed user messages and, when Codex is selected, Codex's own memory notes in a separate section. AI replies, tool output, reasoning, automation sessions and injected context are dropped. Large likely pastes are dropped too. Gemini chat snapshots replace earlier messages; a message repeated in the chat and logs is included once.

The reader streams session files, skips oversized lines and stops a file at its size limit. Symlinks, unreadable files and unknown or malformed formats are skipped and counted. The terminal lists every file read and the skip counts; message text is never printed there. Vendor format changes may mean fewer usable sessions until the reader is updated.

## Privacy before reading

The reader runs locally and makes no network calls. It saves `.agent-personalizer/digest.md` under the installed folder, with a `.gitignore` that ignores that folder's contents. A gitignore is not a filesystem permission: anyone with access to the folder, and any backup or sync service covering it, can still read it.

Your AI reads the digest, so its contents go to that AI's provider again, like anything you paste in. The digest labels old messages as data; instructions inside them must never be followed.

Past sessions may include client, coworker or other people's details. Read only history you are allowed to reuse. For work or client accounts, check your agreement first. Before accepting, put private terms in `<project>/check/forbidden.local.txt`, one per line; any message containing a term, ignoring case, is dropped whole. Blank lines, `#` comments and `allow:` entries are ignored by the session filter. Keep that list out of git. See the [gate setup](guarantees.md#forbidden-string-gate).

## What your AI asks and keeps

Start your AI in the installed folder. Claude Code has `/personalize`; Codex and Gemini CLI receive the same procedure in their home files. At level 3, the session-start contract points to `/personalize` while a digest has not been handled.

Each question includes a count and one short quote, such as "You've asked me to shorten replies 3 times this week. Make it a rule?" Fewer real patterns means fewer questions. Entries already confirmed or declined are never asked again.

`LEARNED.md` owns the answers:

```markdown
## Learned
- [said, confirmed] Keep status replies to three lines. (evidence: "shorter, please" in three sessions)
- [inferred, proposed] Prefer a comparison table. (evidence: two accepted table drafts)
- [said, declined] Always use tables. (evidence: "only when comparing")

## Asked
- digest: <ISO timestamp>
```

Confirmed entries reach `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, the ChatGPT paste exports and the session-start contract. Declined entries become a "Never ask again" list; the ChatGPT list may be shortened to fit its budget. Proposed entries render nowhere. The shareable system prompt carries no entries.

After recording answers, the AI marks the digest as asked and re-renders. If it has no shell, it asks you to run `npx agent-personalizer --dir .`. At level 3 you can run `node render/render.cjs --dir .` and `node render/render.cjs --dir . --check`. Re-paste changed ChatGPT exports. As you work, a second correction of the same thing prompts one evidence-backed "Make it a rule?" question.

## Forget or uninstall

```bash
npx agent-personalizer learn --forget --dir .
npx agent-personalizer --uninstall --dir . --dry
npx agent-personalizer --uninstall --dir .
```

`learn --forget` deletes agent-personalizer's digest and removes its empty private folder. It keeps approved entries. Uninstall removes the digest, its `.gitignore` and private folder, and always keeps `LEARNED.md`, edited or untouched. Neither changes the AI apps' own history. To stop questions, decline the consent screen and do not run `learn --yes`; to change an entry, edit its owning line and re-render.

## How the loop closes

The installed home files carry the learning procedure; Claude Code also gets `.claude/commands/personalize.md`. At level 3, the session-start contract points at `/personalize` while a digest id is unasked. Your AI asks the questions, writes the statuses and digest id to `LEARNED.md`, then re-renders. Only current confirmed entries apply. A summary in `USER.md` can lag until an installer re-run; `LEARNED.md` owns entry status.

Nothing watches the digest or verifies model behaviour in the background. You can verify the files with `npx agent-personalizer --dir .`, then at level 3, `node render/render.cjs --dir . --check`. A clean check exits 0; drift exits 1; invalid input exits 2. Check `LEARNED.md` for the approved or declined line and the digest id under `## Asked`. Re-paste ChatGPT's boxes after changes. With no shell, the AI tells you to run the re-render command.

The reader uses Node 18 built-ins and no network. Formats, unreadable files, symlinks, oversized lines and private matches are counted as skips. The digest header records the selected sources, files and counts; the terminal lists read paths without message text. Report a reader failure or leak through the channels in [SECURITY.md](../SECURITY.md).

The installer does not upload the digest. Other software can sync or share its containing folder; choose a private local folder if you want the copy to stay on this computer. The local `LEARNED.md` is the source of truth for entries; generated blocks and paste files are checked copies, and the digest is disposable evidence.
