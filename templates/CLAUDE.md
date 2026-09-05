# CLAUDE.md

<!-- This is a POINTER file. It tells Claude where things live. It does not restate rules.
     If you use render/render.cjs, the block between the markers below is generated from
     USER.md and rules/; edit those, never this block. -->

Read `USER.md` first, every session. It says who I am, how to talk to me, how firmly I mean things, and how I want output shaped.
Then read `AGENT_ONBOARDING.md`: how to talk to me, what to read next, where you may write, how to save a file, and what to ask before doing. It is generated from my own answers.

## Where things live

- Profile: `USER.md`
- Agent onboarding (generated from my answers): `AGENT_ONBOARDING.md`
- Rules, one file each, the owning copy: `rules/`
- Notes the AI may edit, and the rules for editing them: `notes/README.md`
- Session log (one note per week): `notes/sessions/`
- Decisions log (one running file): `notes/decisions.md`
- Inbox (one file per item, deleted when done): `notes/inbox/`

## Standing rules (pointers)

- Evidence before assertion. Read the source before stating anything about my setup, my history, or my decisions. `[owner: rules/10-evidence-before-assertion.md]`
- One owner per rule. Never restate a rule; link to the file that owns it. `[owner: rules/20-one-owner-per-rule.md]`
- The folder index is part of the change. Any write to a folder corrects its README in the same pass. `[owner: rules/30-folder-index-is-part-of-the-change.md]`
- Sign every edit. One `Last edited by:` line, overwritten, never stacked. `[owner: rules/40-sign-every-edit.md]`
- Act or ask. A missing fact is yours to fetch; a missing mandate is mine to give. `[owner: rules/60-act-or-ask.md]`

<!-- agent-personalizer:begin -->
<!-- run `npx agent-personalizer` or `node render/render.cjs` to fill this block -->
<!-- agent-personalizer:end -->
