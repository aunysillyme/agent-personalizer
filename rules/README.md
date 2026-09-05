# rules/

One rule per file. Each file is the owning copy of that rule; everything else points here. `render/render.cjs` turns these files plus `USER.md` into the per-AI instruction files.

## Format

```markdown
---
id: 10-evidence-before-assertion      # matches the filename
title: Evidence before assertion
inject: false                          # true = also emitted by the session-start contract (few!)
surfaces: [claude, agents, gemini, chatgpt, prompt]   # which renders include it
---

## universal
The rule, stated for any AI. No tool names, no paths, no personal detail.
End with one line starting "In practice:" that says the rule in plain words for
someone new to this.

## personal
Your curation of the rule: how it applies to you specifically. Omitted from the
plain system-prompt render, which is meant to be shareable.

## binding:claude
Tool names, paths, hook names that make the rule concrete for this one AI.
Add binding:agents, binding:gemini, binding:chatgpt as needed. A missing
binding is fine; an empty universal block is not.

## origin
Written after: the failure that produced this rule, in two or three lines.
Prevents: the failure it stops, in one line.
```

## Ordering

Files render in filename order. The two-digit prefix is the order; leave gaps.

## Writing a new rule

1. Name the failure first. A rule without an origin block is a preference wearing a uniform.
2. State it in the `universal` block without a single tool name. If you cannot, it is a binding, not a rule.
3. Decide whether it needs injection. Most do not. Injection is for rules that lose arguments to tools at the moment of decision.
4. Run `node render/render.cjs --dir .`, then the same command with `--check`.

## The rules that ship here

| File | Rule | Inject |
|---|---|---|
| `00-read-the-profile-first.md` | Read `USER.md` before anything else | yes |
| `10-evidence-before-assertion.md` | Read the source before stating a fact about the user's setup | no |
| `20-one-owner-per-rule.md` | Never restate; link to the owner | no |
| `30-folder-index-is-part-of-the-change.md` | A write to a folder corrects its README in the same pass | no |
| `40-sign-every-edit.md` | One signature line, overwritten | no |
| `50-output-style.md` | Lead with the answer, one item per line, no recap | yes |
| `60-act-or-ask.md` | Fetch a missing fact; ask for a missing mandate | no |
