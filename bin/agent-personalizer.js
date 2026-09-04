#!/usr/bin/env node
'use strict';
/*
  agent-personalizer installer.

    npx github:aunysillyme/agent-personalizer [--dir <folder>] [--ai claude,agents,gemini,chatgpt,prompt] [--level 1|2|3|4] [--yes]

  Interactive when flags are missing and stdin is a terminal. Non-interactive with flags.
  Writes only the files for the chosen AIs and level. Never overwrites a file that exists
  (except the marker block inside rendered files it owns). Refuses to write through any
  symlink or outside the install folder (the folder you name is followed once, via realpath;
  nothing beneath it may be a symlink). Reads no environment variables. Writes no secrets.

  exit codes: 0 ok · 1 unexpected error · 2 refused or invalid input
*/
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const PKG = path.resolve(__dirname, '..');
const AIS = ['claude', 'agents', 'gemini', 'chatgpt', 'prompt'];
const AI_LABEL = { claude: 'Claude (Claude Code, Claude apps)', agents: 'Codex / Cursor / anything that reads AGENTS.md', gemini: 'Gemini', chatgpt: 'ChatGPT custom instructions', prompt: 'a plain system prompt (shareable, no profile)' };

function die(msg) { console.error(`agent-personalizer: ${msg}`); process.exit(2); }

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  if (v === undefined || v === '' || v.startsWith('--')) die(`${name} needs a non-empty value`);
  return v;
}

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
  const interactive = process.stdin.isTTY && !process.argv.includes('--yes');
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
  console.log(`\nInstalling level ${level} for ${targets.join(', ')} into ${root}\n`);

  // Level 1: profile, home files, the rule source they render from.
  copyIfAbsent(path.join(PKG, 'templates', 'USER.md'), root, 'USER.md');
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
  const { full: cfg, exists: cfgExists } = safeDest(root, '.agent-personalizer.json');
  if (!cfgExists) { fs.writeFileSync(cfg, JSON.stringify({ targets, level }, null, 2) + '\n', { flag: 'wx' }); console.log('wrote  .agent-personalizer.json'); }

  // Render the chosen targets, always from the package's renderer (level 1 and 2 keep no copy).
  execFileSync(process.execPath, [path.join(PKG, 'render', 'render.js'), '--dir', root, '--targets', targets.join(',')], { stdio: 'inherit' });

  console.log('\nNext:');
  console.log('  1. Open USER.md and replace every line in parentheses.');
  console.log(`  2. Re-render after editing: node ${level >= 3 ? 'render/render.js' : path.relative(root, path.join(PKG, 'render', 'render.js'))} --dir .`);
  if (level >= 2) console.log('  3. Read notes/README.md before letting an AI write into notes/.');
  if (level >= 3) console.log('  4. Register hooks/claude-code/session-start.sh (see hooks/README.md) and copy check/forbidden.example.txt to check/forbidden.local.txt.');
  if (level >= 4) console.log('  5. Level 4 is pointers only for now: routing, task bundles and verified CLI runs live in the multi-agent layer, linked from the README when it ships.');
  console.log('\nNothing here read an environment variable or wrote a secret.');
}

main().catch(e => { if (e && e.status !== undefined) process.exit(e.status || 1); console.error(e.message); process.exit(1); });
