# Releasing

Maintainer notes. Until release automation is switched on, a release is four commands and one file edit.

1. Every change in the release has a `CHANGELOG.md` line under `[Unreleased]`, naming the audit round that produced it where one did.
2. Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, add the compare link at the bottom, and set the same version in `package.json`.
3. `npm test` green locally; CI green on the last push.
4. `git tag -a vX.Y.Z -m "X.Y.Z: <one line>"` and `git push origin main --tags`.
5. `gh release create vX.Y.Z --notes-from-tag` (or paste the changelog section as the notes).

Not published to npm at the time of writing; `npx github:aunysillyme/agent-personalizer` runs it straight from the repo.

**npm, when the maintainer decides to:** `.github/workflows/publish.yml` is ready and dormant. It is manual (`workflow_dispatch` with the tag), checks the tag against `package.json`, runs the harness, then `npm publish --provenance --access public` with `id-token: write`. The input must be an existing `vX.Y.Z` tag: the job resolves it through `refs/tags/` and checks out that commit by SHA, so a branch with a tag-like name cannot be published. It will fail until two account steps are done on npmjs.com: create the package, and configure trusted publishing for this repository and workflow file. No npm token is stored anywhere; provenance and trusted publishing are what the surveyed repos do. Optional hardening once publishing is live: put the job behind a protected GitHub environment with a required reviewer (a repository setting, not a file change).
