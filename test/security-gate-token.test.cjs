'use strict';
// P_TOKEN needs a non-identifier boundary before the prefix: ordinary words that end in "sk" must not
// be flagged, while a token-shaped string standing alone, after a space or after a quote still is.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-token-'));
try {
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, 'synthetic-unused-term\n');
  let n = 0;
  // Private classes run under --history, so each scan commits the text into a fresh repo.
  const scan = (text) => {
    const repo = path.join(tmp, 'repo' + (n++)); fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(repo, 'f.txt'), text + '\n');
    git('add', '.'); git('commit', '-qm', 'fixture');
    return spawnSync(process.execPath, [path.join(root, 'check/gate.cjs'), '--dir', repo, '--list', list, '--history'], { encoding: 'utf8' });
  };
  const body = 'x'.repeat(24);
  const shapes = {
    openai: 's' + 'k-' + body,
    openaiProj: 's' + 'k-proj-' + body,
    github: 'gh' + 'p_' + body,
    npm: 'np' + 'm_' + body,
    aws: 'AK' + 'IA' + 'A'.repeat(16),
    slack: 'xo' + 'xb-' + body,
    google: 'AI' + 'za' + 'x'.repeat(30)
  };
  const word = 'ask-when-it-changes-the-build';
  let r = scan('Decision: ' + word + ' and also task-' + body + ' and disk_' + 'npm_' + body);
  assert.equal(r.status, 0, 'ordinary words must not be flagged: ' + r.stdout + r.stderr);
  for (const [name, tok] of Object.entries(shapes)) {
    for (const [where, text] of [['alone', tok], ['after a space', 'key ' + tok], ['after a quote', 'key="' + tok + '"']]) {
      r = scan(text);
      assert.equal(r.status, 1, name + ' ' + where + ' must be flagged: ' + r.stdout + r.stderr);
      assert.match(r.stdout, /P_TOKEN/, name + ' ' + where);
      assert(!r.stdout.includes(tok), name + ' value must not be printed');
    }
  }
  console.log('PASS security: P_TOKEN ignores ordinary words and still flags token shapes at a boundary');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
