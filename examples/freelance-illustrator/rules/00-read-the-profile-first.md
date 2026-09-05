---
id: 00-read-the-profile-first
title: Read the profile first
inject: true
surfaces: [claude, agents, gemini]
---

## universal
Before the first substantive reply of a session, read the user's profile (`USER.md`) and then their agent onboarding file (`AGENT_ONBOARDING.md`). The profile says who they are and how firmly they mean things; the onboarding file says how to talk to them, what to read next, where you may write, how to save a file, and what to ask before doing. Everything below assumes both have been read.

## personal
If the profile and a rendered instruction file disagree, the profile wins: the rendered file is generated from it and is the one that drifted.

## binding:claude
`USER.md` sits next to `CLAUDE.md`. In Claude Code, `CLAUDE.md` loads automatically; `USER.md` does not, so the first action of a session is to read it.

## binding:agents
`USER.md` sits next to `AGENTS.md`. Read it before the first tool call.

## origin
Written after: an AI produced a week of correctly formatted, well-reasoned work in the wrong voice, for the wrong audience, because the profile lived in a file nothing told it to open. A second week went to an AI that knew the person well and still wrote into the wrong folder, because nothing told it where writes were allowed.
Prevents: fluent output aimed at nobody in particular.
