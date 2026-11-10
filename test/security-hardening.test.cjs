'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-history-'));
try {
  const repo = path.join(tmp, 'repo'); fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  const term = ['synthetic', 'confidential', 'marker'].join('-');
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, term + '\n');
  fs.writeFileSync(path.join(repo, 'removed.txt'), term + '\n');
  git('add', '.'); git('commit', '-qm', 'fixture ' + term);
  git('rm', '-q', 'removed.txt'); git('commit', '-qm', 'remove fixture');
  git('tag', 'fixture-' + term);
  const result = spawnSync(process.execPath, [path.join(root, 'check/gate.cjs'), '--dir', repo, '--list', list, '--history'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /history:[0-9a-f]+:blob:1\s+P_LIST/);
  assert.match(result.stdout, /history:[0-9a-f]+:message:1\s+P_LIST/);
  assert.match(result.stdout, /history:tag\s+P_LIST/);
  assert(!result.stdout.includes(term));
  const plain = spawnSync(process.execPath, [path.join(root, 'check/gate.cjs'), '--dir', repo, '--list', list], { encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  console.log('PASS security: deleted blob, commit message and tag are scanned without disclosing values');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
