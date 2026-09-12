'use strict';
/*
  onboarding.cjs: the agent-onboarding interview and its two renders.

  The user answers a short set of questions (or accepts the defaults). From ONE answer set:
    renderUser(answers)        -> USER.md          the human profile (who I am, how to talk to me)
    renderOnboarding(answers)  -> AGENT_ONBOARDING.md  the agent-facing manual: how to talk, output
                                                      shape, what to read first, where to write,
                                                      how to save, what to ask before doing
    contractBlock(answers)     -> the short block a session-start hook injects

  Defaults are the generalized shape of one working setup. Every default is a question the user
  can answer differently; nothing here is imposed. No network, no environment, no secrets.

  This file is COPIED into level-3 installs, so it must not require package.json or anything
  else from the repo: VERSION is a literal, kept equal to package.json by the harness, and
  DOCS points at the matching tag on GitHub so an installed copy never links to a file the
  destination does not have.
*/
const VERSION = '0.5.1';
const DOCS = `https://github.com/aunysillyme/agent-personalizer/blob/v${VERSION}/docs`;

/* THE single source for notes tools. Add a tool here and nowhere else: the interview option, the
   kind that drives the write section and the scaffold, and the prose all come from this table.
   kind: disk = files the AI edits directly; cloud = reached through a connector, no filesystem;
   readonly = no agent door today, so writes fall back to a local folder; other = named by the user,
   conservative posture. p = location escaped for a code span, q = location escaped for prose. */
const TOOL = {
  'obsidian':    { kind: 'disk', label: 'an Obsidian vault (pairs with obsidian-tc, see the companions doc)', name: 'Obsidian',
                   reach: (p, q, n, tc) => tc
                    ? `the vault at \`${p}/\`, through **obsidian-tc** (governed MCP: folder ACLs, human-in-the-loop confirmation for destructive tools, audit log) rather than raw filesystem access; see ${DOCS}/companions.md`
                    : `the vault at \`${p}/\` as plain files (obsidian-tc is not installed; ${DOCS}/companions.md explains what it would add: folder ACLs, human-in-the-loop confirmation, an audit log)`, posture: null },
  'notion':      { kind: 'cloud', label: 'Notion', name: 'Notion', unit: 'page', reach: (p, q) => `the workspace "${q}" through Notion's own MCP connector`, posture: 'Write only into the pages or databases named in this file. Propose a new top-level page; never create one unasked.' },
  'google-docs': { kind: 'cloud', label: 'Google Docs / Drive', name: 'Google Docs', unit: 'doc', reach: (p, q) => `"${q}" through the Google Drive / Docs connector`, posture: 'Draft into a doc named for the topic. Never edit the existing text of a shared doc without being asked.' },
  'apple-notes': { kind: 'cloud', label: 'Apple Notes', name: 'Apple Notes', unit: 'note', reach: (p, q) => `the "${q}" folder through a separately installed local Apple Notes MCP (not built into any AI app; the user installs and connects it)`, posture: 'Read, and create new notes. Never edit or delete an existing note.' },
  'onenote':     { kind: 'readonly', label: 'Microsoft OneNote', name: 'Microsoft OneNote', reach: (p, q) => `"${q}", read-only (no first-class agent door today)`, posture: 'Treat it as read-only. Write to the local fallback folder below and say what to paste back.' },
  'evernote':    { kind: 'readonly', label: 'Evernote', name: 'Evernote', reach: (p, q) => `"${q}", read-only (no first-class agent door today)`, posture: 'Treat it as read-only. Write to the local fallback folder below and say what to paste back.' },
  'logseq':      { kind: 'disk', label: 'Logseq', name: 'Logseq', reach: (p, q) => `the graph folder at \`${p}/\`, as plain files`, posture: null },
  'folder':      { kind: 'disk', label: 'a plain folder of markdown files', name: 'a folder of markdown files', reach: (p, q) => `\`${p}/\` on disk`, posture: null },
  'other':       { kind: 'other', label: 'something else (name it in the next answer)', name: null, reach: (p, q) => `"${q}"`, posture: 'Ask before the first write into it, and say which tool and location you mean. Until told otherwise, write only to the local fallback folder below.' },
};
/* name comes back RAW and is md-escaped exactly once at each prose render site */
const toolFor = (a) => { const t = TOOL[a.notes_tool]; return { kind: t.kind, unit: t.unit, posture: t.posture, name: t.name || a.notes_tool_name || 'an unnamed notes tool', reach: t.reach(esc(a.notes_path), md(a.notes_path), a.notes_tool_name || '', a.obsidian_tc === 'yes') }; };
const FALLBACK = 'notes';
/* kind without rendering anything (safe before validation completes) */
const kindOf = (a) => TOOL[a.notes_tool].kind;
/* the folder on disk that scaffolds and home-file pointers use: the user's path for a disk tool,
   the fixed fallback for everything else (cloud tools get no folder named after a workspace) */
