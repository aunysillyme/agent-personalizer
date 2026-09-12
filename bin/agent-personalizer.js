#!/usr/bin/env node
'use strict';
/*
  agent-personalizer installer.

    npx agent-personalizer [--dir <folder>] [--ai claude,agents,gemini,chatgpt,prompt] [--level 1|2|3]
                                              [--answers <file.json>] [--defaults] [--full] [--yes]

  Interactive when flags are missing and stdin is a terminal. Non-interactive with flags.
  The ONBOARDING INTERVIEW (how to talk to you, output shape, what to read first, where the AI
  may write, how to save, what to ask before doing) runs interactively, or takes --answers
  <file.json>, or --defaults / --yes to accept every default. The answers are stored under
  "onboarding" in .agent-personalizer.json and rendered to AGENT_ONBOARDING.md; USER.md is
  generated from the same answers when it does not exist yet.
  Level 1 writes USER.md, AGENT_ONBOARDING.md and the home file(s); the rules render into the home
  file from the package's own rules/ and nothing is copied, so the home files name no notes folder
  (level 2 creates it, and level 2+ repoints them). Level 3 copies rules/ (yours to edit from
  then on) with the renderer, hook and gate. .agent-personalizer.json stores only the answers that
  differ from the defaults.
  Writes only the files for the chosen AIs and level. Never overwrites a file that exists
  (except the marker block inside rendered files it owns, .agent-personalizer.json, which
  is its own record and is merged, never blindly replaced, and USER.md when, and only when,
  the answers changed and the file still equals the render of the previous answers byte for
  byte; an edited USER.md is kept and the changed answers are named as a conflict).
  PREFLIGHT: every path is probed and every existing rendered target is decoded and its marker
  block checked BEFORE the first write, so a refusal leaves the folder as it was. The notes
  folder the scaffold creates and the home files point at is your notes_path (disk tools) or
  notes/ (the fallback); a cloud tool gets no local notes folder at all. Refuses to write through any
  symlink or outside the install folder (the folder you name is followed once, via realpath;
  nothing beneath it may be a symlink). Reads no environment variables. Writes no secrets.

  exit codes: 0 ok · 1 unexpected error · 2 refused or invalid input
*/
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const PKG = path.resolve(__dirname, '..');
const onboarding = require(path.join(PKG, 'render', 'onboarding.cjs'));
const markers = require(path.join(PKG, 'render', 'render.cjs'));   // markerState, for the preflight; render.cjs runs nothing on require
const AIS = ['claude', 'agents', 'gemini', 'chatgpt', 'prompt'];
const AI_LABEL = { claude: 'Claude (Claude Code, Claude apps)', agents: 'Codex / Cursor / anything that reads AGENTS.md', gemini: 'Gemini', chatgpt: 'ChatGPT custom instructions', prompt: 'a plain system prompt (shareable, no profile)' };

function die(msg) { console.error(`agent-personalizer: ${msg}`); process.exit(2); }

const VALUE_OPTS = ['--dir', '--ai', '--level', '--answers'];
const FLAG_OPTS = ['--yes', '--defaults', '--quick', '--full', '--help', '--version', '-h', '-v'];
const USAGE = `agent-personalizer ${require(path.join(PKG, 'package.json')).version}

  npx agent-personalizer [--dir <folder>] [--ai claude,agents,gemini,chatgpt,prompt] [--level 1|2|3]
                                            [--answers <file.json> | --answers - | --defaults] [--full] [--yes]
                                            [--help | -h] [--version | -v]

  Interactive when flags are missing and stdin is a terminal; the onboarding interview runs then.
  The interview is SHORT by default: the seven questions that change behaviour (name, tone, length,
  notes tool and path, write policy, always-ask), plus any question the notes tool you pick makes
  apply. Every other answer takes its default.
  --full       ask every question instead of the short set. Interactive only.
  --quick      the short interview. It is now the default; the flag is kept so older commands still work.
  --answers    a JSON file of answers, or "-" to read the JSON from stdin. Unknown keys and values are refused.
  --defaults   the ANSWER SOURCE: accept every default without being asked. With or without --yes.
  --yes        NON-INTERACTIVE MODE, not an answer source. It needs --dir, --ai and --level, and with no
               --answers it falls back to the defaults.
  Levels: 1 profile, onboarding and home file(s); nothing else (the rules render from the package)
          2 + the notes folder: its README, a weekly session log, a decisions log and an inbox
          3 + the renderer, the session-start hook, the gate and a copy of rules/ to edit
  exit codes: 0 ok · 1 unexpected error · 2 refused or invalid input
`;
/* Parse argv once, strictly: value options at most once each, flags at most once, nothing unknown. */
function parseArgs() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_OPTS.includes(a)) {
      if (a in out) die(`${a} given more than once`);
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) die(`${a} needs a non-empty value`);
      out[a] = v; i++;
    } else if (FLAG_OPTS.includes(a)) {
      if (a in out) die(`${a} given more than once`);
      out[a] = true;
    } else die(`unknown option "${a}" (known: ${[...VALUE_OPTS, ...FLAG_OPTS].join(', ')})`);
  }
  return out;
}
const ARGS = parseArgs();
function arg(name, dflt) { return name in ARGS ? ARGS[name] : dflt; }
if (ARGS['--help'] || ARGS['-h']) { process.stdout.write(USAGE); process.exit(0); }
if (ARGS['--version'] || ARGS['-v']) { process.stdout.write(require(path.join(PKG, 'package.json')).version + '\n'); process.exit(0); }

