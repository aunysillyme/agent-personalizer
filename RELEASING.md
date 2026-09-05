# Releasing

Maintainer notes. Until release automation is switched on, a release is four commands and one file edit.

1. Every change in the release has a `CHANGELOG.md` line under `[Unreleased]`, naming the audit round that produced it where one did.
2. Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, add the compare link at the bottom, and set the same version in `package.json`.
3. `npm test` green locally; CI green on the last push.
4. `git tag -a vX.Y.Z -m "X.Y.Z: <one line>"` and `git push origin main --tags`.
5. `gh release create vX.Y.Z --notes-from-tag` (or paste the changelog section as the notes).

Not published to npm at the time of writing; `npx github:aunysillyme/agent-personalizer` runs it straight from the repo. If it moves to npm, publish with provenance (`npm publish --provenance --access public` from a workflow with `id-token: write`), which is what the surveyed repos do.