const baseFor = (a) => kindOf(a) === 'disk' ? a.notes_path : FALLBACK;
/* Is the local notes folder the rendered instructions name NOT there? Every non-cloud tool gets one
   (a disk tool's own path, a read-only or unknown tool's fallback) and the level-2 scaffold is what
   creates it, so below level 2 nothing may name a path inside it: the first session would be told to
   read and write into a folder the installer never created. #19 fixed that for the home files, which
   the installer collapses to one line; #25 was the same bug in the two files rendered from here,
   which that one line points AT.

   The LEVEL is only a proxy, and it is wrong in both directions: a hand-written config carries no
   level, a level-1 install can land in a folder that already has a notes folder, and a re-run at a
   lower level does not remove the folder a higher one created. So `opts.notesScaffolded` (the
   caller's own look at the disk, which is the ground truth) wins whenever the caller passes it, and
   the level is the fallback for a caller that has no root to look in. Round 1, findings 3 to 5.

   This file is copied into level-3 installs, so the look at the disk stays in the CALLER: these two
   renders are pure functions of the answers plus this one boolean. */
function notesPending(a, opts) {
  if (kindOf(a) === 'cloud') return false;                       // no local folder at any level
  if (opts && typeof opts.notesScaffolded === 'boolean') return !opts.notesScaffolded;
  return (opts && Number.isInteger(opts.level) ? opts.level : 2) < 2;
}
/* the phrase a pending USER.md carries where the folder rules would be */
const NOTES_PENDING_MARK = 'no local notes folder yet, so no folder rules yet';
const notesLater = (base) => `\`--level 2\` creates \`${base}/\``;

