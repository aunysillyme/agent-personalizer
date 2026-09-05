# CLAUDE.md

Pointers for any coding agent working on this repository. No profile here on purpose: this file is for contributors' agents, not for one person.

- Read `CONTRIBUTING.md` first, then `rules/README.md` (the rule format) and `docs/tiers.md` (why the files are shaped this way).
- Run `sh test/run.sh` before proposing a change and quote the exit code. 0 ok, 1 drift, 2 refused.
- Never touch `check/forbidden.local.txt`, never commit it, never print its contents. If it is absent, the harness prints check 6 as a skip; leave it that way.
- Never edit inside a `<!-- agent-personalizer:begin -->` … `end` block; edit the source and re-render.
- Byte fidelity is a promise this tool makes. A change to `render/render.js` that alters anything outside the marker block, follows a symlink, or writes before the whole plan is validated will be refused in review.
- Prose in this repo uses no em dashes.
