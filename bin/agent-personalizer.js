#!/usr/bin/env node
'use strict';
/*
  agent-personalizer installer.

    npx github:aunysillyme/agent-personalizer [--dir <folder>] [--ai claude,agents,gemini,chatgpt,prompt] [--level 1|2|3|4] [--yes]

  Interactive when flags are missing and stdin is a terminal. Non-interactive with flags.
  Writes only the files for the chosen AIs and level. Never overwrites a file that exists
  (except the marker block inside rendered files). Reads no environment variables.
  Writes no secrets.
*/
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const PKG = path.resolve(__dirname, '..');
const AIS = ['claude', 'agents', 'gemini', 'chatgpt', 'prompt'];
const AI_LABEL = { claude: 'Claude (Claude Code, Claude apps)', agents: 'Codex / Cursor / anything that reads AGENTS.md', gemini: 'Gemini', chatgpt: 'ChatGPT custom instructions', prompt: 'a plain system prompt (shareable, no profile)' };

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

async function ask(q, dflt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise(res => rl.question(`${q}${dflt ? ` [${dflt}]` : ''}: `, res));
  rl.close();
  return (a || dflt || '').trim();
}

function copyIfAbsent(src, dst) {
  if (fs.existsSync(dst)) { console.log(`kept   ${path.relative(process.cwd(), dst)} (exists)`); return false; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`wrote  ${path.relative(process.cwd(), dst)}`);
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
  if (!dir || !ais || !level) {
    console.error('Non-interactive run needs --dir, --ai and --level (and --yes).');
    process.exit(2);
  }
  dir = path.resolve(String(dir));
  const targets = String(ais).split(',').map(s => s.trim()).filter(Boolean);
  const bad = targets.filter(t => !AIS.includes(t));
  if (bad.length) { console.error(`unknown AI: ${bad.join(', ')} (known: ${AIS.join(', ')})`); process.exit(2); }
  level = parseInt(String(level), 10);
  if (!(level >= 1 && level <= 4)) { console.error('level must be 1, 2, 3 or 4'); process.exit(2); }

  fs.mkdirSync(dir, { recursive: true });
  console.log(`\nInstalling level ${level} for ${targets.join(', ')} into ${dir}\n`);

  // Level 1: profile, home files, the rule source they render from.
  copyIfAbsent(path.join(PKG, 'templates', 'USER.md'), path.join(dir, 'USER.md'));
  for (const f of fs.readdirSync(path.join(PKG, 'rules'))) copyIfAbsent(path.join(PKG, 'rules', f), path.join(dir, 'rules', f));
  if (targets.includes('claude')) copyIfAbsent(path.join(PKG, 'templates', 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
  if (targets.includes('agents')) copyIfAbsent(path.join(PKG, 'templates', 'AGENTS.md'), path.join(dir, 'AGENTS.md'));

  // Level 2: the notes folder and its contracts.
  if (level >= 2) {
    copyIfAbsent(path.join(PKG, 'templates', 'FOLDER_README.md'), path.join(dir, 'notes', 'README.md'));
    copyIfAbsent(path.join(PKG, 'templates', 'session-log.md'), path.join(dir, 'notes', 'sessions', 'TEMPLATE-week.md'));
    copyIfAbsent(path.join(PKG, 'templates', 'decisions-log.md'), path.join(dir, 'notes', 'decisions.md'));
    copyIfAbsent(path.join(PKG, 'templates', 'INBOX_README.md'), path.join(dir, 'notes', 'inbox', 'README.md'));
  }

  // Level 3: renderer, hook, gate, and a config so `check` knows the targets.
  if (level >= 3) {
    copyIfAbsent(path.join(PKG, 'render', 'render.js'), path.join(dir, 'render', 'render.js'));
    copyIfAbsent(path.join(PKG, 'render', 'targets.json'), path.join(dir, 'render', 'targets.json'));
    copyIfAbsent(path.join(PKG, 'hooks', 'README.md'), path.join(dir, 'hooks', 'README.md'));
    copyIfAbsent(path.join(PKG, 'hooks', 'claude-code', 'session-start.sh'), path.join(dir, 'hooks', 'claude-code', 'session-start.sh'));
    copyIfAbsent(path.join(PKG, 'check', 'gate.js'), path.join(dir, 'check', 'gate.js'));
    copyIfAbsent(path.join(PKG, 'check', 'forbidden.example.txt'), path.join(dir, 'check', 'forbidden.example.txt'));
    try { fs.chmodSync(path.join(dir, 'hooks', 'claude-code', 'session-start.sh'), 0o755); } catch (_) {}
  }
  const cfg = path.join(dir, '.agent-personalizer.json');
  if (!fs.existsSync(cfg)) { fs.writeFileSync(cfg, JSON.stringify({ targets, level }, null, 2) + '\n'); console.log('wrote  .agent-personalizer.json'); }

  // Render the chosen targets, always from the package's renderer (level 1 and 2 do not keep a copy).
  execFileSync(process.execPath, [path.join(PKG, 'render', 'render.js'), '--dir', dir, '--targets', targets.join(',')], { stdio: 'inherit' });

  console.log('\nNext:');
  console.log('  1. Open USER.md and replace every line in parentheses.');
  console.log(`  2. Re-render after editing: node ${level >= 3 ? 'render/render.js' : path.relative(dir, path.join(PKG, 'render', 'render.js'))} --dir .`);
  if (level >= 2) console.log('  3. Read notes/README.md before letting an AI write into notes/.');
  if (level >= 3) console.log('  4. Register hooks/claude-code/session-start.sh (see hooks/README.md) and copy check/forbidden.example.txt to check/forbidden.local.txt.');
  if (level >= 4) console.log('  5. Level 4 is pointers only for now: routing, task bundles and verified CLI runs live in the multi-agent layer, linked from the README when it ships.');
  console.log('\nNothing here read an environment variable or wrote a secret.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
