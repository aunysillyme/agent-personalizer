# hooks/

Tier 3 from [docs/tiers.md](../docs/tiers.md): the few rules that must win at the moment of decision, injected in full at the start of every session.

Which rules? The ones with `inject: true` in their frontmatter. Keep that set small. Every injected rule costs tokens every session.

## Claude Code

`claude-code/session-start.sh` prints the contract. Register it in `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "sh hooks/claude-code/session-start.sh" } ] }
    ]
  }
}
```

The hook's stdout lands in the session context before your first message. That is the whole mechanism. If `node` is missing the hook exits non-zero and says so on stderr, so a session that starts without its contract is visible, not silent.

The contract is target-aware: `--contract-target claude` applies each rule's `surfaces` filter. Personal blocks are included by default because the hook runs in your own project; add `--no-personal` for a shared machine.

**Subagents do not get SessionStart.** A subagent you spawn from a session sees none of this unless you pass it in the task. That is why the rendered `CLAUDE.md` also carries pointers to every rule: the pointer survives, the injection does not.

## Everything else (plain-prompt fallback)

For an AI with no hook system, generate the contract once and paste it at the top of the first message, or save it as the opening block of a reusable prompt:

```bash
node render/render.js --dir . --contract > contract.txt
```

Re-run whenever a rule changes. `npm run check` will not catch a stale pasted contract; nothing can. Keep the injected set small enough that re-pasting is cheap.

## When to promote a rule to injection

Only when it has lost an argument. If the AI keeps picking a tool's own instruction over your rule, or keeps reverting a style you stated, the rule is in the wrong tier. Move it up, add the story to its `origin` block, and watch whether it holds.
