# Releasing

Maintainer notes. Follow the steps below for version sites, rendering, checks and publication. The harness pins what it can; the rest is written here.

1. Every change in the release has a `CHANGELOG.md` line under `[Unreleased]`, naming the audit round or issue that produced it where one did.
2. Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, add the compare link at the bottom, and point the `[Unreleased]` link at `vX.Y.Z...HEAD`.
3. Set the version in the three places the harness pins together: `package.json`, `const VERSION` in `render/onboarding.cjs` (it builds the docs URL every installed file links to), and the tiers link in `hooks/README.md`.
4. Re-render the example, because its files carry that version-keyed docs URL: `node render/render.cjs --dir examples/freelance-illustrator`, then the same command with `--check` must print nothing. Skipping this step is the one thing that has turned a release commit red, twice.
5. `sh test/run.sh` green locally (the count guard included). Push `main`; CI green on that commit.
6. `git tag -a vX.Y.Z -m "X.Y.Z: <one line>"` and `git push origin main vX.Y.Z`.
7. `gh release create vX.Y.Z --title X.Y.Z --notes "<the changelog section>"`.
8. `gh workflow run publish.yml --ref main -f tag=vX.Y.Z`, then `gh run watch <run id> --exit-status`.

**Verify.** `npm view agent-personalizer@X.Y.Z version` prints `X.Y.Z` (query the exact version: the bare `npm view agent-personalizer version` can lag a minute behind the run), and `https://registry.npmjs.org/-/npm/v1/attestations/agent-personalizer@X.Y.Z` returns a Sigstore bundle. In a fresh temp dir, `npx --yes agent-personalizer@X.Y.Z --version` prints the new version.

**How `publish.yml` works.** Manual `workflow_dispatch` with the tag as its input, live since 0.4.1. 0.4.0 was published by hand from the tag checkout by a logged-in maintainer (`npm publish --access public`, no provenance is possible from a laptop), because npm only lets a trusted publisher be configured in the settings of a package that already exists. The job resolves the input through `refs/tags/` and checks out that commit by SHA, so a branch with a tag-like name cannot be published; the tag must equal the `package.json` version; it runs on Node 24 and fails unless the bundled npm is 11.5.1 or later (the trusted-publishing minimum; no global npm install, since 0.8.4), runs the harness, then `npm publish --provenance --access public` with `id-token: write`. No npm token is stored anywhere. The trusted publisher on npm is GitHub Actions, this repository, workflow file `publish.yml`, direct publish allowed.

**Two things GitHub will not tell you.** A workflow file it cannot parse is dropped silently: `gh workflow run` says the workflow has no `workflow_dispatch` trigger, and the workflow list shows the file path where its name should be. It happened here once over an unquoted `: ` in a step name; the harness now parses both workflow files. This guide ships in the tarball so its offline links work. Workflow-only changes can land without a package release.

Optional hardening: put the publish job behind a protected GitHub environment with a required reviewer (a repository setting, not a file change).

## Shared set rows

The README and llms.txt "Part of a set" rows come from https://raw.githubusercontent.com/aunysillyme/.github/HEAD/set.json; each row's line is that package's npm description. Refresh with `npx repo-build-skill@0.1.1 set sync` outside CI and commit the result. Keep `.repo-build/*` and the text between the set markers generated. CI only checks drift offline with `node scripts/check-set.mjs` in the harness job on pushes and pull requests, using the existing Node matrix.

The check reads README.md, llms.txt, package.json and the vendored renderer, set file and lock. It renders in memory and compares both SHA-256 hashes with the lock, with no writes or network calls. Exit 0 prints one match line; exit 1 names each drifted file with `SET_DRIFT:` and the refresh command; exit 2 reports a missing or unreadable file, invalid input or bad usage. Run `node test/check-set.test.cjs` to verify clean and seeded-drift copies in temp directories; `--root <dir>` checks another copy. The shared source and generated lock own the rows and hashes; the harness watches them when CI runs, with no separate watcher. Resolve failures by refreshing outside CI and rerunning the check before release.

`npx agent-personalizer` is the install path; `npx github:aunysillyme/agent-personalizer` still runs the tag directly.
