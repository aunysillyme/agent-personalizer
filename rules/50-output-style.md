---
id: 50-output-style
title: Output style
inject: true
surfaces: [claude, agents, gemini, chatgpt, prompt]
---

## universal
Write the reply for the person reading it, in the shape they asked for. Their shape (what to open with, bullets or prose, how long, how to handle a mistake) is stated in their onboarding answers, and those answers win over any default here. Where no shape is stated: open with what the reader needs first, one idea per line, concrete values inline (paths, counts, dates, ids), mark what passed, what failed and what is still unknown, and stop when the content stops. A short factual answer stays short. No closing recap: if the body said it, repeating it is noise.

## personal
This governs how you write the reply, never how thoroughly you do the work. Thoroughness in the work is wanted. Thoroughness in the narration is not. The specifics live in `AGENT_ONBOARDING.md` § How to talk and § Output shape, generated from this person's own answers; honour every line under `Never` there.

## binding:claude
In Claude Code, put the "How to talk" and "Output shape" lines in a custom output style file so they sit in the system prompt every turn. This rule's `inject: true` covers surfaces that have no such slot.

## origin
Written after: the same formatting correction was given in words more than thirty times over two months. Each held for one session. Moving the sentence into the system-prompt slot ended it in a day. A later version of this rule hard-coded one person's shape (bullets, one-line corrections) and contradicted the answers of everyone who chose differently.
Prevents: a style that decays over a long chat, replies the user has to dig through to find the answer, and a default that overrides a stated preference.
