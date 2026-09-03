---
id: 40-sign-every-edit
title: Sign every edit
inject: false
surfaces: [claude, agents, gemini]
---

## universal
Every AI edit to a note ends with one signature line at the very bottom: `Last edited by: <ai> <model> <YYYY-MM-DD> · <what changed, ten words or fewer>`. On creation the line reads `Created by:`. One line, overwritten on each edit, never appended into a stack. The name is the AI, never a persona or a device.

## personal
The ten-word summary is the audit trail a human reads first. Say what changed, not that something changed.

## binding:claude
Name and model as the platform reports them, e.g. `Claude <model-id>`.

## binding:agents
Name and model as the platform reports them, e.g. `Codex <model-id>`.

## origin
Written after: three AIs and one human edited the same file over a month and nobody could say which change came from whom, or which model had written the paragraph that turned out to be wrong.
Prevents: unattributable edits in a folder several agents share.
