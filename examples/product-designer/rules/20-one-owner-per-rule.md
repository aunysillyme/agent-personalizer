---
id: 20-one-owner-per-rule
title: One owner per rule
inject: false
surfaces: [claude, agents, gemini]
---

## universal
Every rule has exactly one document that owns it. Any other place the rule appears is a pointer to that document, not a restatement. When a rule changes, the owner changes; pointers do not need to. If you find yourself pasting a rule's text into a second file, stop and write a pointer.

In practice: each rule lives in one file. Everywhere else, link to that file instead of copying the words.

## personal
The rendered instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) are generated from `rules/`. Never edit inside their marker blocks. Edit the rule file and re-render.

## binding:claude
Pointer form in `CLAUDE.md`: a one-line rule followed by `[owner: rules/<file>.md]`.

## binding:agents
Pointer form in `AGENTS.md`: a one-line rule followed by `[owner: rules/<file>.md]`.

## origin
Written after: a routing rule was corrected in its owning document and, four days later, four other surfaces still carried the old version. One of them was quoted back to the user as if her own decision had been the reverse. The drift detector was green throughout, because it checked each surface against the rule as last recorded, not against the owner.
Prevents: the same rule disagreeing with itself in five places.