async function ask(q, dflt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise(res => rl.question(`${q}${dflt ? ` [${dflt}]` : ''}: `, res));
  rl.close();
  return (a || dflt || '').trim();
}

/* Resolve <root>/<rel> such that every existing component is a real directory (never a
   symlink) and the result stays inside the real root. Returns { full, exists }. A dangling
   symlink counts as "exists" and is refused. */
function safeDest(root, rel) {
  if (path.isAbsolute(rel) || rel.split('/').some(p => p === '..' || p === '')) die(`refusing path "${rel}"`);
  const parts = rel.split('/');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st = null;
    try { st = fs.lstatSync(cur); } catch (_) { st = null; }
    if (st && st.isSymbolicLink()) die(`${path.relative(root, cur)} is a symlink; refusing to write through it`);
    if (i < parts.length - 1) {
      if (st && !st.isDirectory()) die(`${path.relative(root, cur)} exists and is not a directory`);
      if (!st) fs.mkdirSync(cur);
    } else {
      if (!(cur + path.sep).startsWith(root + path.sep)) die(`"${rel}" resolves outside the install folder`);
      return { full: cur, exists: !!st };
    }
  }
  die('unreachable');
}

/* safeDest without the mkdir: the same symlink and containment checks, nothing created. Used by the
   preflight so a refusal leaves the folder exactly as it was. */
function probe(root, rel) {
  if (path.isAbsolute(rel) || rel.split('/').some(p => p === '..' || p === '')) die(`refusing path "${rel}"`);
  const parts = rel.split('/');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st = null;
    try { st = fs.lstatSync(cur); } catch (_) { st = null; }
    if (st && st.isSymbolicLink()) die(`${path.relative(root, cur)} is a symlink; refusing to write through it`);
    if (i < parts.length - 1) { if (st && !st.isDirectory()) die(`${path.relative(root, cur)} exists and is not a directory`); if (!st) return { full: path.join(root, rel), exists: false }; }
    else { if (!(cur + path.sep).startsWith(root + path.sep)) die(`"${rel}" resolves outside the install folder`); return { full: cur, exists: !!st }; }
  }
  die('unreachable');
}

function copyIfAbsent(src, root, rel) {
  const { full, exists } = safeDest(root, rel);
  if (exists) { console.log(`kept   ${rel} (exists)`); return false; }
  fs.copyFileSync(src, full, fs.constants.COPYFILE_EXCL);
  console.log(`wrote  ${rel}`);
  return true;
}

