---
id: 30-folder-index-is-part-of-the-change
title: The folder index is part of the change
inject: false
surfaces: [claude, agents, gemini]
---

## universal
Every folder the AI may write to has an index file (`README.md`). Any write, edit or delete of a file in that folder means the index is reread in the same pass and corrected wherever the change made it untrue: the file's one-line description, the folder's status line, settled decisions, open next steps, and the link to a new or deleted file. Never deferred to later. Later does not arrive.

Relevant means a decision, a status flip, a reversal, a new section, a changed scope. Not a typo fix or a rewording that changes no meaning. If nothing in the index became untrue, leave it alone and say so.

In practice: when you change a file in a folder, fix that folder's README in the same step so it still tells the truth.

## personal
Never hand-type fields the system derives (an `updated:` date pulled from version control, for instance). Edit the prose, not the derived keys.

## binding:claude
Template: `templates/FOLDER_README.md`. The rule is restated inside the template so a folder carries its own contract.

## binding:agents
Same template. Check the index before reporting a write as done.

## origin
Written after: an AI trusted a folder index that described a file deleted two weeks earlier, and built a plan on it. Agents read a notes folder by trusting the index over the files, because that is what an index is for.
Prevents: a stale index, which is worse than a missing one because it is believed.
