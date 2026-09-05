# Contributing

Thanks for looking. Two kinds of contribution land well here: a **failure you hit** (with the steps), and a **rule you wrote from one** (with its origin story). Feature ideas without a failure behind them usually turn into a discussion first.

## Before you open anything

- **Search** the issues, open and closed. The audit rounds closed a lot; your case may be there.
- **Reproduce** on a fresh temp directory with the exact command. The installer and renderer print exit codes on purpose: 0 ok, 1 drift, 2 refused. Quote the code.

## Running the checks

```bash
npm test            # sh test/run.sh: 82 checks, exact exit codes, Linux and macOS
node test/rollback.test.js "$(mktemp -d)"   # after copying examples/freelance-illustrator into it
node check/gate.cjs --self-test
```

The privacy gate (`check/gate.cjs` against a real list) needs a local `check/forbidden.local.txt`; copy the example and fill it with *your* identifiers. It never ships and the harness prints that check as a skip when the list is absent. A skip is not a pass; say so in your PR if you could not run it.

## Adding a rule

1. One file in `rules/`, `NN-name.md`, in the three-fence format described in `rules/README.md`. The `universal` block must contain no tool names. If it cannot, you are writing a binding.
2. Fill in the `origin` block. A rule without the failure that produced it will be asked for one.
3. `npm run render && npm run check`. Update `rules/README.md`'s table.

## Adding a notes tool or an AI target

- A notes tool is ONE entry in the `TOOL` table at the top of `render/onboarding.cjs` (`kind`, `label`, `name`, `reach`, `posture`); the interview option, the validation and the write section all derive from it. Then a row in `docs/companions.md`, and an installer hint in `bin/agent-personalizer.js` if the tool needs one. Check 60 in the harness iterates every option; add yours to the right loop. Check 74 asserts the interview options equal the table's keys.
- An AI target is an entry in `render/targets.json` plus a row in `docs/paste-guide.md`. If it has a binding, add `binding:<name>` blocks to the rules that need one; unknown binding names are refused.

## Pull requests

- One concern per PR. The harness must be green on both OSes.
- If you touched `render/render.cjs`, `bin/agent-personalizer.js` or `check/gate.cjs`, say what you attacked: a symlink, a traversal, a malformed marker, a bad answer. The PR template asks.
- No em dashes in prose you add. Yes, really; it is a house rule the tooling checks.
- Keep the two real names that appear in this repo to the two places they already are (LICENSE and the README footer). Everything else is generic by design.

## Releases

Maintainer-only for now: bump `package.json`, add the `CHANGELOG.md` section, tag `vX.Y.Z`, push with tags. The changelog entry names the audit round that produced each change.
