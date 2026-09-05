#!/usr/bin/env node
'use strict';
/*
  agent-personalizer installer.

    npx github:aunysillyme/agent-personalizer [--dir <folder>] [--ai claude,agents,gemini,chatgpt,prompt] [--level 1|2|3|4]
                                              [--answers <file.json>] [--defaults] [--yes]

  Interactive when flags are missing and stdin is a terminal. Non-interactive with flags.
  The ONBOARDING INTERVIEW (how to talk to you, output shape, what to read first, where the AI
  may write, how to save, what to ask before doing) runs interactively, or takes --answers
  <file.json>, or --defaults / --yes to accept every default. The answers are stored under
  "onboarding" in .agent-personalizer.json and rendered to AGENT_ONBOARDING.md; USER.md is
  generated from the same answers when it does not exist yet.
  Writes only the files for the chosen AIs and level. Never overwrites a file that exists
  (except the marker block inside rendered files it owns, and .agent-personalizer.json, which
  is its own record and is merged, never blindly replaced). Refuses to write through any
  symlink or outside the install folder (the folder you name is followed once, via realpath;
  nothing beneath it may be a symlink). Reads no environment variables. Writes no secrets.

  exit codes: 0 ok · 1 unexpected error · 2 refused or invalid input
*/
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const PKG = path.resolve(__dirname, '..');
const onboarding = require(path.join(PKG, 'render', 'onboarding.js'));
const AIS = ['claude', 'agents', 'gemini', 'chatgpt', 'prompt'];
const AI_LABEL = { claude: 'Claude (Claude Code, Claude apps)', agents: 'Codex / Cursor / anything that reads AGENTS.md', gemini: 'Gemini', chatgpt: 'ChatGPT custom instructions', prompt: 'a plain system prompt (shareable, no profile)' };

function die(msg) { console.error(`agent-personalizer: ${msg}`); process.exit(2); }