const QUESTIONS = [
  { id: 'name', ask: 'What should the AI call you?', type: 'text', default: 'the user' },
  { id: 'pronouns', ask: 'Your pronouns (leave blank to skip)', type: 'text', default: '' },
  { id: 'work', ask: 'What you do, in one line', type: 'text', default: '' },
  { id: 'focus', ask: 'Your current focus, one or two projects', type: 'text', default: '' },
  { id: 'tone', ask: 'How direct should the AI be?', type: 'choice', default: 'direct',
    options: [['direct', 'direct answers, no hedging, say what you think'], ['balanced', 'direct but soften disagreement'], ['gentle', 'lead with what works before what does not']] },
  { id: 'length', ask: 'How long should replies be?', type: 'choice', default: 'short',
    options: [['short', 'short by default, detail on request'], ['adaptive', 'as long as the question needs'], ['thorough', 'complete every time']] },
  { id: 'mistakes', ask: 'When the AI is wrong, how should it handle it?', type: 'choice', default: 'one-line',
    options: [['one-line', 'state the correction in one line and move on'], ['brief', 'correction plus one line on the cause'], ['full', 'correction plus the full cause']] },
  { id: 'unsure', ask: 'When the AI is unsure, what should it do?', type: 'choice', default: 'ask-when-it-changes-the-build',
    options: [['ask-when-it-changes-the-build', 'settle facts itself; ask only when the answer changes what gets built', 'settle facts yourself; ask only when the answer changes what gets built'], ['ask-first', 'ask before doing anything uncertain'], ['assume-and-say', 'proceed on a stated assumption, never ask']] },
  { id: 'lead_with', ask: 'What should a reply open with?', type: 'choice', default: 'verdict',
    options: [['verdict', 'the answer or the verdict'], ['summary', 'a one-paragraph summary'], ['context', 'the context, then the answer']] },
  { id: 'structure', ask: 'How should replies be shaped?', type: 'choice', default: 'bullets',
    options: [['bullets', 'lead-in line, then bullets, one item per line'], ['prose', 'short paragraphs'], ['tables-when-comparing', 'bullets by default, a table when comparing three or more things']] },
  { id: 'evidence', ask: 'Where should evidence for a claim go?', type: 'choice', default: 'inline',
    options: [['inline', 'in the reply: paths, counts, dates'], ['linked', 'a link to where it lives'], ['none', 'not needed']] },
  { id: 'never', ask: 'Words, punctuation or habits the AI must never use (comma-separated, blank for none)', type: 'list', default: [] },
  { id: 'read_first', ask: 'Files the AI reads first, in order (comma-separated)', type: 'list', default: ['USER.md', 'AGENT_ONBOARDING.md'] },
  { id: 'notes_tool', ask: 'Where do your notes live?', type: 'choice', default: 'folder',
    options: Object.entries(TOOL).map(([k, t]) => [k, t.label]) },
  { id: 'obsidian_tc', ask: 'Do you use obsidian-tc, the governed MCP?', type: 'choice', default: 'no', when: (a) => a.notes_tool === 'obsidian',
    options: [['no', 'not installed; the AI works on the vault folder directly'], ['yes', 'installed and connected; the AI reaches the vault through it']] },
  { id: 'notes_tool_name', ask: 'The name of that tool', type: 'text', default: '', when: (a) => a.notes_tool === 'other' },
  { id: 'notes_path', ask: 'Where inside it: the folder path (Obsidian, Logseq, plain folder), or the workspace / notebook / folder name (Notion, Google Docs, Apple Notes, others)', type: 'text', default: 'notes' },
  { id: 'tracker', ask: 'Your task tracker, if the AI should read it ("none" to skip)', type: 'text', default: 'none' },
  { id: 'write_policy', ask: 'How freely may the AI write into your notes?', type: 'choice', default: 'notes-freely',
    options: [['notes-freely', 'anywhere under the notes folder, under the folder rules'], ['logs-and-inbox-only', 'only the session log, decisions log and inbox'], ['ask-before-every-write', 'ask before every write']] },
  { id: 'file_naming', ask: 'File naming for anything the AI creates', type: 'choice', default: 'kebab-case',
    options: [['kebab-case', 'my-note-title.md'], ['snake_case', 'my_note_title.md'], ['any', 'no rule']] },
  { id: 'signature', ask: 'Should every AI edit end with a signature line (who, model, date, what changed)?', type: 'choice', default: 'yes',
    options: [['yes', 'one line, overwritten each edit'], ['no', 'no signature']] },
  { id: 'off_limits', ask: 'Folders or topics that never enter shared output (comma-separated, blank for none)', type: 'list', default: [] },
  { id: 'always_ask', ask: 'Actions the AI must always ask before (comma-separated from: delete, publish, send, spend, settings, standing-rules; blank for all)', type: 'multi',
    default: ['delete', 'publish', 'send', 'spend', 'settings', 'standing-rules'],
    options: [['delete', 'deleting or overwriting anything'], ['publish', 'publishing or posting anything public'], ['send', 'sending a message on your behalf'], ['spend', 'spending money'], ['settings', 'changing account or system settings'], ['standing-rules', 'creating a standing rule, schedule or automation']] },
];

const IDS = new Set(QUESTIONS.map(q => q.id));
/* the short interview, which is what a bare `npx agent-personalizer` runs; every other answer takes
   its default. --full asks the rest as well. */
const QUICK = ['name', 'tone', 'length', 'notes_tool', 'notes_path', 'write_policy', 'always_ask'];
/* Does this interview ask question q, given the answers so far? A question with a `when` is
   CONDITIONAL: it is asked exactly when its condition holds, short interview or long, so nobody
   answers the Obsidian question about Notion and nobody picks "other" without being asked to name
   it. Every other question is asked in the long interview and only in the short set otherwise.
   The installer's interview loop calls this, so a test of it is a test of the installer. */
function asks(q, answersSoFar, full) {
  if (q.when) return !!q.when(answersSoFar || {});
  return !!full || QUICK.includes(q.id);
}
/* only the answers that differ from the defaults: what the installer stores, so the config reads as
   "what this person chose" and a future default applies to everyone who never chose otherwise */
/* PINNED answers are always stored, default or not: they govern what the AI may touch, so a future
   change of a default must never move them under a person who chose the current value. */
const PINNED = ['write_policy', 'always_ask', 'off_limits', 'notes_tool', 'notes_path', 'signature'];
function sparse(a) { const d = defaults(), out = {}; for (const k of Object.keys(a)) if (PINNED.includes(k) || JSON.stringify(a[k]) !== JSON.stringify(d[k])) out[k] = a[k]; return out; }

function defaults() {
  const a = {};
  for (const q of QUESTIONS) a[q.id] = Array.isArray(q.default) ? [...q.default] : q.default;
  return a;
}

