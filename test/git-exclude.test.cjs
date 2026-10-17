#!/usr/bin/env node
'use strict';

// Inside a git repo, personal outputs go to .git/info/exclude and uninstall takes them back.
// Every fixture is a fresh repo in the system temp folder, removed at the end.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'agent-personalizer.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-git-exclude-')));
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env });
  assert.ifError(r.error);
  return { code: r.status, output: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
function cli(...args) { const r = sh(process.execPath, [CLI, ...args], ROOT); assert.equal(r.code, 0, r.output); return r.output; }
const install = (dir, ais = 'claude,agents') => cli('--dir', dir, '--ai', ais, '--level', '1', '--yes');
const uninstall = (dir, ...flags) => cli('--uninstall', '--dir', dir, ...flags);
function repo(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(sh('git', ['init', '-q'], dir).code, 0);
  return dir;
}
const exclude = top => fs.readFileSync(path.join(top, '.git', 'info', 'exclude'), 'utf8');
const untracked = top => sh('git', ['status', '--porcelain', '-z', '--untracked-files=all'], top).stdout.split('\0').filter(Boolean).map(l => l.slice(3));

const cases = {
  'repo-root'() {
    const top = repo('root');
    const before = exclude(top);
    const out = install(top);
    assert.match(out, /update \.git\/info\/exclude/);
    assert.match(out, /NOTE: CLAUDE\.md, AGENTS\.md/);
    const listed = untracked(top);
    for (const rel of ['USER.md', 'LEARNED.md', '.agent-personalizer.json']) assert.ok(!listed.includes(rel), `${rel} must not be committable: ${listed}`);
    for (const rel of ['CLAUDE.md', 'AGENTS.md']) assert.ok(listed.includes(rel), `${rel} stays committable`);
    const once = exclude(top);
    assert.match(install(top), /ok {5}\.git\/info\/exclude/, 'a re-run reports the exclude as current');
    assert.equal(exclude(top), once, 're-running adds nothing');
    install(top, 'claude,agents,chatgpt');
    for (const rel of ['chatgpt-custom-instructions.md', 'chatgpt-box1.txt', 'chatgpt-box2.txt']) assert.ok(!untracked(top).includes(rel), `${rel} is excluded after adding ChatGPT`);
    assert.equal(exclude(top).split('# agent-personalizer begin').length, 2, 'one block per install folder');
    const pre = exclude(top);
    assert.match(uninstall(top, '--dry'), /would update \.git\/info\/exclude/);
    assert.equal(exclude(top), pre, '--dry leaves the exclude file alone');
    assert.match(uninstall(top), /update \.git\/info\/exclude/);
    assert.equal(exclude(top), before, 'uninstall restores .git/info/exclude byte for byte');
  },
  'subfolders-and-escaping'() {
    const top = repo('nested');
    fs.writeFileSync(path.join(top, '.git', 'info', 'exclude'), 'my-own-pattern');
    const a = path.join(top, 'proj [a]*'), b = path.join(top, 'b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    install(a); install(b);
    const listed = untracked(top);
    for (const dir of ['proj [a]*', 'b']) {
      assert.ok(!listed.includes(`${dir}/USER.md`), `${dir}/USER.md is excluded: ${listed}`);
      assert.ok(listed.includes(`${dir}/CLAUDE.md`), `${dir}/CLAUDE.md stays committable`);
    }
    fs.writeFileSync(path.join(top, 'USER.md'), 'not ours\n');
    assert.ok(untracked(top).includes('USER.md'), 'patterns are anchored to the install folder');
    uninstall(a);
    assert.ok(!exclude(top).includes('proj'), 'the first folder block is gone');
    assert.ok(!untracked(top).includes('b/USER.md'), 'the other install keeps its block');
    uninstall(b);
    // A final newline had to be added before the block; it is the only byte that stays.
    assert.equal(exclude(top), 'my-own-pattern\n', 'the user line comes back, now newline-terminated');
  },
  'ignored-folder'() {
    const top = repo('ignored');
    fs.writeFileSync(path.join(top, '.gitignore'), 'private/\n');
    const dir = path.join(top, 'private');
    fs.mkdirSync(dir);
    const before = exclude(top), out = install(dir);
    assert.doesNotMatch(out, /info\/exclude|NOTE:/, 'an ignored folder needs nothing');
    assert.equal(exclude(top), before);
  },
  'not-a-repo'() {
    const dir = path.join(TMP, 'plain');
    fs.mkdirSync(dir);
    assert.doesNotMatch(install(dir), /info\/exclude|NOTE:|WARNING/, 'outside a repo nothing is said');
    uninstall(dir);
  },
  'kept-files-keep-block'() {
    const top = repo('kept');
    install(top);
    fs.appendFileSync(path.join(top, 'USER.md'), '\nMy own line.\n');
    const before = exclude(top);
    const out = uninstall(top);
    assert.match(out, /kept {3}USER\.md/);
    assert.equal(exclude(top), before, 'while a private file remains, its exclude block stays');
    assert.ok(!untracked(top).includes('USER.md'));
  },
  'already-tracked'() {
    const top = repo('tracked');
    fs.writeFileSync(path.join(top, 'USER.md'), '# committed earlier\n');
    sh('git', ['add', 'USER.md'], top); sh('git', ['commit', '-qm', 'seed'], top);
    assert.match(install(top), /WARNING: git already tracks USER\.md/);
  },
};

let failed = 0;
const pick = process.argv[2];
const probe = spawnSync('git', ['--version']);
if (probe.error || probe.status !== 0) { console.log('skip: git not on PATH; git-exclude cases NOT run (a skip, not a pass)'); process.exit(0); }
for (const [name, fn] of Object.entries(cases)) {
  if (pick && pick !== name) continue;
  try { fn(); console.log(`PASS git-exclude ${name}`); }
  catch (e) { failed++; console.log(`FAIL git-exclude ${name}: ${e.message}`); }
}
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
