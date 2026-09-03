# The five tiers

Instructions to an AI live in five places. Each has one job and prevents one failure. Put a rule in the wrong tier and it either decays, drifts, or gets ignored. Put it in the right one and it holds.

Read bottom-up. Tier 1 is the most present, tier 5 the most durable.

---

## Tier 1: style in the system prompt

**What.** How the AI writes back to you: length, structure, punctuation, what to lead with. Not what it knows. Not what it does.

**Where.** The one slot your AI keeps in front of it every single turn. Claude Code calls it an output style. Chat apps call it custom instructions or a system prompt. If the app has no slot, the top of the home file is the next best place.

**Prevents.** Decay. A style stated once in a message fades after twenty turns. A style in the system prompt is present on turn two hundred exactly as on turn one.

**Story.** A user corrected the same formatting habit, in words, more than thirty times across two months. Every correction held for a session and vanished. Moving the same sentence into the system-prompt slot ended it in a day. The rule had not changed. Its tier had.

---

## Tier 2: one always-loaded home file

**What.** `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, whatever your AI reads first. It says who you are (by pointing at `USER.md`), where your notes live, and which document owns which rule.

**Where.** The root of the project or folder the AI works in. Some AIs also read a global one in your home directory.

**Prevents.** The AI not knowing where anything is. Without a home file it re-derives your setup every session, wrongly.

**Story.** A home file grew to 40 KB of rules, restated from documents that lived elsewhere. Three of those restatements went stale within a month and the AI followed the stale copies with full confidence, because the home file is the first thing it reads. The fix was not a shorter file. It was a file of pointers: one line per rule, naming the document that owns it.

**Rule inside the tier.** The home file carries pointers, not text. A `[hook: name]` or `[owner: path]` tag on a one-line rule tells the AI where the full text lives.

---

## Tier 3: session-start injection

**What.** The handful of rules that must win at the moment of decision, injected in full at the start of every session. Not pointers. Full text.

**Where.** A session-start hook (Claude Code has these). For AIs without hooks, a block you paste at the top of the first message, or a saved prompt that starts every session.

**Prevents.** A tool's own instructions beating yours. Installed skills, plugins and tool descriptions each say "use me." A rule that says "use the other one first" loses that argument if it is only stated in a document the AI may or may not have opened.

**Story.** Thirty-two installed skill packages for one crawling service each instructed the AI to use that service. The user's rule said a different, free tool was the default. The rule lived in the home file as a pointer. The AI picked the paid service every time, because at the moment of choice thirty-two voices said one thing and one pointer said another. Injecting the full routing rule at session start fixed it. Prose in a document does not win that argument; a contract present in context does.

**Rule inside the tier.** Injected contracts are few, and each carries its story. Ten is a lot. Every one costs tokens every session.

---

## Tier 4: one owning document per rule

**What.** Every rule has exactly one document that owns it. Everything else points there. Canon is read on demand, when the task needs it.

**Where.** Your notes folder. A `protocols/` or `rules/` directory. Each file names what it owns.

**Prevents.** Drift. A rule hand-stated in five places drifts in five places, and the five copies disagree silently until one of them is quoted back at you as your own ruling.

**Story.** A routing rule was corrected in its owning document. Four days later, four other surfaces still carried the old version, and the AI quoted one of them to the user as if her own decision had been the reverse. A drift detector had been green the whole time, because it checked that each surface matched the rule as last recorded, not that each surface matched the owner. Restating canon is how it drifts. Link down instead.

**Rule inside the tier.** If you find yourself pasting a rule's text into a second file, stop and write a pointer.

---

## Tier 5: memory with a status on every fact

**What.** What the AI remembers about you across sessions: preferences, corrections, project facts. Each fact carries a status: `asserted` if you said it, `derived` if the AI inferred it.

**Where.** A memory directory the AI writes to, one fact per file, with a small always-loaded index of standing rules and a larger on-demand index of everything else.

**Prevents.** The AI treating its own guess as your ruling. An inference written down without a status reads, next session, like something you decided.

**Story.** A memory file said the user preferred a certain tool. The user had never said so; an earlier session had inferred it from one choice. Three sessions built on it. The status field exists so the next session can tell the difference between "she said" and "I guessed," and so a contradicted fact gets marked `superseded` with a pointer rather than silently overwritten.

**Rule inside the tier.** The always-loaded index stays small: standing rules only. A project detail or a tool gotcha lives in the on-demand index. The core file was 18 KB once, and every line loaded whether or not it mattered.

---

## How the tiers relate

```
tier 1  style        every turn        system prompt slot
tier 2  home file    every session     pointers to owners
tier 3  contracts    every session     full text, few, with stories
tier 4  canon        on demand         one owner per rule
tier 5  memory       across sessions   facts with a status
```

A rule moves DOWN the tiers as it proves durable: a correction becomes a memory fact, a memory fact that keeps mattering becomes a rule in canon, a canon rule that keeps losing arguments becomes an injected contract. Nothing starts at tier 3.