/* Strict validation: unknown keys, wrong types and unknown choices are errors, never defaults.
   Returns the completed answer set (missing keys take their default). */
const RESERVED = /<!--\s*agent-personalizer/i;
const okString = (v, max) => typeof v === 'string' && v.length <= max && !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) && !RESERVED.test(v);

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('answers must be an object');
  for (const k of Object.keys(input)) if (!IDS.has(k)) throw new Error(`unknown answer "${k}" (known: ${[...IDS].join(', ')})`);
  const out = defaults();
  for (const q of QUESTIONS) {
    if (!(q.id in input)) continue;
    const v = input[q.id];
    if (q.type === 'text') {
      if (!okString(v, 400)) throw new Error(`"${q.id}" must be one line of plain text (up to 400 characters, no control characters, no render marker)`);
      out[q.id] = v.trim();
    } else if (q.type === 'choice') {
      const allowed = q.options.map(o => o[0]);
      if (!allowed.includes(v)) throw new Error(`"${q.id}" must be one of: ${allowed.join(', ')}`);
      out[q.id] = v;
    } else if (q.type === 'list') {
      if (!Array.isArray(v) || v.length > 50 || v.some(s => !okString(s, 200))) throw new Error(`"${q.id}" must be a list of up to 50 short plain strings (no control characters, no render marker)`);
      out[q.id] = v.map(s => s.trim()).filter(Boolean);
    } else if (q.type === 'multi') {
      const allowed = q.options.map(o => o[0]);
      if (!Array.isArray(v) || v.some(s => !allowed.includes(s))) throw new Error(`"${q.id}" must be a list drawn from: ${allowed.join(', ')}`);
      out[q.id] = allowed.filter(s => v.includes(s));
    }
  }
  // Cross-field checks. For a tool the AI reaches on disk, notes_path is a folder the installer
  // creates and the home files point at, so it must be a plain relative path: no leading slash,
  // no "..", no empty segment, no backslash, nothing but [A-Za-z0-9._ -] per segment.
  if (kindOf(out) === 'disk' && !SAFE_REL.test(out.notes_path))
    throw new Error(`"notes_path" for ${out.notes_tool} must be a relative folder path such as "notes" or "docs/vault" (letters, digits, space, . _ -, segments joined by /; no leading /, no ..)`);
  return out;
}
const SAFE_REL = /^(?!\.\.?(?:\/|$))[A-Za-z0-9._ -]+(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._ -]+)*$/;

