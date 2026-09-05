'use strict';
/*
  onboarding.js: the agent-onboarding interview and its two renders.

  The user answers a short set of questions (or accepts the defaults). From ONE answer set:
    renderUser(answers)        -> USER.md          the human profile (who I am, how to talk to me)
    renderOnboarding(answers)  -> AGENT_ONBOARDING.md  the agent-facing manual: how to talk, output
                                                      shape, what to read first, where to write,
                                                      how to save, what to ask before doing
    contractBlock(answers)     -> the short block a session-start hook injects

  Defaults are the generalized shape of one working setup. Every default is a question the user
  can answer differently; nothing here is imposed. No network, no environment, no secrets.
*/

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
    options: [['ask-when-it-changes-the-build', 'settle facts itself; ask only when the answer changes what gets built'], ['ask-first', 'ask before doing anything uncertain'], ['assume-and-say', 'proceed on a stated assumption, never ask']] },
  { id: 'lead_with', ask: 'What should a reply open with?', type: 'choice', default: 'verdict',
    options: [['verdict', 'the answer or the verdict'], ['summary', 'a one-paragraph summary'], ['context', 'the context, then the answer']] },
  { id: 'structure', ask: 'How should replies be shaped?', type: 'choice', default: 'bullets',
    options: [['bullets', 'lead-in line, then bullets, one item per line'], ['prose', 'short paragraphs'], ['tables-when-comparing', 'bullets by default, a table when comparing three or more things']] },
  { id: 'evidence', ask: 'Where should evidence for a claim go?', type: 'choice', default: 'inline',
    options: [['inline', 'in the reply: paths, counts, dates'], ['linked', 'a link to where it lives'], ['none', 'not needed']] },
  { id: 'never', ask: 'Words, punctuation or habits the AI must never use (comma-separated, blank for none)', type: 'list', default: [] },
  { id: 'read_first', ask: 'Files the AI reads first, in order (comma-separated)', type: 'list', default: ['USER.md', 'AGENT_ONBOARDING.md', 'notes/README.md', 'rules/'] },
  { id: 'notes_tool', ask: 'Where do your notes live?', type: 'choice', default: 'folder',
    options: [['obsidian', 'an Obsidian vault (pairs with obsidian-tc, see docs/companions.md)'], ['notion', 'Notion'], ['google-docs', 'Google Docs / Drive'], ['apple-notes', 'Apple Notes'], ['onenote', 'Microsoft OneNote'], ['evernote', 'Evernote'], ['logseq', 'Logseq'], ['folder', 'a plain folder of markdown files'], ['other', 'something else (name it in the next answer)']] },
  { id: 'notes_path', ask: 'The folder path (Obsidian, Logseq, plain folder), or the workspace / page name (Notion, Google Docs, others)', type: 'text', default: 'notes' },
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
  return out;
}

