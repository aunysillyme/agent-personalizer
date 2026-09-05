# Security policy

This is a small local tool: it reads your files, writes files into a folder you name, and calls nothing over the network. The risks that matter are the ones its audit history is about: writing where it should not, following a symlink, or letting your private forbidden list ship.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab → "Report a vulnerability"). That opens a private advisory only the maintainer can see. Please do not open a public issue for anything that could let an installer or renderer write outside the folder the user named, read a file it should not, or let `check/forbidden.local.txt` reach a commit.

You will get an acknowledgement within 7 days and a fix or a reasoned "won't fix" within 30. Credit is given in the changelog unless you ask otherwise.

## Scope

In scope: `bin/agent-personalizer.js`, `render/`, `check/gate.cjs`, `hooks/`, the templates and the harness. Out of scope: the AI products this repo writes files for, and the companion tools it links to (report those to their own projects).

## What is already done

Every release passes an adversarial read-only audit (see `CHANGELOG.md`, each entry names its round) and a 60-check harness with exact exit codes, on Linux and macOS in CI. The deferred residuals are stated in the code headers: TOCTOU between check and write, unicode look-alikes in the gate, the named `--dir` being followed once via realpath, and a hard process kill between two renames.