/* Parse one typed interview answer (a string) for a question; '' means the default. */
function parseAnswer(q, raw) {
  const s = String(raw).trim();
  if (s === '') return Array.isArray(q.default) ? [...q.default] : q.default;
  if (q.type === 'text') return s;
  if (q.type === 'choice') return s;
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

const label = (q, v) => { const o = q.options && q.options.find(x => x[0] === v); return o ? o[1] : v; };
/* The interview asks the HUMAN about the AI, so an option's label is third person ("settle facts
   itself"). USER.md, AGENT_ONBOARDING.md and the session-start contract all address the AI
   directly, so they take the option's third element, its second-person phrasing, where a choice
   carries one. Without it the AI reads "when you are unsure: settle facts itself". */
const youLabel = (q, v) => { const o = q.options && q.options.find(x => x[0] === v); return o ? (o[2] || o[1]) : v; };
const Q = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
const bullets = (arr, empty) => arr.length ? arr.map(x => `- ${x}`).join('\n') : `- ${empty}`;
/* md(): for values placed INSIDE an inline-code span; a code span cannot carry structure, so only
   the backtick that would close it needs neutralizing. */
const esc = (s) => String(s).replace(/`/g, "'");
/* md(): for values placed in prose or list items. Backslash-escapes every character that can open
   Markdown structure or raw HTML (fences, headings, lists, quotes, tables, links, emphasis, comments),
   so a value such as "~~~" or "<!--" or "# x" renders as literal text and cannot swallow or reshape
   the trusted instructions around it. CommonMark renders a backslash-escaped ASCII punctuation
   character as the character itself. */
const md = (s) => String(s).replace(/[`~<>#*_\[\]|\\]/g, (c) => '\\' + c).replace(/^([-+]|\d+[.)])(?=\s|$)/, (m) => '\\' + m);

function renderUser(a, opts) {
  const pending = notesPending(a, opts);
  return `# USER.md

*Who I am, how to talk to me, how firmly I mean things, how I want output shaped. Every AI reads this first. Generated from my onboarding answers; edit freely, it is mine.*

## Who I am

- **Name and pronouns:** ${md(a.name)}${a.pronouns ? `, ${md(a.pronouns)}` : ''}
- **What I do:** ${a.work ? md(a.work) : '(fill in)'}
- **Current focus:** ${a.focus ? md(a.focus) : '(fill in)'}
- **Off limits:** ${a.off_limits.length ? a.off_limits.map(md).join(', ') : 'nothing declared yet'}

## How to talk to me

- **Directness:** ${label(Q.tone, a.tone)}
- **Length:** ${label(Q.length, a.length)}
- **When you are wrong:** ${label(Q.mistakes, a.mistakes)}
- **When you are unsure:** ${youLabel(Q.unsure, a.unsure)}
- **Never:** ${a.never.length ? a.never.map(md).join('; ') : 'nothing declared yet'}

## How firmly I mean things

I do not say everything at the same strength. Read the rung before you act, and when unsure, read it one rung LOOSER, never tighter. A loose read costs one correction. A tight read becomes a silent rule that misfires for months.

| Rung | What it is | How it sounds |
|---|---|---|
| **Gesture** | a word I reached for, not a definition. Act on the thing, quote the word as mine. | "kind of", "basically", "closest word", a made-up -y word |
| **Preference** | a default, never a gate. | "I like", "it's fine", "usually", "depends" |
| **Practice** | a technique I actually use, with conditions. | "I always", describing what I did and why |
| **Rule** | a gate. It blocks shipping. | "I have to", "never", "every time", "100% of the time" |

Two guards. First: loosen only descriptive claims about me. Never loosen a stated prohibition or a must. Second: any sentence you write of the shape "the user is / does / wants / always / never" is a claim about me. That is the moment to check the rung.

## How I want output shaped

- **Lead with:** ${label(Q.lead_with, a.lead_with)}
- **Structure:** ${label(Q.structure, a.structure)}
- **Evidence:** ${label(Q.evidence, a.evidence)}
- **Code:** fenced blocks only
- **Closing:** no recap, no offer of next steps

## Where things live

- **My notes:** ${md(toolFor(a).name)}, ${toolFor(a).kind === 'disk' ? `\`${esc(a.notes_path)}/\`` : `"${md(a.notes_path)}"`}${toolFor(a).kind === 'readonly' ? ' (read-only for the AI)' : toolFor(a).kind === 'other' ? ' (the AI asks before its first write there)' : ''}${pending && toolFor(a).kind === 'disk' ? ` (not on disk yet; ${notesLater(esc(a.notes_path))})` : ''}
- **My task tracker:** ${md(a.tracker)}
- **Rules the AI must read before writing anything to my notes:** ${pending ? `\`AGENT_ONBOARDING.md\` § Where you may write (${NOTES_PENDING_MARK}; ${notesLater(esc(baseFor(a)))} and its README)` : toolFor(a).kind === 'disk' ? `\`${esc(a.notes_path)}/README.md\`` : toolFor(a).kind === 'cloud' ? `the index ${toolFor(a).unit || 'page'} of "${md(a.notes_path)}", and \`AGENT_ONBOARDING.md\` § Where you may write` : `\`${FALLBACK}/README.md\` (the local fallback folder the AI writes to), and \`AGENT_ONBOARDING.md\` § Where you may write`}
`;
}

/* kind: disk = files the AI edits directly; cloud = reached through a connector, no filesystem;
   readonly = no agent door today, so writes fall back to a local folder; other = named by the user,
   conservative posture. p = location escaped for a code span, q = location escaped for prose. */


function renderOnboarding(a, opts) {
  const tool = toolFor(a);
  const disk = tool.kind === 'disk';
  const pending = notesPending(a, opts);        // the local folder is intended but level 2 has not created it
  const base = esc(baseFor(a));                                // where filesystem writes go, if any
  const unit = tool.unit || 'page';
  const naming = { 'kebab-case': 'kebab-case: `my-note-title.md`', 'snake_case': 'snake_case: `my_note_title.md`', 'any': 'no naming rule; match the folder you are writing into' }[a.file_naming];
  const askList = a.always_ask.map(v => `- **${v}**: ${label(Q.always_ask, v)}`).join('\n') || '- nothing declared; use your judgement and say what you did';

  let writeSection;
  if (pending) {
    // Level 1 writes four files and no folders, so every path under base/ is a dead pointer until a
    // level-2 run creates it. Two things stay true regardless: the notes TOOL and its location exist
    // already for a read-only or unknown tool (only the local fallback folder is missing, so do not
    // tell them their own notebook is coming at level 2), and the write policy they chose is not
    // dropped, only deferred to "once it exists".
    const laterLine = {
      'notes-freely': `anywhere under \`${base}/\`, under that folder's rules, and nowhere else unasked`,
      'logs-and-inbox-only': `only the session log (\`${base}/sessions/\`), the decisions log (\`${base}/decisions.md\`) and the inbox (\`${base}/inbox/\`)`,
      'ask-before-every-write': 'ask before every write, every time, showing what you would write and where',
    }[a.write_policy];
    const whereLine = disk
      ? `- **Notes will live in ${md(tool.name)}:** ${tool.reach}, once that folder exists.`
      : `- **Notes live in ${md(tool.name)}:** reach them as ${tool.reach}. ${tool.posture}`;
    const absentLine = disk
      ? `- **That folder is not on disk yet, so nothing under \`${base}/\` exists to read or write.**`
      : `- **The local fallback folder \`${base}/\` that your writes would go to does not exist yet.**`;
    writeSection = `${whereLine}
${absentLine} This is a level-1 install: four profile files, no folders. ${notesLater(base)} with its README, session log, decisions log and inbox.
- **So do not write files there, and do not create that folder yourself.** Propose the write instead: say what would go in it and where it would live, and let them run the level-2 install (or tell you to make the folder).
- **Once it exists**, the policy they chose applies: you may write ${laterLine}. Every folder you write into has a README, and any write, edit or delete means that README is corrected in the same pass. A stale index is worse than none, because the next agent believes it.`;
  } else if (disk) {
    const writeLine = {
      'notes-freely': `You may create and edit files anywhere under \`${base}/\`, under that folder's rules. Nowhere else without being asked.`,
      'logs-and-inbox-only': `You may write only to the session log (\`${base}/sessions/\`), the decisions log (\`${base}/decisions.md\`) and the inbox (\`${base}/inbox/\`). Anything else: propose it, do not write it.`,
      'ask-before-every-write': 'Ask before every write, every time. Show what you would write and where.',
    }[a.write_policy];
    writeSection = `- **Notes live in ${md(tool.name)}:** reach them as ${tool.reach}.
- ${writeLine}
- **Every folder you write into has a README.** Any write, edit or delete means that README is corrected in the same pass: the file's one-line description, the folder's status, settled decisions, next steps. A stale index is worse than none, because the next agent believes it.
- **Session log:** append a dated section to this week's note in \`${base}/sessions/\`. **Decisions:** one line each in \`${base}/decisions.md\`. **Inbox:** one file per item in \`${base}/inbox/\`; finished items are deleted, not marked done.`;
  } else if (tool.kind === 'cloud') {
    const writeLine = {
      'notes-freely': `You may create and edit ${unit}s inside the location named above, under the posture above. Nowhere else without being asked.`,
      'logs-and-inbox-only': `You may write only to a "Session log" ${unit} and a "Decisions" ${unit} inside the location named above. Anything else: propose it, do not write it.`,
      'ask-before-every-write': 'Ask before every write, every time. Show what you would write and where.',
    }[a.write_policy];
    writeSection = `- **Notes live in ${md(tool.name)}:** reach them as ${tool.reach}. ${tool.posture}
- ${writeLine}
- **No filesystem writes.** Nothing about this person's notes is a local file; if a task needs a scratch file, say so and use the folder they give you.
- **Every section has an index ${unit}.** When you add or change a ${unit}, update the index ${unit} that lists it in the same pass. A stale index is worse than none, because the next agent believes it.
- **Session log:** a dated entry at the top of the "Session log" ${unit}. **Decisions:** one line each in the "Decisions" ${unit}. **Open items:** one block each in an "Inbox" ${unit}; finished items are removed, not marked done.`;
  } else {
    // readonly and other: the tool itself is read-only or unknown; writes fall back to a local folder
    const writeLine = {
      'notes-freely': `You may create and edit files anywhere under the local fallback folder \`${base}/\`, under that folder's rules.`,
      'logs-and-inbox-only': `You may write only to the session log (\`${base}/sessions/\`), the decisions log (\`${base}/decisions.md\`) and the inbox (\`${base}/inbox/\`) in the local fallback folder. Anything else: propose it, do not write it.`,
      'ask-before-every-write': 'Ask before every write, every time. Show what you would write and where.',
    }[a.write_policy];
    writeSection = `- **Notes live in ${md(tool.name)}:** reach them as ${tool.reach}. ${tool.posture}
- **Local fallback folder:** \`${base}/\`. ${writeLine}
- **Every folder you write into has a README.** Any write, edit or delete means that README is corrected in the same pass. A stale index is worse than none, because the next agent believes it.
- **Session log:** append a dated section to this week's note in \`${base}/sessions/\`. **Decisions:** one line each in \`${base}/decisions.md\`. **Inbox:** one file per item in \`${base}/inbox/\`; finished items are deleted, not marked done.`;
  }

  return `## Agent onboarding

_Generated by agent-personalizer from ${md(a.name)}'s own answers (stored in \`.agent-personalizer.json\`). Re-run the installer to change an answer. Read this after \`USER.md\`, before your first substantive reply._

### Who you are working with

- **Call them:** ${md(a.name)}${a.pronouns ? ` (${md(a.pronouns)})` : ''}
${a.work ? `- **What they do:** ${md(a.work)}\n` : ''}${a.focus ? `- **Current focus:** ${md(a.focus)}\n` : ''}- **How firmly they mean things:** read the rungs in \`USER.md\` § How firmly I mean things, and default one rung looser when unsure.

### How to talk

- **Directness:** ${label(Q.tone, a.tone)}.
- **Length:** ${label(Q.length, a.length)}.
- **When you are wrong:** ${label(Q.mistakes, a.mistakes)}.
- **When you are unsure:** ${youLabel(Q.unsure, a.unsure)}.
- **Never:** ${a.never.length ? a.never.map(md).join('; ') : 'nothing declared'}.

### Output shape

- **Open with:** ${label(Q.lead_with, a.lead_with)}.
- **Structure:** ${label(Q.structure, a.structure)}.
- **Evidence:** ${label(Q.evidence, a.evidence)}.
- **Code:** fenced blocks only. **Closing:** no recap.

### Read this first, in order

${bullets(a.read_first.map(md), 'USER.md')}
- ${pending ? `Nothing else yet: there is no notes folder to read, and no folder README (${notesLater(base)} and its README). See § Where you may write below.` : tool.kind === 'cloud' ? `The index ${unit} of "${md(a.notes_path)}", before writing there.` : `\`${base}/README.md\`, the rules of the folder you may write into, before writing there.`}
${a.tracker !== 'none' ? `- The task tracker (${md(a.tracker)}): what is open and what is already decided, before proposing work.\n` : ''}
### Where you may write

