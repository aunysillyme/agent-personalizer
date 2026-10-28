'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin/agent-personalizer.js');
const RENDER = path.join(ROOT, 'render/render.cjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'personalizer-core-'));
const home = path.join(scratch, 'home');
fs.mkdirSync(home);
const files = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'system-prompt.md'];
const titles = fs.readdirSync(path.join(ROOT, 'rules')).sort().filter(f => /^\d\d-.*\.md$/.test(f)).map(file => ({
  file, title: /^title: (.+)$/m.exec(fs.readFileSync(path.join(ROOT, 'rules', file), 'utf8'))[1],
  surfaces: /^surfaces: \[([^\]]+)\]/m.exec(fs.readFileSync(path.join(ROOT, 'rules', file), 'utf8'))[1].split(',').map(s => s.trim())
}));
const core = titles.filter(rule => /^(00|10|50|60|65)-/.test(rule.file));
function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout + r.stderr;
}
function install(dir, level, ai = 'claude,agents,gemini,prompt') {
  return run(CLI, ['--dir', dir, '--ai', ai, '--level', String(level), '--yes']);
}
function read(dir, rel) { return fs.readFileSync(path.join(dir, rel), 'utf8'); }
function expectRules(dir, rel, expected) {
  if (rel === 'system-prompt.md') expected = expected.filter(rule => rule.surfaces.includes('prompt'));
  const text = read(dir, rel);
  const headings = [...text.matchAll(/^### (.+)$/gm)].map(m => m[1]).filter(title => titles.some(rule => rule.title === title));
  assert.deepEqual(headings, expected.map(rule => rule.title), rel + ' rule headings');
  for (const rule of titles.filter(rule => !expected.includes(rule))) assert(!text.includes(rule.title), rel + ' contains excluded rule ' + rule.title);
}
function fixture(dir) {
  const saved = require('./fixtures/level1-083.json');
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(saved)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}
const cases = {
  'level-1-core-five'(dir) {
    install(dir, 1);
    for (const rel of files) expectRules(dir, rel, core);
    run(RENDER, ['--dir', dir, '--check']);
  },
  'level-2-core-five'(dir) {
    install(dir, 2);
    for (const rel of files) expectRules(dir, rel, core);
    run(RENDER, ['--dir', dir, '--check']);
  },
  'level-3-eleven-editable'(dir) {
    install(dir, 3);
    for (const rel of files) expectRules(dir, rel, titles);
    fs.appendFileSync(path.join(dir, 'rules/20-one-owner-per-rule.md'), '\nEDITABLE_LEVEL_THREE_RULE\n');
    run(RENDER, ['--dir', dir]);
    assert(read(dir, 'CLAUDE.md').includes('EDITABLE_LEVEL_THREE_RULE'));
    run(RENDER, ['--dir', dir, '--check']);
  },
  'upgrade-083-untouched'(dir) {
    fixture(dir);
    const before = read(dir, 'CLAUDE.md');
    assert(before.includes('### Sign every edit'), 'fixture must be an eleven-rule 0.8.3 install');
    install(dir, 1, 'claude');
    expectRules(dir, 'CLAUDE.md', core);
    assert(read(dir, 'CLAUDE.md').length < before.length, 'untouched old output shrinks');
    const cfg = JSON.parse(read(dir, '.agent-personalizer.json'));
    const crypto = require('node:crypto');
    assert.equal(cfg.installed['CLAUDE.md'], crypto.createHash('sha256').update(read(dir, 'CLAUDE.md')).digest('hex'), 'new output stays owned');
    run(RENDER, ['--dir', dir, '--check']);
  },
  'upgrade-083-user-bytes'(dir) {
    fixture(dir);
    const prefix = '# My own instructions\r\n', suffix = '\nKeep my café project note.\r\n';
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), prefix + read(dir, 'CLAUDE.md') + suffix);
    const before = read(dir, 'CLAUDE.md');
    install(dir, 1, 'claude');
    const after = read(dir, 'CLAUDE.md');
    assert.equal(after, before, 'edited older generated file stays byte for byte');
    install(dir, 1, 'claude');
    assert.equal(read(dir, 'CLAUDE.md'), before, 'edited file stays retained on later reruns');
    assert(after.startsWith(prefix) && after.endsWith(suffix), 'edited outer bytes stay byte for byte');
  }
};
let failed = 0;
try {
  for (const [name, test] of Object.entries(cases)) {
    if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
    const dir = path.join(scratch, name);
    try { test(dir); console.log('PASS core rules ' + name); }
    catch (error) { failed++; console.error('FAIL core rules ' + name + ': ' + error.message); }
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
