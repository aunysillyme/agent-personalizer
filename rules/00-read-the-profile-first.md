---
id: 00-read-the-profile-first
title: Read the profile first
inject: true
surfaces: [claude, agents, gemini, chatgpt, prompt]
---

## universal
Before the first substantive reply of a session, read the user's profile (`USER.md`). It says who they are, how to talk to them, how firmly they mean things, and how they want output shaped. Everything below assumes it has been read.

## personal
If the profile and a rendered instruction file disagree, the profile wins: the rendered file is generated from it and is the one that drifted.

## binding:claude
`USER.md` sits next to `CLAUDE.md`. In Claude Code, `CLAUDE.md` loads automatically; `USER.md` does not, so the first action of a session is to read it.

## binding:agents
`USER.md` sits next to `AGENTS.md`. Read it before the first tool call.

## origin
Written after: an AI produced a week of correctly formatted, well-reasoned work in the wrong voice, for the wrong audience, because the profile lived in a file nothing told it to open.
Prevents: fluent output aimed at nobody in particular.