async function main() {
  const interactive = process.stdin.isTTY && !!!ARGS['--yes'];
  let dir = arg('--dir', null);
  let ais = arg('--ai', null);
  let level = arg('--level', null);

  if (interactive) {
    console.log('\nagent-personalizer\n');
    dir = dir || await ask('Folder to install into', '.');
    console.log('\nWhich AIs do you use? Comma-separated from:');
    for (const k of AIS) console.log(`  ${k.padEnd(8)} ${AI_LABEL[k]}`);
    ais = ais || await ask('\nAIs', 'claude,agents');
    console.log('\nLevels: 1 profile, onboarding and home file(s) · 2 + the notes folder · 3 + renderer, session-start hook, gate and your own rules/');
    level = level || await ask('Level', '1');
  }
  if (!dir || !ais || !level) die('non-interactive run needs --dir, --ai and --level (and --yes)');
  if (!/^[1-4]$/.test(String(level))) die('level must be exactly 1, 2 or 3');
  level = Number(level);
  // 4 was once offered as a peer of 1-3 and installed exactly what 3 installs: the hand-off layer is
  // reading material, not files. It is no longer offered, and still accepted so older scripts run.
  if (level === 4) console.log('note: --level 4 installs exactly what --level 3 installs. The hand-off layer (routing, task bundles, verified CLI runs) is reading material until it ships, so 3 is the top install level.');
  const targets = String(ais).split(',').map(s => s.trim()).filter(Boolean);
  const bad = targets.filter(t => !AIS.includes(t));
  if (bad.length) die(`unknown AI: ${bad.join(', ')} (known: ${AIS.join(', ')})`);
  if (!targets.length) die('no AIs chosen');
  if (new Set(targets).size !== targets.length) die(`an AI is listed twice in --ai (${targets.join(',')}); list each once`);

  // Onboarding answers: a file, the defaults, or the interview. Validated before anything is created.
  let answers = null, answersSource = '';
  const answersFile = arg('--answers', null);
  if (answersFile && arg('--defaults', false)) die('--answers and --defaults are exclusive');
  if (arg('--quick', false) && arg('--full', false)) die('--quick and --full are exclusive; the short interview is the default');
  if (arg('--quick', false) && (answersFile || arg('--defaults', false) || !interactive)) die('--quick is the short interview; it needs a terminal and no --answers, --defaults or --yes');
  if (arg('--full', false) && (answersFile || arg('--defaults', false) || !interactive)) die('--full is the long interview; it needs a terminal and no --answers, --defaults or --yes');
  if (answersFile) {
    let raw;
    const label = answersFile === '-' ? 'stdin' : answersFile;
    try { raw = JSON.parse(answersFile === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(answersFile), 'utf8')); } catch (e) { die(`--answers: cannot read ${label} as JSON (${e.message})`); }
    try { answers = onboarding.validate(raw); } catch (e) { die(`--answers: ${e.message}`); }
    answersSource = `from ${label}`;
  } else if (arg('--defaults', false) || !interactive) {
    answers = onboarding.defaults();
    if (!arg('--defaults', false) && !process.stdin.isTTY) console.error('agent-personalizer: stdin is not a terminal, so the interview cannot run; using the default answers (pass --answers <file.json>, --answers -, or --defaults to silence this)');
    answersSource = process.stdin.isTTY ? 'defaults (pass --answers <file.json>, or run without --yes, to answer the interview)' : 'defaults (stdin is not a terminal; pass --answers <file.json> or --answers - to script them)';
  } else {
    const full = !!arg('--full', false);
    console.log('\nOnboarding: how should an AI work with you? Enter accepts the default in brackets.');
    console.log(full
      ? `Full interview: up to ${onboarding.QUESTIONS.length} questions, some of which apply only to certain notes tools.\n`
      : `Short interview: the ${onboarding.QUICK.length} questions that change behaviour, plus any the notes tool you pick makes apply. Every other answer takes its default; --full asks all ${onboarding.QUESTIONS.length}.\n`);
    const raw = {};
    for (const q of onboarding.QUESTIONS) {
      if (!onboarding.asks(q, raw, full)) continue;
      if (q.options) for (const [v, l] of q.options) console.log(`    ${v.padEnd(30)} ${l}`);
      const dflt = Array.isArray(q.default) ? q.default.join(', ') : q.default;
      raw[q.id] = onboarding.parseAnswer(q, await ask(q.ask, dflt || ''));
    }
    try { answers = onboarding.validate(raw); } catch (e) { die(`onboarding: ${e.message}`); }
    answersSource = full ? 'your interview answers' : 'your short-interview answers (the rest are defaults)';
  }

  // The folder you name is followed once (realpath of its deepest EXISTING ancestor); the
  // missing tail is created one level at a time, so nothing is ever created through a
  // symlink that did not exist when you ran the command. Everything beneath root is then
  // symlink-free by construction (safeDest refuses any).
  const requested = path.resolve(String(dir));
  let existing = requested; const missing = [];
  while (!fs.existsSync(existing)) { missing.unshift(path.basename(existing)); const parent = path.dirname(existing); if (parent === existing) die(`cannot create ${requested}`); existing = parent; }
  let root = fs.realpathSync(existing);
  for (const part of missing) { root = path.join(root, part); fs.mkdirSync(root); }
  if (!fs.lstatSync(root).isDirectory()) die(`--dir ${requested} is not a directory`);
  // Config: the one file this installer rewrites. Read and VALIDATED here, before the first write, so a malformed
  // stored config refuses the whole run and leaves the folder untouched. Existing onboarding answers are kept unless
  // --answers or the interview supplied new ones; targets are merged; "onboarding" is always a target.
  const { full: cfgPath, exists: cfgExists } = probe(root, '.agent-personalizer.json');
  let cfg = { targets: [], level };
  let prevAnswers = null;
  if (cfgExists) {
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { die(`.agent-personalizer.json is not valid JSON (${e.message}); fix or remove it`); }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) die('.agent-personalizer.json must be an object');
    if ('targets' in cfg) {
      if (!Array.isArray(cfg.targets)) die('.agent-personalizer.json "targets" must be a list');
      const KNOWN = [...AIS, 'onboarding'];
      const bad = cfg.targets.filter(t => !KNOWN.includes(t));
      if (bad.length) die(`.agent-personalizer.json lists unknown target(s): ${bad.join(', ')} (known: ${KNOWN.join(', ')}); fix or remove them`);
      if (new Set(cfg.targets).size !== cfg.targets.length) die('.agent-personalizer.json lists a target twice');
    }
    if ('level' in cfg && !(Number.isInteger(cfg.level) && cfg.level >= 1 && cfg.level <= 4)) die(`.agent-personalizer.json "level" must be an integer 1-4 (found ${JSON.stringify(cfg.level)})`);
    if (cfg.onboarding) {
      try { prevAnswers = onboarding.validate(cfg.onboarding); } catch (e) { die(`.agent-personalizer.json onboarding answers: ${e.message}`); }
      if (!answersFile && answersSource.startsWith('defaults')) { answers = prevAnswers; answersSource = 'kept from .agent-personalizer.json'; }
    }
  }
  const allTargets = [...new Set([...(Array.isArray(cfg.targets) ? cfg.targets : []), ...targets, 'onboarding'])];
  const base = onboarding.baseFor(answers);              // the folder scaffolds and home-file pointers use
  const kind = onboarding.kindOf(answers);

  console.log(`\nInstalling level ${level} for ${targets.join(', ')} into ${root}\nOnboarding answers: ${answersSource}\n`);

  // ---- PLAN: every file this run would create, computed before anything is written ----
  const plan = [];                                        // { rel, src | text }
  // signature=no: the signature rule file is not installed (a `requires:` rule that is absent cannot drift back in),
  // and every copied markdown loses its `Last edited by:` template line and its pointer to the rule.
  const noSig = answers.signature === 'no';
  const stripSig = (t) => noSig ? t.split('\n').filter(l => !l.includes('40-sign-every-edit.md') && !/^`?Last edited by:/.test(l)).join('\n') : t;
  const mdCopy = (rel, src) => plan.push({ rel, text: stripSig(fs.readFileSync(src, 'utf8')) });
  // rules/ is copied at level 3, where it becomes yours to edit; levels 1 and 2 render from the package's rules
  if (level >= 3) for (const f of fs.readdirSync(path.join(PKG, 'rules')).sort()) {
    if (noSig && f === '40-sign-every-edit.md') continue;
    mdCopy(`rules/${f}`, path.join(PKG, 'rules', f));
  }
  // The home templates carry four `notes/...` pointer lines. They collapse to ONE line whenever the
  // folder they name will not be there to read: a cloud notes tool has no local folder at all, and no
  // level below 2 creates one, so a level-1 install used to hand the first session four broken
  // pointers. NOTES_ONE_LINE is also what the level-2 upgrade looks for, byte for byte.
  const NOTES_ONE_LINE = (why) => `- Notes: see \`AGENT_ONBOARDING.md\` § Where you may write (${why})`;
  const NOTES_LATER = `no local notes folder at level 1; level 2 creates \`${base}/\``;
  // Is the folder every notes pointer names going to be there to read? The README is the file the AI
  // is told to read before it writes, and the level-2 scaffold creates it with the folder. The LEVEL
  // alone is a proxy that is wrong in both directions: a level-1 install can land beside a notes
  // folder that already exists, and a re-run at a lower level does not delete what a higher one made
  // (round 1, findings 4 and 5). One boolean drives the home-file collapse and both rendered files,
  // so they can never disagree about the same folder.
  const scaffoldExists = (() => { try { return fs.statSync(path.join(root, base, 'README.md')).isFile(); } catch (_) { return false; } })();
  const willScaffold = level >= 2 && kind !== 'cloud';    // this run's own scaffold, written further down
  const notesScaffolded = kind !== 'cloud' && (scaffoldExists || willScaffold);
  const notesWhy = kind === 'cloud' ? 'reached through its connector, no local files'
    : !notesScaffolded ? NOTES_LATER
    : kind !== 'disk' ? 'local fallback folder `notes/`'
    : null;                                               // disk, scaffold present: the four paths, retargeted at notes_path
  const home = (name) => {
    let t = fs.readFileSync(path.join(PKG, 'templates', name), 'utf8');
    if (level < 3) {
      // no local rules/: the pointers point at the rendered block below, which carries the full text
      t = t.split('\n').filter(l => !/Rules, one file each, the owning copy/.test(l)).join('\n');
      t = t.replace(/`\[owner: rules\/[^\]]+\]`/g, '`[owner: the rendered block below]`');
    }
    if (notesWhy) {
      let done = false;
      t = t.split('\n').filter(l => { if (!/`notes\//.test(l)) return true; if (done) return false; done = true; return true; })
        .map(l => /`notes\//.test(l) ? NOTES_ONE_LINE(notesWhy) : l).join('\n');
    } else if (base !== 'notes') t = t.replace(/\bnotes\//g, `${base}/`);
    return stripSig(t);
  };
  const POINTER = 'pointer file; the renderer fills its block below';
  if (targets.includes('claude')) plan.push({ rel: 'CLAUDE.md', text: home('CLAUDE.md'), note: POINTER });
  if (targets.includes('agents')) plan.push({ rel: 'AGENTS.md', text: home('AGENTS.md'), note: POINTER });
  if (level >= 2 && kind !== 'cloud') {                   // a cloud tool's notes are not local files; no folder named after a workspace
    mdCopy(`${base}/README.md`, path.join(PKG, 'templates', 'FOLDER_README.md'));
    mdCopy(`${base}/sessions/TEMPLATE-week.md`, path.join(PKG, 'templates', 'session-log.md'));
    mdCopy(`${base}/decisions.md`, path.join(PKG, 'templates', 'decisions-log.md'));
    mdCopy(`${base}/inbox/README.md`, path.join(PKG, 'templates', 'INBOX_README.md'));
  }
  if (level >= 3) {
    for (const rel of ['render/render.cjs', 'render/targets.json', 'render/onboarding.cjs', 'hooks/README.md', 'hooks/claude-code/session-start.sh', 'check/gate.cjs', 'check/forbidden.example.txt'])
      plan.push({ rel, src: path.join(PKG, rel) });
  }

  // ---- PREFLIGHT: refuse now, with nothing written, everything the renderer would refuse later ----
  for (const p of plan) probe(root, p.rel);              // symlinks and non-directories on the way
  // sources already in the folder (a kept rules/ file, a kept USER.md): parsed exactly as the renderer will parse them
  markers.DIE_THROWS = true;
  try { markers.preflightSources(root); }
  catch (e) { if (e instanceof markers.Refusal) die(`${e.message}. The renderer would refuse this folder; nothing was written`); throw e; }
  finally { markers.DIE_THROWS = false; }
  const TARGETS = JSON.parse(fs.readFileSync(path.join(PKG, 'render', 'targets.json'), 'utf8'));
  for (const t of allTargets) {
    const rel = TARGETS[t].file;
    const { full, exists } = probe(root, rel);
    if (exists) {
      const st = fs.lstatSync(full);
      if (!st.isFile()) die(`${rel} exists and is not a regular file; nothing was written`);
      let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(full)); } catch (_) { die(`${rel} is not valid UTF-8; the renderer would refuse it. Nothing was written`); }
      const ms = markers.markerState(text, rel);
      if (ms.kind === 'malformed') die(`${rel}: malformed marker block (${ms.begins} begin, ${ms.ends} end). Fix it by hand; nothing was written`);
      try { fs.accessSync(full, fs.constants.W_OK); } catch (_) { die(`${rel} is not writable; nothing was written`); }
    } else {
      // the nearest existing ancestor must be writable (the renderer creates the file there)
      let d = path.dirname(full); while (!fs.existsSync(d)) d = path.dirname(d);
      try { fs.accessSync(d, fs.constants.W_OK); } catch (_) { die(`${path.relative(root, d) || '.'} is not writable; nothing was written`); }
    }
  }
  // USER.md: yours once it exists. Regenerated only when it still equals the render of the PREVIOUS
  // answers byte for byte (you never touched it) and the answers changed. Otherwise kept, and any
  // changed answer that the kept file still carries the old value of is named as a conflict.
  const user = probe(root, 'USER.md');
  let userAction = 'create';
  let staleNotesInUser = false;
  const changedKeys = prevAnswers ? Object.keys(answers).filter(k => JSON.stringify(answers[k]) !== JSON.stringify(prevAnswers[k])) : [];
  if (user.exists) {
    if (!fs.lstatSync(user.full).isFile()) die('USER.md exists and is not a regular file');
    const current = fs.readFileSync(user.full, 'utf8');
    // Two candidate renders per answer set, one saying the notes folder is there and one saying it is
    // not (#25). A match against EITHER means the file is still exactly what this installer wrote,
    // so regenerating loses nothing; anything else is yours and is kept.
    const untouched = (ans) => [true, false].some(ns => current === onboarding.renderUser(ans, { notesScaffolded: ns }));
    if (changedKeys.length) {
      userAction = untouched(prevAnswers) ? 'regenerate' : 'conflict';
    } else if (notesScaffolded && current === onboarding.renderUser(answers, { notesScaffolded: false })) {
      // Same answers, but the file says the folder is absent and it is not (this run created it, or
      // it was already there). The real paths go back, and only on a byte-for-byte match.
      userAction = 'relevel';
    } else userAction = 'keep';
    // A kept file that does not name the folder README while the folder is there is stale, however it
    // was worded: keying the notice on one sentence let an edit to that sentence silence it (finding 6).
    if (userAction === 'keep' && notesScaffolded && !current.includes(`\`${base}/README.md\``)) staleNotesInUser = true;
  }

  // Upgrade from a lower level. Two repairs, each matched byte for byte against a line THIS installer
  // wrote, so anything the user edited is left alone:
  //   level 3: the pointer lines said "the rendered block below"; now that rules/ arrives they name it.
  //   level 2: the one-line notes placeholder a level-1 install wrote becomes the real pointers, now
  //            that the folder behind them exists.
  const upgrades = [];
  if (level >= 2) for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    if (!(name === 'CLAUDE.md' ? targets.includes('claude') : targets.includes('agents'))) continue;
    const { full, exists } = probe(root, name);
    if (!exists || !fs.lstatSync(full).isFile()) continue;
    const tmpl = stripSig(fs.readFileSync(path.join(PKG, 'templates', name), 'utf8')).split('\n');
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const why = [];
    if (level >= 3) {
      let repointed = false;
      for (const t of tmpl) {
        if (!/`\[owner: rules\/[^\]]+\]`/.test(t)) continue;
        const placeholder = t.replace(/`\[owner: rules\/[^\]]+\]`/g, '`[owner: the rendered block below]`');
        for (let i = 0; i < lines.length; i++) if (lines[i] === placeholder) { lines[i] = t; repointed = true; }
      }
      const rulesLine = tmpl.find(l => /Rules, one file each, the owning copy/.test(l));
      const anchorIdx = lines.findIndex(l => /AGENT_ONBOARDING\.md`$/.test(l) && /^- /.test(l));
      if (rulesLine && !lines.includes(rulesLine) && anchorIdx !== -1 && repointed) lines.splice(anchorIdx + 1, 0, rulesLine);
      if (repointed) why.push('rule pointers now name rules/, which this level installs');
    }
    if (!notesWhy) {                                      // this run creates the folder the four lines name
      const idx = lines.indexOf(NOTES_ONE_LINE(NOTES_LATER));
      if (idx !== -1) {
        lines.splice(idx, 1, ...tmpl.filter(l => /`notes\//.test(l)).map(l => base === 'notes' ? l : l.replace(/\bnotes\//g, `${base}/`)));
        why.push(`notes pointers now name ${base}/, which this level installs`);
      }
    }
    if (why.length) { try { fs.accessSync(full, fs.constants.W_OK); } catch (_) { die(`${name} is not writable; nothing was written`); } upgrades.push({ name, full, text: lines.join('\n'), why }); }
  }

  // ---- WRITE ----
  for (const u of upgrades) { fs.writeFileSync(u.full, u.text); console.log(`update ${u.name} (${u.why.join('; ')})`); }
  if (userAction === 'create') { fs.writeFileSync(user.full, onboarding.renderUser(answers, { notesScaffolded }), { flag: 'wx' }); console.log('wrote  USER.md (from your answers)'); }
  else if (userAction === 'regenerate') { fs.writeFileSync(user.full, onboarding.renderUser(answers, { notesScaffolded })); console.log(`update USER.md (regenerated: it matched your previous answers byte for byte; changed: ${changedKeys.join(', ')})`); }
  else if (userAction === 'relevel') { fs.writeFileSync(user.full, onboarding.renderUser(answers, { notesScaffolded })); console.log(`update USER.md (notes pointers now name ${base}/, which is there; it matched the render that said it was not, byte for byte)`); }
  else if (userAction === 'conflict') {
    console.log(`kept   USER.md (you edited it, so it was not regenerated)`);
    console.log(`       ANSWERS CHANGED: ${changedKeys.join(', ')}. USER.md still carries the old value(s) and the rendered profile sections come from USER.md.`);
    console.log(`       Fix by hand, or delete USER.md and re-run to regenerate it from the new answers. AGENT_ONBOARDING.md already carries the new answers.`);
  } else {
    console.log('kept   USER.md (exists)');
    if (staleNotesInUser) console.log(`       NOTE: you edited USER.md while it still said there is no local notes folder. ${base}/ exists now. Fix the two "Where things live" lines by hand, or delete USER.md and re-run.`);
  }
  for (const p of plan) {
    if (p.src) copyIfAbsent(p.src, root, p.rel);
    else {
      const { full, exists } = safeDest(root, p.rel);
      if (exists) console.log(`kept   ${p.rel} (exists)`);
      else { fs.writeFileSync(full, p.text, { flag: 'wx' }); console.log(`wrote  ${p.rel}${p.note ? ` (${p.note})` : ''}`); }
    }
  }
  if (level >= 3) {
    const hp = path.join(root, 'hooks', 'claude-code', 'session-start.sh');
    const st = fs.lstatSync(hp);
    if (!st.isFile() || st.isSymbolicLink()) die('hook file changed underneath the installer; not chmod-ing it');
    fs.chmodSync(hp, 0o755);
  }
  cfg = { ...cfg, targets: allTargets, level: Math.max(level, cfg.level || 0), onboarding: onboarding.sparse(answers) };   // only what differs from the defaults
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${cfgExists ? 'update' : 'wrote '} .agent-personalizer.json (onboarding: ${answersSource})`);

  // Render the FULL merged target list (what a plain `render.cjs --dir .` will use from now on), from the package's renderer.
  execFileSync(process.execPath, [path.join(PKG, 'render', 'render.cjs'), '--dir', root, '--targets', allTargets.join(',')], { stdio: 'inherit' });

  const DOCS = onboarding.DOCS;
  // the rerun command a user can actually type: the npx form when this ran from npm's cache, else the local path that just worked
  const SELF = /[\\/]_npx[\\/]|[\\/]node_modules[\\/]/.test(PKG) ? 'npx agent-personalizer' : `node ${path.relative(process.cwd(), path.join(PKG, 'bin', 'agent-personalizer.js')) || 'bin/agent-personalizer.js'}`;
  // The rerun command names the folder that was just installed, in full. "--dir ." was a command that
  // wrote into whatever directory it was pasted from, which is not where the install went.
  const shq = (x) => /^[A-Za-z0-9._\/@:+,=-]+$/.test(x) ? x : `'${String(x).replace(/'/g, "'\\''")}'`;
  const DIR = shq(root);
  // Which of the files just written an AI picks up on its own, and which a human still has to paste.
  // Claude Code reads CLAUDE.md from the folder; claude.ai reads no files at all, and the success
  // text used to say nothing about that.
  const AUTO = { claude: 'CLAUDE.md (Claude Code)', agents: 'AGENTS.md (Codex, Cursor, anything that reads AGENTS.md)', gemini: 'GEMINI.md (Gemini CLI)' };
  const PASTE = {
    claude: 'claude.ai and the Claude apps read no files: paste the body of USER.md, then AGENT_ONBOARDING.md, into the project or profile instructions',
    chatgpt: 'ChatGPT: paste chatgpt-box1.txt and chatgpt-box2.txt into its two custom-instruction boxes',
    prompt: 'system-prompt.md: paste it wherever you set a system prompt',
  };
  const auto = targets.filter(t => AUTO[t]).map(t => AUTO[t]);
  const paste = targets.filter(t => PASTE[t]).map(t => PASTE[t]);
  const steps = [];
  steps.push('Read AGENT_ONBOARDING.md once: that is what every AI will be told about working with you. Re-run this installer with new answers to change it.\n     USER.md is yours to edit freely; the onboarding file is regenerated from .agent-personalizer.json.');
  steps.push(level >= 3
    ? `Re-render after editing: node render/render.cjs --dir ${DIR}   (drift check: add --check)`
    : `Re-render after editing by running this installer again (it keeps your files and only refreshes the rendered blocks):\n     ${SELF} --dir ${DIR} --ai ${targets.join(',')} --level ${level} --yes`);
  steps.push([
    auto.length ? `Read from ${root} automatically, nothing to paste: ${auto.join(', ')}.` : null,
    paste.length ? `Still needs a paste: ${paste.join('; ')}.` : null,
    `Which file each AI reads, and what to re-paste after you change an answer: ${DOCS}/paste-guide.md`,
  ].filter(Boolean).join('\n     '));
  if (level >= 2 && kind !== 'cloud') steps.push(`Read ${base}/README.md before letting an AI write into ${base}/.`);
  if (level >= 3) steps.push('Register hooks/claude-code/session-start.sh (see hooks/README.md) and copy check/forbidden.example.txt to check/forbidden.local.txt.');
  console.log('\nNext:');
  steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  if (answers.notes_tool === 'obsidian') console.log(answers.obsidian_tc === 'yes'
    ? `\nCompanion: the onboarding file routes the AI through obsidian-tc; configure its folder ACLs from your off-limits answer and its human-in-the-loop list from your always-ask answer. See ${DOCS}/companions.md`
    : `\nCompanion: your notes are an Obsidian vault and the AI will work on the folder directly. obsidian-tc would give it governed access (folder ACLs, human-in-the-loop, audit log): \`npx obsidian-tc /path/to/vault\`, then re-run this installer and answer yes. See ${DOCS}/companions.md`);
  else if (answers.notes_tool === 'notion' || answers.notes_tool === 'google-docs') console.log(`\nCompanion: connect ${answers.notes_tool === 'notion' ? 'Notion' : 'Google Drive / Docs'} through your AI's own connector settings (where the app offers one); the onboarding file already names the door and the write posture, and tells the AI to make no filesystem writes for these notes. See ${DOCS}/companions.md`);
  else if (answers.notes_tool === 'apple-notes') console.log(`\nCompanion: Apple Notes needs a separately installed local Apple Notes MCP; no AI app ships one built in. Until you connect one, the onboarding file already limits the AI to reading and creating new notes. See ${DOCS}/companions.md`);
  else if (answers.notes_tool === 'other') console.log(`\nNote: "${answers.notes_tool_name || 'your notes tool'}" is unknown to this kit; the onboarding file tells the AI to ask before its first write there and to use the local fallback folder notes/ meanwhile.`);
  else if (['onenote', 'evernote'].includes(answers.notes_tool)) console.log(`\nNote: ${answers.notes_tool} has no first-class agent door today; the onboarding file treats it as read-only. See ${DOCS}/companions.md`);
  if (targets.length > 1) console.log(`\nSeveral agents? Read ${DOCS}/companions.md on the Context Layer: purpose-bound bundles and receipts for every delegation.`);
  console.log('\nNothing here read an environment variable or wrote a secret.');
  console.log('\nIf this saved you time, a star helps people find it: https://github.com/aunysillyme/agent-personalizer');
}

main().catch(e => { if (e && e.status !== undefined) process.exit(e.status || 1); console.error(e.message); process.exit(1); });
