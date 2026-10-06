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
  Writes only the chosen AIs and the highest installed level. Re-runs replace untouched
  installer-owned copies using recorded hashes, with a static release-hash fallback for older
  installs. Edited files and pointer lines are kept and named. Previous notes folders stay in
  place and in the uninstall inventory. The config is merged; USER.md is regenerated only
  when it still equals the previous answer render. All writes roll back if rendering fails.
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
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// CLAUDE.md and AGENTS.md are written here as a pointer template only; render.cjs (run at the
// end of main()) splices in the rendered block and records the final bytes it wrote, so their
// hash is recorded there, once, against the complete file.
const HOME_NAMES = new Set(['CLAUDE.md', 'AGENTS.md']);

const PKG = path.resolve(__dirname, '..');
const onboarding = require(path.join(PKG, 'render', 'onboarding.cjs'));
const markers = require(path.join(PKG, 'render', 'render.cjs'));   // markerState, for the preflight; render.cjs runs nothing on require
const { installPlan, validateInventory, knownVersions, ownership, migrateHome, recordedHash } = require('./install-plan.cjs');
const AIS = ['claude', 'agents', 'gemini', 'chatgpt', 'prompt'];
const AI_LABEL = { claude: 'Claude (Claude Code, Claude apps)', agents: 'Codex / Cursor / anything that reads AGENTS.md', gemini: 'Gemini', chatgpt: 'ChatGPT custom instructions', prompt: 'a plain system prompt (shareable, no profile)' };

let committing = false;
function die(msg) { if (committing) throw new markers.Refusal(msg); console.error(`agent-personalizer: ${msg}`); process.exit(2); }

