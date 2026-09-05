# Releasing

Maintainer notes. Until release automation is switched on, a release is four commands and one file edit.

1. Every change in the release has a `CHANGELOG.md` line under `[Unreleased]`, naming the audit round that produced it where one did.
2. Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, add the compare link at the bottom, and set the same version in `package.json`.
3. `npm test` green locally; CI green on the last push.
4. `git tag -a vX.Y.Z -m "X.Y.Z: <one line>"` and `git push origin main --tags`.
5. `gh release create vX.Y.Z --notes-from-tag` (or paste the changelog section as the notes).

On npm since 0.4.0 (`npx agent-personalizer`); `npx github:aunysillyme/agent-personalizer` still runs it straight from the tag.

**npm:** `.github/workflows/publish.yml` publishes a tag with provenance: after step 4, `gh workflow run publish.yml -f tag=vX.Y.Z`. It is manual (`workflow_dispatch` with the tag), checks the tag against `package.json`, runs the harness, then `npm publish --provenance --access public` with `id-token: write`. The input must be an existing `vX.Y.Z` tag: the job resolves it through `refs/tags/` and checks out that commit by SHA, so a branch with a tag-like name cannot be published. It will fail until the package exists on npm with a trusted publisher configured. npm only lets you configure a trusted publisher in an existing package's settings, so the FIRST version is published by hand by a logged-in maintainer (`npm login`, then `npm publish --access public` from the tag checkout; no provenance is possible from a laptop), then npmjs.com → the package → Settings → Trusted Publisher → GitHub Actions, this repository, workflow file `publish.yml`. Every later version goes through the workflow. The job upgrades npm first: trusted publishing needs npm 11.5.1 or later and Node 22 bundles 10.x. No npm token is stored anywhere; provenance and trusted publishing are what the surveyed repos do. Optional hardening once publishing is live: put the job behind a protected GitHub environment with a required reviewer (a repository setting, not a file change).