/* Parse one typed interview answer (a string) for a question; '' means the default. */
function parseAnswer(q, raw) {
  const s = String(raw).trim();
  if (s === '') return Array.isArray(q.default) ? [...q.default] : q.default;
  if (q.type === 'text') return s;
  if (q.type === 'choice') return s;
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

const label = (q, v) => { const o = q.options && q.options.find(x => x[0] === v); return o ? o[1] : v; };
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

function renderUser(a) {
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
- **When you are unsure:** ${label(Q.unsure, a.unsure)}
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

- **My notes:** ${md(TOOL[a.notes_tool](esc(a.notes_path), md(a.notes_path)).name)}, \`${esc(a.notes_path)}\`
- **My task tracker:** ${md(a.tracker)}
- **Rules the AI must read before writing anything to my notes:** \`${esc(a.notes_path)}/README.md\`
`;
}

const TOOL = {
  'obsidian': (p) => ({ name: 'Obsidian', reach: `the vault at \`${p}/\`, through **obsidian-tc** (governed MCP: folder ACLs, human-in-the-loop confirmation for destructive tools, audit log) rather than raw filesystem access; see docs/companions.md`, posture: null }),
  'logseq': (p) => ({ name: 'Logseq', reach: `the graph folder at \`${p}/\`, as plain files`, posture: null }),
  'folder': (p) => ({ name: 'a folder of markdown files', reach: `\`${p}/\` on disk`, posture: null }),
  'notion': (p, q) => ({ name: 'Notion', reach: `the workspace "${q}" through Notion's own MCP connector`, posture: 'Write only into the pages or databases named in this file. Propose a new top-level page; never create one unasked.' }),
  'google-docs': (p, q) => ({ name: 'Google Docs', reach: `"${q}" through the Google Drive / Docs connector`, posture: 'Draft into a doc named for the topic. Never edit the existing text of a shared doc without being asked.' }),
  'apple-notes': (p, q) => ({ name: 'Apple Notes', reach: `the "${q}" folder through a local Apple Notes MCP`, posture: 'Read, and create new notes. Never edit or delete an existing note.' }),
  'onenote': (p, q) => ({ name: 'Microsoft OneNote', reach: `"${q}" as a read-only source (no first-class agent door today)`, posture: 'Treat it as read-only. Write to the notes folder below and say what to paste.' }),
  'evernote': (p, q) => ({ name: 'Evernote', reach: `"${q}" as a read-only source (no first-class agent door today)`, posture: 'Treat it as read-only. Write to the notes folder below and say what to paste.' }),
  'other': (p, q) => ({ name: 'the notes tool named below', reach: `"${q}"`, posture: null }),
};

function renderOnboarding(a) {
  const tool = TOOL[a.notes_tool](esc(a.notes_path), md(a.notes_path));   // p for code spans, q for prose
  const writeLine = {
    'notes-freely': `You may create and edit files anywhere under \`${esc(a.notes_path)}/\`, under that folder's rules. Nowhere else without being asked.`,
    'logs-and-inbox-only': `You may write only to the session log (\`${esc(a.notes_path)}/sessions/\`), the decisions log (\`${esc(a.notes_path)}/decisions.md\`) and the inbox (\`${esc(a.notes_path)}/inbox/\`). Anything else: propose it, do not write it.`,
    'ask-before-every-write': 'Ask before every write, every time. Show what you would write and where.',
  }[a.write_policy];
  const naming = { 'kebab-case': 'kebab-case: `my-note-title.md`', 'snake_case': 'snake_case: `my_note_title.md`', 'any': 'no naming rule; match the folder you are writing into' }[a.file_naming];
  const askList = a.always_ask.map(v => `- **${v}**: ${label(Q.always_ask, v)}`).join('\n') || '- nothing declared; use your judgement and say what you did';
  const toolLine = `- **Notes live in ${md(tool.name)}:** reach them as ${tool.reach}.${tool.posture ? ` ${tool.posture}` : ''}`;
  return `## Agent onboarding

_Generated by agent-personalizer from ${md(a.name)}'s own answers (stored in \`.agent-personalizer.json\`). Re-run the installer to change an answer. Read this after \`USER.md\`, before your first substantive reply._

### Who you are working with

- **Call them:** ${md(a.name)}${a.pronouns ? ` (${md(a.pronouns)})` : ''}
${a.work ? `- **What they do:** ${md(a.work)}\n` : ''}${a.focus ? `- **Current focus:** ${md(a.focus)}\n` : ''}- **How firmly they mean things:** read the rungs in \`USER.md\` § How firmly I mean things, and default one rung looser when unsure.

### How to talk

- **Directness:** ${label(Q.tone, a.tone)}.
- **Length:** ${label(Q.length, a.length)}.
- **When you are wrong:** ${label(Q.mistakes, a.mistakes)}.
- **When you are unsure:** ${label(Q.unsure, a.unsure)}.
- **Never:** ${a.never.length ? a.never.map(md).join('; ') : 'nothing declared'}.

### Output shape

- **Open with:** ${label(Q.lead_with, a.lead_with)}.
- **Structure:** ${label(Q.structure, a.structure)}.
- **Evidence:** ${label(Q.evidence, a.evidence)}.
- **Code:** fenced blocks only. **Closing:** no recap.

### Read this first, in order

${bullets(a.read_first.map(md), 'USER.md')}
${a.tracker !== 'none' ? `- The task tracker (${md(a.tracker)}): what is open and what is already decided, before proposing work.\n` : ''}
### Where you may write

${toolLine}
- ${writeLine}
- **Every folder you write into has a README.** Any write, edit or delete means that README is corrected in the same pass: the file's one-line description, the folder's status, settled decisions, next steps. A stale index is worse than none, because the next agent believes it.
- **Session log:** append a dated section to this week's note in \`${esc(a.notes_path)}/sessions/\`. **Decisions:** one line each in \`${esc(a.notes_path)}/decisions.md\`. **Inbox:** one file per item in \`${esc(a.notes_path)}/inbox/\`; finished items are deleted, not marked done.

### How to save a file

- **Naming:** ${naming}.
- **One owner per fact.** Before writing, search for where the same thing already lives and edit there. Never restate a rule in a second file; link to the file that owns it.
- **Read before you append.** Never duplicate content that is already in the file.
${a.signature === 'yes' ? '- **Sign every edit.** Last line of the file: `Last edited by: <ai> <model> <YYYY-MM-DD> · <what changed, ten words or fewer>`. `Created by:` on a new file. One line, overwritten, never stacked.\n' : '- **No signature line** was requested; keep the file exactly as its folder expects.\n'}
### Before you act

Settle every FACT yourself: a read, a search, a probe, one tool call. Never hand back "worth confirming X" when one call settles X. A MANDATE is theirs. Always ask before:

${askList}

Never close a task on a claim. Verify against the artifact, then say what you checked.

### Off limits

${bullets(a.off_limits.map(x => `${md(x)}: never surfaced, quoted or summarized in any reply or deliverable, even if a search returns it`), 'nothing declared yet')}

### Standing habits, whatever the task

- **Evidence before assertion.** Read the source before stating anything about this person's setup, history or decisions, and cite the path or id.
- **Match the firmness.** A word they reached for is a gesture; "I like" is a preference; "I always" is a practice; "never" is a rule. Encode nothing above the rung it arrived at.
- **Finish the whole task**, then stop. No closing recap, no unrequested next steps.`;
}

function contractBlock(a) {
  return [
    `## How to work with ${md(a.name)}`,
    '',
    `Directness: ${label(Q.tone, a.tone)}. Length: ${label(Q.length, a.length)}. When wrong: ${label(Q.mistakes, a.mistakes)}. When unsure: ${label(Q.unsure, a.unsure)}.`,
    `Open with ${label(Q.lead_with, a.lead_with)}; ${label(Q.structure, a.structure)}; evidence ${label(Q.evidence, a.evidence)}.`,
    a.never.length ? `Never: ${a.never.map(md).join('; ')}.` : null,
    `Always ask before: ${a.always_ask.join(', ') || 'nothing declared'}.`,
    a.off_limits.length ? `Off limits in any output: ${a.off_limits.map(md).join(', ')}.` : null,
    `Read first: ${a.read_first.map(md).join(' → ')}.`,
    `Notes: ${md(TOOL[a.notes_tool](esc(a.notes_path), md(a.notes_path)).name)} at ${md(a.notes_path)}${a.notes_tool === 'obsidian' ? ', through obsidian-tc' : ''}.`,
  ].filter(Boolean).join('\n');
}

module.exports = { QUESTIONS, defaults, validate, parseAnswer, renderUser, renderOnboarding, contractBlock };