const VALUE_OPTS = ['--dir', '--ai', '--level', '--answers'];
const FLAG_OPTS = ['--yes', '--defaults'];
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
    console.log('\nLevels: 1 one file · 2 dynamic docs · 3 mechanisms (renderer, hook, check) · 4 hand-off pointers');
    level = level || await ask('Level', '1');
  }
  if (!dir || !ais || !level) die('non-interactive run needs --dir, --ai and --level (and --yes)');
  if (!/^[1-4]$/.test(String(level))) die('level must be exactly 1, 2, 3 or 4');
  level = Number(level);
  const targets = String(ais).split(',').map(s => s.trim()).filter(Boolean);
  const bad = targets.filter(t => !AIS.includes(t));
  if (bad.length) die(`unknown AI: ${bad.join(', ')} (known: ${AIS.join(', ')})`);
  if (!targets.length) die('no AIs chosen');
  if (new Set(targets).size !== targets.length) die(`an AI is listed twice in --ai (${targets.join(',')}); list each once`);

  // Onboarding answers: a file, the defaults, or the interview. Validated before anything is created.
  let answers = null, answersSource = '';
  const answersFile = arg('--answers', null);
  if (answersFile && arg('--defaults', false)) die('--answers and --defaults are exclusive');
  if (answersFile) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.resolve(answersFile), 'utf8')); } catch (e) { die(`--answers: cannot read ${answersFile} as JSON (${e.message})`); }
    try { answers = onboarding.validate(raw); } catch (e) { die(`--answers: ${e.message}`); }
    answersSource = `from ${answersFile}`;
  } else if (arg('--defaults', false) || !interactive) {
    answers = onboarding.defaults();
    answersSource = 'defaults (pass --answers <file.json>, or run without --yes, to answer the interview)';
  } else {
    console.log('\nOnboarding: how should an AI work with you? Enter accepts the default in brackets.\n');
    const raw = {};
    for (const q of onboarding.QUESTIONS) {
      if (q.options) for (const [v, l] of q.options) console.log(`    ${v.padEnd(30)} ${l}`);
      const dflt = Array.isArray(q.default) ? q.default.join(', ') : q.default;
      raw[q.id] = onboarding.parseAnswer(q, await ask(q.ask, dflt || ''));
    }
    try { answers = onboarding.validate(raw); } catch (e) { die(`onboarding: ${e.message}`); }
    answersSource = 'your interview answers';
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
  const { full: cfgPath, exists: cfgExists } = safeDest(root, '.agent-personalizer.json');
  let cfg = { targets: [], level };
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
    if (cfg.onboarding && !answersFile && answersSource.startsWith('defaults')) {
      try { answers = onboarding.validate(cfg.onboarding); answersSource = 'kept from .agent-personalizer.json'; } catch (e) { die(`.agent-personalizer.json onboarding answers: ${e.message}`); }
    }
  }

  console.log(`\nInstalling level ${level} for ${targets.join(', ')} into ${root}\nOnboarding answers: ${answersSource}\n`);

  // Level 1: profile (generated from the answers when absent), home files, the rule source they render from.
  {
    const { full, exists } = safeDest(root, 'USER.md');
    if (exists) console.log('kept   USER.md (exists)');
    else { fs.writeFileSync(full, onboarding.renderUser(answers), { flag: 'wx' }); console.log('wrote  USER.md (from your answers)'); }
  }
  for (const f of fs.readdirSync(path.join(PKG, 'rules')).sort()) copyIfAbsent(path.join(PKG, 'rules', f), root, `rules/${f}`);
  if (targets.includes('claude')) copyIfAbsent(path.join(PKG, 'templates', 'CLAUDE.md'), root, 'CLAUDE.md');
  if (targets.includes('agents')) copyIfAbsent(path.join(PKG, 'templates', 'AGENTS.md'), root, 'AGENTS.md');

  // Level 2: the notes folder and its contracts.
  if (level >= 2) {
    copyIfAbsent(path.join(PKG, 'templates', 'FOLDER_README.md'), root, 'notes/README.md');
    copyIfAbsent(path.join(PKG, 'templates', 'session-log.md'), root, 'notes/sessions/TEMPLATE-week.md');
    copyIfAbsent(path.join(PKG, 'templates', 'decisions-log.md'), root, 'notes/decisions.md');
    copyIfAbsent(path.join(PKG, 'templates', 'INBOX_README.md'), root, 'notes/inbox/README.md');
  }

  // Level 3: renderer, hook, gate, and a config so `check` knows the targets.
  if (level >= 3) {
    copyIfAbsent(path.join(PKG, 'render', 'render.js'), root, 'render/render.js');
    copyIfAbsent(path.join(PKG, 'render', 'targets.json'), root, 'render/targets.json');
    copyIfAbsent(path.join(PKG, 'render', 'onboarding.js'), root, 'render/onboarding.js');
    copyIfAbsent(path.join(PKG, 'hooks', 'README.md'), root, 'hooks/README.md');
    const hookCreated = copyIfAbsent(path.join(PKG, 'hooks', 'claude-code', 'session-start.sh'), root, 'hooks/claude-code/session-start.sh');
    copyIfAbsent(path.join(PKG, 'check', 'gate.js'), root, 'check/gate.js');
    copyIfAbsent(path.join(PKG, 'check', 'forbidden.example.txt'), root, 'check/forbidden.example.txt');
    if (hookCreated) {
      const hp = path.join(root, 'hooks', 'claude-code', 'session-start.sh');
      const st = fs.lstatSync(hp);
      if (!st.isFile() || st.isSymbolicLink()) die('hook file changed underneath the installer; not chmod-ing it');
      fs.chmodSync(hp, 0o755);
    }
  }
  const allTargets = [...new Set([...(Array.isArray(cfg.targets) ? cfg.targets : []), ...targets, 'onboarding'])];
  cfg = { ...cfg, targets: allTargets, level: Math.max(level, cfg.level || 0), onboarding: answers };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${cfgExists ? 'update' : 'wrote '} .agent-personalizer.json (onboarding: ${answersSource})`);

  // Render the FULL merged target list (what a plain `render.js --dir .` will use from now on), from the package's renderer.
  execFileSync(process.execPath, [path.join(PKG, 'render', 'render.js'), '--dir', root, '--targets', allTargets.join(',')], { stdio: 'inherit' });

  console.log('\nNext:');
  console.log('  1. Read AGENT_ONBOARDING.md once: that is what every AI will be told about working with you. Re-run this installer to change an answer.');
  console.log('     USER.md is yours to edit freely; the onboarding file is regenerated from .agent-personalizer.json.');
  console.log(level >= 3
    ? '  2. Re-render after editing: node render/render.js --dir .'
    : `  2. Re-render after editing by running this installer again (it keeps your files and only refreshes the rendered blocks):\n     npx github:aunysillyme/agent-personalizer --dir . --ai ${targets.join(',')} --level ${level} --yes`);
  if (level >= 2) console.log('  3. Read notes/README.md before letting an AI write into notes/.');
  if (level >= 3) console.log('  4. Register hooks/claude-code/session-start.sh (see hooks/README.md) and copy check/forbidden.example.txt to check/forbidden.local.txt.');
  if (level >= 4) console.log('  5. Level 4 is pointers only for now: routing, task bundles and verified CLI runs live in the multi-agent layer, linked from the README when it ships.');
  console.log('\nNothing here read an environment variable or wrote a secret.');
}

main().catch(e => { if (e && e.status !== undefined) process.exit(e.status || 1); console.error(e.message); process.exit(1); });