const VALUE_OPTS = ['--dir', '--ai', '--level', '--answers'];
const FLAG_OPTS = ['--yes', '--defaults', '--quick', '--full', '--uninstall', '--dry', '--help', '--version', '-h', '-v'];
const USAGE = `agent-personalizer ${require(path.join(PKG, 'package.json')).version}

  npx agent-personalizer [--dir <folder>] [--ai claude,agents,gemini,chatgpt,prompt] [--level 1|2|3]
                                            [--answers <file.json> | --answers - | --defaults] [--full] [--yes]
                                            [--help | -h] [--version | -v]
  npx agent-personalizer --uninstall --dir <folder> [--dry]

  Interactive when flags are missing and stdin is a terminal; the onboarding interview runs then.
  The interview is SHORT by default: the seven questions that change behaviour (name, tone, length,
  notes tool and path, write policy, always-ask), plus any question the notes tool you pick makes
  apply. Other answers keep their saved values, or take defaults on the first install.
  --full       ask every question instead of the short set. Interactive only.
  --quick      the short interview. It is now the default; the flag is kept so older commands still work.
  --answers    a JSON file of answers, or "-" to read the JSON from stdin. Unknown keys and values are refused.
  --defaults   the ANSWER SOURCE: accept every default without being asked. With or without --yes.
  --yes        NON-INTERACTIVE MODE, not an answer source. It needs --dir, --ai and --level, and with no
               --answers it falls back to the defaults.
  --uninstall  remove unchanged installed files; keep and name edited files and user text.
  --dry        preview --uninstall without changing files.
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

async function ask(q, dflt, saved = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise(res => rl.question(`${q}${dflt || saved ? ` [${dflt}]` : ''}: `, res));
  rl.close();
  return saved ? a.trim() : (a || dflt || '').trim();
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

// Read the stored config once. The interview uses it before any directories or files are created;
// non-interactive answer sources retain their existing handling below.
function readConfig(root, level) {
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
    try { validateInventory(cfg); } catch (e) { die(`.agent-personalizer.json: ${e.message}; nothing was written`); }
    markers.DIE_THROWS = true;
    try { markers.validatePreservedTargets(cfg); }
    catch (e) { if (e instanceof markers.Refusal) die(e.message); throw e; }
    finally { markers.DIE_THROWS = false; }
    if (cfg.onboarding) {
      try { prevAnswers = onboarding.validate(cfg.onboarding); } catch (e) { die(`.agent-personalizer.json onboarding answers: ${e.message}`); }
    }
  }
  return { cfgPath, cfgExists, cfg, prevAnswers };
}

// Follow the requested folder once, without creating its missing tail.
function resolveDestination(dir) {
  const requested = path.resolve(String(dir));
  let existing = requested; const missing = [];
  while (!fs.existsSync(existing)) { missing.unshift(path.basename(existing)); const parent = path.dirname(existing); if (parent === existing) die(`cannot create ${requested}`); existing = parent; }
  const realExisting = fs.realpathSync(existing);
  return { requested, realExisting, missing, root: path.join(realExisting, ...missing) };
}

async function main() {
  if (ARGS['--uninstall']) {
    if (!ARGS['--dir']) die('--uninstall needs --dir <folder>');
    for (const opt of ['--ai', '--level', '--answers', '--defaults', '--quick', '--full'])
      if (opt in ARGS) die(`${opt} is an install option; --uninstall reads the stored config`);
    return require('./uninstall.cjs').uninstall(ARGS['--dir'], { dry: !!ARGS['--dry'] });
  }
  if (ARGS['--dry']) die('--dry needs --uninstall');
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
  // Keep the former level accepted so existing scripts run. Routing has its own package.
  if (level === 4) console.log('note: --level 4 installs exactly what --level 3 installs. For model routing, see https://github.com/aunysillyme/model-orchestrator');
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
  let destination = null, stored = null;
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
    destination = resolveDestination(dir);
    const { requested, root, missing } = destination;
    if (!missing.length && !fs.lstatSync(root).isDirectory()) die(`--dir ${requested} is not a directory`);
    stored = readConfig(root, level);
    const saved = stored.prevAnswers;
    const full = !!arg('--full', false);
    console.log(saved
      ? '\nOnboarding: how should an AI work with you? Enter keeps the saved answer shown in brackets.'
      : '\nOnboarding: how should an AI work with you? Enter accepts the default in brackets.');
    console.log(full
      ? `Full interview: up to ${onboarding.QUESTIONS.length} questions, some of which apply only to certain notes tools.\n`
      : `Short interview: the ${onboarding.QUICK.length} questions that change behaviour, plus any the notes tool you pick makes apply. ${saved ? 'Every other answer keeps its saved value' : 'Every other answer takes its default'}; --full asks up to ${onboarding.QUESTIONS.length}, skipping questions that do not apply to your notes tool.\n`);
    const raw = saved ? onboarding.interviewAnswers(saved) : {};
    for (const q of onboarding.QUESTIONS) {
      if (!onboarding.asks(q, raw, full)) continue;
      if (q.options) for (const [v, l] of q.options) console.log(`    ${v.padEnd(30)} ${l}`);
      const value = onboarding.interviewDefault(q, saved);
      const dflt = Array.isArray(value) ? value.join(', ') : value;
      raw[q.id] = onboarding.parseAnswer({ ...q, default: value }, await ask(q.ask, dflt || '', !!saved));
    }
    try { answers = onboarding.validate(raw); } catch (e) { die(`onboarding: ${e.message}`); }
    answersSource = full ? 'your interview answers' : `your short-interview answers (the rest are ${saved ? 'kept saved values' : 'defaults'})`;
  }

  // The folder you name is followed once (realpath of its deepest EXISTING ancestor); the
  // missing tail is created one level at a time, so nothing is ever created through a
  // symlink that did not exist when you ran the command. Everything beneath root is then
  // symlink-free by construction (safeDest refuses any).
  const { requested, root, realExisting, missing } = destination || resolveDestination(dir);
  let creating = realExisting;
  for (const part of missing) { creating = path.join(creating, part); fs.mkdirSync(creating); }
  if (!fs.lstatSync(root).isDirectory()) die(`--dir ${requested} is not a directory`);
  // Config: the one file this installer rewrites. Read and VALIDATED here, before the first write, so a malformed
  // stored config refuses the whole run and leaves the folder untouched. Existing onboarding answers are kept unless
  // --answers or the interview supplied new ones; targets are merged; "onboarding" is always a target.
  const storedConfig = stored || readConfig(root, level);
  const { cfgPath, cfgExists, prevAnswers } = storedConfig;
  let cfg = storedConfig.cfg;
  if (prevAnswers && !answersFile && answersSource.startsWith('defaults')) {
    answers = prevAnswers; answersSource = 'kept from .agent-personalizer.json';
  }
  const allTargets = [...new Set([...(Array.isArray(cfg.targets) ? cfg.targets : []), ...targets, 'onboarding'])];
  const installedLevel = Math.max(level, cfg.level || 0);
  const effectiveLevel = Math.min(installedLevel, 3);
  const base = onboarding.baseFor(answers);              // the folder scaffolds and home-file pointers use
  const kind = onboarding.kindOf(answers);
  // Bytes actually written, by tracked path, so --uninstall never has to re-derive them from
  // whatever package version happens to be running at removal time. Carried forward across runs;
  // only ever added to here, never pruned (a config predating this field has none, and falls
  // back to the older comparison; see uninstall.cjs).
  const installedHashes = { ...(cfg.installed && typeof cfg.installed === 'object' ? cfg.installed : {}) };
  const createdDirectories = new Set(cfg.createdDirectories || []);
  const toolingVersions = { ...(cfg.toolingVersions || {}) };
  const toolingVersion = require(path.join(PKG, 'package.json')).version;
  const legacy = cfgExists && !!prevAnswers && !Object.hasOwn(cfg, 'installed');

  console.log(`\nInstalling level ${level} for ${targets.join(', ')} into ${root}\nOnboarding answers: ${answersSource}\n`);

  // ---- PLAN: every file this run would create, computed before anything is written ----
  const scaffoldExists = (() => { try { return fs.statSync(path.join(root, base, 'README.md')).isFile(); } catch (_) { return false; } })();
  const willScaffold = effectiveLevel >= 2 && kind !== 'cloud';
  const notesScaffolded = kind !== 'cloud' && (scaffoldExists || willScaffold);
  const { plan } = installPlan({ answers, level: effectiveLevel, targets: allTargets, notesScaffolded });
  const plannedBytes = new Map();
  for (const p of plan) {
    const bytes = p.src ? fs.readFileSync(p.src) : Buffer.from(p.text);
    if (plannedBytes.has(p.rel) && !plannedBytes.get(p.rel).equals(bytes)) die(`${p.rel}: conflicting install paths; nothing was written`);
    plannedBytes.set(p.rel, bytes);
  }
  const previousBase = prevAnswers ? onboarding.baseFor(prevAnswers) : null;
  const previousNotesExists = previousBase && !!probe(root, `${previousBase}/README.md`).exists;
  const previousNotesScaffolded = prevAnswers && onboarding.kindOf(prevAnswers) !== 'cloud' && ((cfg.level || 1) >= 2 || previousNotesExists);
  const previousPlan = prevAnswers ? installPlan({ answers: prevAnswers, level: Math.min(cfg.level || 1, 3), targets: cfg.targets || [], notesScaffolded: previousNotesScaffolded }).plan : [];

  // ---- PREFLIGHT: refuse now, with nothing written, everything the renderer would refuse later ----
  for (const p of plan) {
    const destination = probe(root, p.rel);
    if (destination.exists && !fs.lstatSync(destination.full).isFile()) die(`${p.rel} exists and is not a regular file; nothing was written`);
  }
  for (const rel of Object.keys(installedHashes)) probe(root, rel);
  for (const rel of createdDirectories) {
    const destination = probe(root, rel);
    if (destination.exists && !fs.lstatSync(destination.full).isDirectory()) die(`${rel} is not a directory; nothing was written`);
  }
  // sources already in the folder (a kept rules/ file, a kept USER.md): parsed exactly as the renderer will parse them
  markers.DIE_THROWS = true;
  try { markers.preflightSources(root); }
  catch (e) { if (e instanceof markers.Refusal) die(`${e.message}. The renderer would refuse this folder; nothing was written`); throw e; }
  finally { markers.DIE_THROWS = false; }
  const TARGETS = JSON.parse(fs.readFileSync(path.join(PKG, 'render', 'targets.json'), 'utf8'));
  const preservedTargets = new Set(cfg.preservedTargets || []);
  for (const t of allTargets) {
    const rel = TARGETS[t].file;
    const { full, exists } = probe(root, rel);
    if (exists) {
      if (!cfgExists || !(cfg.targets || []).includes(t)) preservedTargets.add(t);
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

  // Previous answers identify the exact installer lines to migrate. Each unchanged line is
  // replaced or removed on its own; all other outside-marker bytes stay exactly as read.
  const upgrades = [];
  const outside = (text, name) => {
    const ms = markers.markerState(text, name);
    return ms.kind === 'one' ? text.slice(0, ms.bStart) + text.slice(ms.eEnd) : text;
  };
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const prior = previousPlan.find(p => p.rel === name);
    const next = plan.find(p => p.rel === name);
    if (!prior || !next) continue;
    const { full, exists } = probe(root, name);
    if (!exists || !fs.lstatSync(full).isFile()) continue;
    const current = fs.readFileSync(full, 'utf8');
    if (outside(current, name) !== outside(prior.text, name)) preservedTargets.add(name === 'CLAUDE.md' ? 'claude' : 'agents');
    const migration = migrateHome(current, prior.text, next.text, text => markers.markerState(text, name));
    for (const line of migration.edited) console.log(`kept   ${name} (edited pointer; manual review): ${line}`);
    if (migration.changed) {
      const why = effectiveLevel >= 3 && (cfg.level || 1) < 3 ? 'rule pointers now name rules/, which this level installs' : 'unchanged installer pointer lines migrated to the new answers';
      upgrades.push({ rel: name, bytes: Buffer.from(migration.text), report: `update ${name} (${why})` });
    }
  }

  const writes = [...upgrades], removals = [];
  // Legacy installs have no hashes. Only an exact prior recipe or committed release hash
  // can establish ownership; an existing file in a fresh folder is never adopted.
  if (legacy) for (const p of previousPlan) {
    if (HOME_NAMES.has(p.rel)) continue;
    const destination = probe(root, p.rel);
    if (!destination.exists || !fs.lstatSync(destination.full).isFile()) continue;
    const bytes = fs.readFileSync(destination.full);
    const expected = p.src ? fs.readFileSync(p.src) : Buffer.from(p.text);
    if (ownership(cfg, p.rel, bytes, { legacy: true, expected }).unedited) installedHashes[p.rel] = sha256(bytes);
  }
  // Learn an old tool's origin from known untouched peer copies, never by executing them.
  let previousToolingVersion = cfg.toolingVersion;
  if (!previousToolingVersion && cfgExists) {
    let candidates = null;
    for (const p of previousPlan.filter(p => p.src)) {
      const destination = probe(root, p.rel);
      if (!destination.exists) continue;
      const versions = knownVersions(p.rel, fs.readFileSync(destination.full));
      if (versions.length) candidates = candidates === null ? versions : candidates.filter(version => versions.includes(version));
    }
    if (candidates?.length === 1) previousToolingVersion = candidates[0];
  }
  const editedCopy = (rel, version) => `kept   ${rel} (edited${version ? `; from version ${version}` : ''}; to take version ${toolingVersion}, save your edits, remove ${rel} and re-run)`;
  for (const p of plan) {
    const destination = probe(root, p.rel);
    const bytes = p.src ? fs.readFileSync(p.src) : Buffer.from(p.text);
    if (HOME_NAMES.has(p.rel)) {
      if (!destination.exists) writes.push({ rel: p.rel, bytes, report: `wrote  ${p.rel} (${p.note})` });
      continue;
    }
    if (destination.exists) {
      const existing = fs.readFileSync(destination.full);
      const old = previousPlan.find(prior => prior.rel === p.rel);
      const expected = old && (old.src ? fs.readFileSync(old.src) : Buffer.from(old.text));
      const owner = ownership(cfg, p.rel, existing, { legacy: legacy && !!old, expected });
      if (!owner.unedited) {
        const tracked = recordedHash(cfg, p.rel) || (legacy && old) || Object.hasOwn(cfg.toolingVersions || {}, p.rel);
        const origin = (cfg.toolingVersions || {})[p.rel] || previousToolingVersion || owner.version;
        if (tracked && origin && (p.src || p.rel.startsWith('rules/'))) toolingVersions[p.rel] = origin;
        console.log(tracked ? editedCopy(p.rel, origin) : `kept   ${p.rel} (pre-existing; manual review)`);
        continue;
      }
      if (existing.equals(bytes)) {
        installedHashes[p.rel] = sha256(bytes);
        if (p.src || p.rel.startsWith('rules/')) toolingVersions[p.rel] = toolingVersion;
        console.log(`kept   ${p.rel} (unchanged)`);
        continue;
      }
      writes.push({ rel: p.rel, bytes, report: `update ${p.rel} (untouched installer copy refreshed${p.src || p.rel.startsWith('rules/') ? ` to version ${toolingVersion}` : ''})` });
    } else writes.push({ rel: p.rel, bytes, report: `wrote  ${p.rel}${p.note ? ` (${p.note})` : ''}` });
    installedHashes[p.rel] = sha256(bytes);
    if (p.src || p.rel.startsWith('rules/')) toolingVersions[p.rel] = toolingVersion;
  }
  // Retire only copied rules that the current answers omit. An old notes folder always
  // stays, even when no current recipe mentions it; its hashes remain in the inventory.
  const currentPaths = new Set(plan.map(p => p.rel));
  for (const rel of Object.keys(installedHashes)) {
    if (!rel.startsWith('rules/') || currentPaths.has(rel)) continue;
    const destination = probe(root, rel);
    if (!destination.exists) continue;
    if (!fs.lstatSync(destination.full).isFile()) die(`${rel} is not a regular file; nothing was written`);
    if (sha256(fs.readFileSync(destination.full)) === installedHashes[rel]) removals.push({ rel, report: `remove ${rel} (untouched installer copy; the new answers omit it)` });
    else console.log(editedCopy(rel, toolingVersions[rel] || previousToolingVersion));
  }
  if (previousBase && previousBase !== base && previousNotesExists) console.log(`kept   ${previousBase}/ (previous notes folder; current notes folder: ${base}/; kept in the uninstall inventory)`);

  if (userAction === 'create' || userAction === 'regenerate' || userAction === 'relevel') {
    const rendered = onboarding.renderUser(answers, { notesScaffolded });
    writes.push({ rel: 'USER.md', bytes: Buffer.from(rendered) });
    installedHashes['USER.md'] = sha256(Buffer.from(rendered));
    if (userAction === 'create') console.log('wrote  USER.md (from your answers)');
    else if (userAction === 'regenerate') console.log(`update USER.md (regenerated: it matched your previous answers byte for byte; changed: ${changedKeys.join(', ')})`);
    else console.log(`update USER.md (notes pointers now name ${base}/, which is there; it matched the render that said it was not, byte for byte)`);
  }
  else if (userAction === 'conflict') {
    console.log(`kept   USER.md (you edited it, so it was not regenerated)`);
    console.log(`       ANSWERS CHANGED: ${changedKeys.join(', ')}. USER.md still carries the old value(s) and the rendered profile sections come from USER.md.`);
    console.log(`       Fix by hand, or delete USER.md and re-run to regenerate it from the new answers. AGENT_ONBOARDING.md already carries the new answers.`);
  } else {
    console.log('kept   USER.md (exists)');
    if (staleNotesInUser) console.log(`       NOTE: you edited USER.md while it still said there is no local notes folder. ${base}/ exists now. Fix the two "Where things live" lines by hand, or delete USER.md and re-run.`);
  }
  // Snapshot every possible output and check every parent before the first write. The
  // renderer runs from this package, not from a potentially edited installed executable.
  const outputPaths = new Set(['.agent-personalizer.json', ...writes.map(p => p.rel), ...removals.map(p => p.rel)]);
  for (const target of allTargets.map(key => TARGETS[key])) {
    outputPaths.add(target.file);
    for (const rel of Object.values(target.boxFiles || {})) outputPaths.add(rel);
  }
  for (const rel of outputPaths) {
    let parent = path.posix.dirname(rel);
    while (parent !== '.') {
      if (outputPaths.has(parent)) die(`${parent}: install path is both a file and a directory; nothing was written`);
      parent = path.posix.dirname(parent);
    }
  }
  const saved = new Map(), newDirectories = new Set();
  for (const rel of outputPaths) {
    const destination = probe(root, rel);
    if (destination.exists) {
      const info = fs.lstatSync(destination.full);
      if (!info.isFile()) die(`${rel} is not a regular file; nothing was written`);
      saved.set(rel, { bytes: fs.readFileSync(destination.full), mode: info.mode & 0o777, dev: info.dev, ino: info.ino });
    } else saved.set(rel, null);
    let parent = path.posix.dirname(rel);
    while (parent !== '.') {
      if (!probe(root, parent).exists) newDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
    let ancestor = path.dirname(destination.full);
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    try { fs.accessSync(ancestor, fs.constants.W_OK); } catch (_) { die(`${rel}: parent is not writable; nothing was written`); }
  }
  for (const rel of newDirectories) createdDirectories.add(rel);
  cfg = { ...cfg, targets: allTargets, level: installedLevel, onboarding: onboarding.sparse(answers), preservedTargets: [...preservedTargets], installed: installedHashes, createdDirectories: [...createdDirectories].sort(), toolingVersion, toolingVersions };
  writes.push({ rel: '.agent-personalizer.json', bytes: Buffer.from(JSON.stringify(cfg, null, 2) + '\n'), report: `${cfgExists ? 'update' : 'wrote '} .agent-personalizer.json (onboarding: ${answersSource})` });
  const replace = (rel, bytes, mode) => {
    const destination = safeDest(root, rel);
    const tmp = path.join(path.dirname(destination.full), `.${path.basename(rel)}.${crypto.randomBytes(8).toString('hex')}.agent-personalizer.tmp`);
    try {
      fs.writeFileSync(tmp, bytes, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
      if (mode !== undefined) fs.chmodSync(tmp, mode);
      probe(root, rel);
      fs.renameSync(tmp, destination.full);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  };
  const assertSaved = rel => {
    const destination = probe(root, rel), before = saved.get(rel);
    if (!!before !== destination.exists) die(`${rel} changed during preflight; nothing was written`);
    if (before) {
      const info = fs.lstatSync(destination.full);
      if (info.dev !== before.dev || info.ino !== before.ino || !fs.readFileSync(destination.full).equals(before.bytes)) die(`${rel} changed during preflight; nothing was written`);
    }
  };
  committing = true;
  const touched = new Set();
  try {
    for (const rel of outputPaths) assertSaved(rel);
    for (const p of removals) { assertSaved(p.rel); fs.unlinkSync(probe(root, p.rel).full); touched.add(p.rel); console.log(p.report); }
    for (const p of writes) {
      assertSaved(p.rel);
      touched.add(p.rel);
      const mode = p.rel === 'hooks/claude-code/session-start.sh' ? 0o755 : saved.get(p.rel)?.mode;
      replace(p.rel, p.bytes, mode);
      if (p.report) console.log(p.report);
    }
    // Include renderer outputs in rollback even when it committed before reporting a failure.
    for (const rel of outputPaths) touched.add(rel);
    execFileSync(process.execPath, [path.join(PKG, 'render', 'render.cjs'), '--dir', root, '--targets', allTargets.join(',')], { stdio: 'inherit' });
  } catch (e) {
    const incomplete = [];
    for (const rel of [...touched].reverse()) {
      try {
        const before = saved.get(rel), destination = probe(root, rel);
        if (before) replace(rel, before.bytes, before.mode);
        else if (destination.exists) fs.unlinkSync(destination.full);
      } catch (failure) { incomplete.push(`${rel}: ${failure.message}`); }
    }
    for (const rel of [...newDirectories].sort((a, b) => b.split('/').length - a.split('/').length)) {
      try { const destination = probe(root, rel); if (destination.exists && fs.readdirSync(destination.full).length === 0) fs.rmdirSync(destination.full); }
      catch (failure) { incomplete.push(`${rel}/: ${failure.message}`); }
    }
    console.error(incomplete.length ? `agent-personalizer: ROLLBACK INCOMPLETE\n${incomplete.join('\n')}` : 'agent-personalizer: install failed; every changed file was restored');
    throw e;
  } finally { committing = false; }

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
    chatgpt: 'ChatGPT: open Settings → Personalization and enable customization. Copy the exported profile (chatgpt-box1.txt) and response instructions (chatgpt-box2.txt) into the fields your current interface provides, checking its displayed limits',
    prompt: 'system-prompt.md: paste it wherever you set a system prompt',
  };
  const auto = targets.filter(t => AUTO[t]).map(t => AUTO[t]);
  const paste = targets.filter(t => PASTE[t]).map(t => PASTE[t]);
  const steps = [];
  steps.push('Read AGENT_ONBOARDING.md once: that is what every AI will be told about working with you. Re-run this installer with new answers to change it.\n     USER.md is yours to edit freely; the onboarding file is regenerated from .agent-personalizer.json.');
  steps.push(level >= 3
    ? `Re-render after editing: node render/render.cjs --dir ${DIR}   (drift check: add --check)`
    : `Re-render after editing by running this installer again (it refreshes generated outputs and untouched installer copies, and keeps and names edited files):\n     ${SELF} --dir ${DIR} --ai ${targets.join(',')} --level ${level} --yes`);
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

main().catch(e => { if (e && e.status !== undefined) process.exit(e.status || 1); console.error(e.message); process.exit(e instanceof markers.Refusal ? 2 : 1); });