${writeSection}

### How to save a file

- **Naming:** ${naming}.
- **One owner per fact.** Before writing, search for where the same thing already lives and edit there. Never restate a rule in a second file; link to the file that owns it.
- **Read before you append.** Never duplicate content that is already in the file.
${a.signature === 'yes' ? '- **Sign every edit.** Last line of the file: `Last edited by: <ai> <model> <YYYY-MM-DD> · <what changed, ten words or fewer>`. `Created by:` on a new file. One line, overwritten, never stacked.\n' : '- **No signature line** was requested; keep the file exactly as its folder expects.\n'}
### Before you act

Settle every FACT yourself: a read, a search, a probe, one tool call. Never hand back "worth confirming X" when one call settles X. A MANDATE is theirs. Always ask before:

${askList}

Never close a task on a claim. Verify against the artifact, then say what you checked. Then stop: no closing recap, no unrequested next steps.

### Off limits

${bullets(a.off_limits.map(x => `${md(x)}: never surfaced, quoted or summarized in any reply or deliverable, even if a search returns it`), 'nothing declared yet')}
`;
}

/* The short block a session-start hook injects (and the ChatGPT "respond" box carries).
   Order is by consequence, so a token budget trims style before it trims a restriction:
   always-ask, off-limits, write policy and location, then read order, then how to talk.
   opts.files=false drops the lines that only make sense with file access (read order, paths). */
const WRITE_POLICY = {
  'notes-freely': 'anywhere under the notes location named here, under its own rules, nowhere else unasked',
  'logs-and-inbox-only': 'only the session log, the decisions log and the inbox; propose anything else, do not write it',
  'ask-before-every-write': 'ASK BEFORE EVERY WRITE, every time; show what you would write and where',
};
/* The writes line for a folder that is not there yet. It carries BOTH halves in one clause per
   policy: do not create anything unasked (the operative rule while the folder is absent) and the
   policy that applies once it exists. ask-before-every-write keeps its full text, including "show
   what you would write and where": that clause IS the consent, and someone who pasted the two
   ChatGPT boxes and nothing else has no other copy of it (round 1, finding 1). Every line here is
   shorter than the non-pending line it replaces, because the ChatGPT boxes are plain text on a
   ~1500-character budget with about two characters of slack on this repo's own fixture, and the
   harness installs all three policies at level 1 and refuses an over-budget box. */
const WRITE_POLICY_PENDING = {
  'notes-freely': 'Create nothing unasked; once it exists, anywhere under it, under its rules, nowhere else',
  'logs-and-inbox-only': 'Create nothing unasked; once it exists, only the session log, decisions log and inbox',
  'ask-before-every-write': WRITE_POLICY['ask-before-every-write'],
};
function writesLine(a, opts) {
  const t = toolFor(a);
  // No backticks, and the policy in its SHORT form: this line also goes into the ChatGPT boxes, which
  // are plain text on a ~1500-character budget with almost no slack, so the pending line is kept no
  // longer than the line it replaces. The strictest policy has to survive the trim, so the policy is
  // named, not dropped; AGENT_ONBOARDING.md § Where you may write carries all of it in full.
  if (notesPending(a, opts)) return `Writes: no notes folder yet (level 2 creates ${esc(baseFor(a))}/). ${WRITE_POLICY_PENDING[a.write_policy]}.`;
  const where = t.kind === 'cloud' ? `${md(t.name)} "${md(a.notes_path)}" through its connector, no filesystem writes`
    : t.kind === 'readonly' ? `${md(t.name)} is read-only for you; the local fallback folder is ${esc(FALLBACK)}/`
    : t.kind === 'other' ? `${md(t.name)} is unknown here: ask before the first write there; local fallback folder ${esc(FALLBACK)}/ meanwhile`
    : `${md(t.name)} at ${esc(a.notes_path)}/${a.notes_tool === 'obsidian' && a.obsidian_tc === 'yes' ? ', through obsidian-tc' : ''}`;
  return `Writes: ${WRITE_POLICY[a.write_policy]}. Notes: ${where}.`;
}
function contractBlock(a, opts) {
  const files = !opts || opts.files !== false;
  return [
    `## How to work with ${md(a.name)}`,
    '',
    `Always ask before: ${a.always_ask.join(', ') || 'nothing declared'}.`,
    a.off_limits.length ? `Off limits in any output: ${a.off_limits.map(md).join(', ')}.` : null,
    writesLine(a, opts),
    files ? `Read first: ${a.read_first.map(md).join(' → ')}.` : null,
    `Directness: ${label(Q.tone, a.tone)}. Length: ${label(Q.length, a.length)}. When wrong: ${label(Q.mistakes, a.mistakes)}. When unsure: ${youLabel(Q.unsure, a.unsure)}.`,
    `Open with ${label(Q.lead_with, a.lead_with)}; ${label(Q.structure, a.structure)}; evidence ${label(Q.evidence, a.evidence)}.${a.signature === 'yes' ? ' Sign every edit to a note (one `Last edited by:` line, overwritten).' : ''}`,
    a.never.length ? `Never: ${a.never.map(md).join('; ')}.` : null,
  ].filter(x => x !== null).join('\n');
}

/* ChatGPT box 1, "what to know about you": the profile without the firmness table, sized for a
   custom-instructions box. The full USER.md stays the owning copy. */
function compactProfile(a) {
  return [
    `Call me ${md(a.name)}${a.pronouns ? ` (${md(a.pronouns)})` : ''}.`,
    a.work ? `I do: ${md(a.work)}.` : null,
    a.focus ? `Current focus: ${md(a.focus)}.` : null,
    a.off_limits.length ? `Off limits, never surfaced in any reply: ${a.off_limits.map(md).join(', ')}.` : null,
    'How firmly I mean things: "kind of" or a made-up word is a gesture; "I like" is a preference; "I always" is a practice; "never" or "I have to" is a rule. When unsure read one rung looser, never tighter; never loosen a stated prohibition.',
  ].filter(Boolean).join('\n');
}

module.exports = { QUESTIONS, QUICK, PINNED, TOOL, VERSION, DOCS, FALLBACK, NOTES_PENDING_MARK, notesPending, asks, defaults, sparse, validate, parseAnswer, renderUser, renderOnboarding, contractBlock, compactProfile, kindOf, baseFor };
