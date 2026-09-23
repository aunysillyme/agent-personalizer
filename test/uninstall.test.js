#!/usr/bin/env node
'use strict';

// Black-box deletion regressions. Every fixture stays inside the repository and is
// removed after its case. Run all cases, or pass one case name to reproduce it.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'agent-personalizer.js');
const SCRATCH = path.join(ROOT, '.test-work');
const CONFIG = '.agent-personalizer.json';
const BEGIN = '<!-- agent-personalizer:begin -->';
const END = '<!-- agent-personalizer:end -->';
const ALL = 'claude,agents,gemini,chatgpt,prompt';
fs.mkdirSync(SCRATCH, { recursive: true });

function run(args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', input });
  assert.ifError(r.error);
  return { code: r.status, output: r.stdout + r.stderr };
}
function code(r, want) {
  assert.equal(r.code, want, `expected exit ${want}, got ${r.code}: ${r.output.trim()}`);
}
function install(dir, level = 1, answers = {}, ais = ALL) {
  const r = run(['--dir', dir, '--ai', ais, '--level', String(level), '--answers', '-', '--yes'], JSON.stringify(answers));
  code(r, 0);
}
function uninstall(dir, ...flags) { return run(['--uninstall', '--dir', dir, ...flags]); }
function read(dir, rel) { return fs.readFileSync(path.join(dir, rel)); }
function write(dir, rel, value) { fs.writeFileSync(path.join(dir, rel), value); }
function exists(dir, rel) { return fs.existsSync(path.join(dir, rel)); }
function named(r, rel) { assert.ok(r.output.includes(rel), `output must name ${rel}: ${r.output.trim()}`); }
function kept(r, dir, rel, before) {
  assert.deepEqual(read(dir, rel), before, `${rel} must keep every byte`);
  named(r, rel);
  assert.ok(exists(dir, CONFIG), `config must remain while tracked ${rel} remains`);
}
function snapshot(dir) {
  const result = {};
  function visit(base, rel = '') {
    for (const name of fs.readdirSync(base).sort()) {
      const full = path.join(base, name), key = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) result[key] = { link: fs.readlinkSync(full) };
      else if (st.isDirectory()) { result[key] = { directory: true, mode: st.mode }; visit(full, key); }
      else result[key] = { bytes: fs.readFileSync(full).toString('base64'), mode: st.mode, mtime: st.mtimeMs };
    }
  }
  visit(dir);
  return result;
}
function refusedUnchanged(dir, name, match, outside) {
  const before = snapshot(dir), outsideBefore = outside && snapshot(outside);
  const r = uninstall(dir);
  code(r, 2);
  named(r, name);
  assert.match(r.output, match);
  assert.deepEqual(snapshot(dir), before, 'a refused uninstall must change nothing in the install');
  if (outside) assert.deepEqual(snapshot(outside), outsideBefore, 'outside files must stay unchanged');
}
function config(dir, edit) {
  const value = JSON.parse(read(dir, CONFIG));
  edit(value);
  write(dir, CONFIG, JSON.stringify(value, null, 2) + '\n');
}
// A private copy of the parts of THIS package an install needs, so a case can mutate the
// PACKAGE's own sources (simulating a later release) without touching the real repository.
// Everything --level 3 reads: bin/, render/, rules/, templates/, check/, hooks/, package.json.
const PKG_PARTS = ['bin', 'render', 'rules', 'templates', 'check', 'hooks'];
function copyPackage(dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of PKG_PARTS) fs.cpSync(path.join(ROOT, name), path.join(dst, name), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dst, 'package.json'));
  return path.join(dst, 'bin', 'agent-personalizer.js');
}
function runCli(cli, args, input) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input });
  assert.ifError(r.error);
  return { code: r.status, output: r.stdout + r.stderr };
}

const cases = {
  'clean-levels'(root) {
    for (const level of [1, 2, 3]) {
      const dir = path.join(root, `level-${level}`);
      fs.mkdirSync(dir);
      install(dir, level);
      const r = uninstall(dir);
      code(r, 0);
      assert.deepEqual(fs.readdirSync(dir), [], `clean level ${level} leaves an empty directory`);
      if (level === 3) { assert.match(r.output, /settings/i); assert.match(r.output, /hook|SessionStart/); }
    }
  },
  'edited-home'(dir) {
    install(dir);
    fs.appendFileSync(path.join(dir, 'CLAUDE.md'), '\nKeep my added project instruction.\n');
    const before = read(dir, 'CLAUDE.md'), r = uninstall(dir);
    code(r, 0);
    kept(r, dir, 'CLAUDE.md', before);
  },
  'preexisting-home'(dir) {
    const user = Buffer.from('# Project instructions\r\nKeep this café line.\r\n');
    write(dir, 'CLAUDE.md', user);
    install(dir);
    const installed = read(dir, 'CLAUDE.md');
    assert.deepEqual(installed.subarray(0, user.length), user, 'setup preserves the original prefix');
    const begin = installed.indexOf(BEGIN), end = installed.indexOf(END) + Buffer.byteLength(END);
    assert.ok(begin >= user.length && end > begin, 'setup contains the inserted block');
    const expected = Buffer.concat([installed.subarray(0, begin), installed.subarray(end)]);
    const r = uninstall(dir);
    code(r, 0);
    assert.deepEqual(read(dir, 'CLAUDE.md'), expected, 'only the marker block is removed; outside bytes stay exact');
    assert.ok(!read(dir, 'CLAUDE.md').includes(Buffer.from(BEGIN)));
    named(r, 'CLAUDE.md');
  },
  'preserved-home-rerun'(dir) {
    write(dir, 'CLAUDE.md', '# Existing project instructions\nKeep my own policy.\n');
    install(dir, 1);
    install(dir, 3);
    const installed = read(dir, 'CLAUDE.md');
    const begin = installed.indexOf(BEGIN), end = installed.indexOf(END) + Buffer.byteLength(END);
    const expected = Buffer.concat([installed.subarray(0, begin), installed.subarray(end)]);
    const r = uninstall(dir);
    code(r, 0);
    assert.deepEqual(read(dir, 'CLAUDE.md'), expected, 'reinstall preserves the original home ownership');
  },
  'owned-home-rerun'(dir) {
    install(dir, 1);
    install(dir, 3);
    install(dir, 1);
    const r = uninstall(dir);
    code(r, 0);
    assert.deepEqual(fs.readdirSync(dir), [], 'reinstall keeps package-created home ownership and highest installed level');
  },
  'user-note'(dir) {
    install(dir, 2);
    const note = Buffer.from('# My session\nKeep my own notes.\n');
    write(dir, 'notes/sessions/my-week.md', note);
    const r = uninstall(dir);
    code(r, 0);
    assert.deepEqual(read(dir, 'notes/sessions/my-week.md'), note);
    assert.ok(fs.statSync(path.join(dir, 'notes/sessions')).isDirectory());
    assert.ok(!exists(dir, 'notes/sessions/TEMPLATE-week.md'), 'unchanged session template is removed');
  },
  'tracked-symlink'(root) {
    const dir = path.join(root, 'install'), outside = path.join(root, 'outside');
    fs.mkdirSync(dir); fs.mkdirSync(outside);
    install(dir, 3);
    write(outside, 'victim.md', 'OUTSIDE USER DATA\n');
    fs.unlinkSync(path.join(dir, 'CLAUDE.md'));
    fs.symlinkSync(path.join(outside, 'victim.md'), path.join(dir, 'CLAUDE.md'));
    refusedUnchanged(dir, 'CLAUDE.md', /symlink/i, outside);
  },
  'dry-run'(dir) {
    install(dir, 3);
    const before = snapshot(dir), r = uninstall(dir, '--dry');
    code(r, 0);
    named(r, 'CLAUDE.md'); named(r, CONFIG);
    assert.match(r.output, /dry|preview|would/i);
    assert.deepEqual(snapshot(dir), before, '--dry preserves contents, modes and file timestamps');
  },
  'missing-config'(dir) {
    write(dir, 'mine.md', 'Keep this\n');
    const before = snapshot(dir), r = uninstall(dir);
    code(r, 2);
    named(r, path.join(dir, CONFIG));
    assert.deepEqual(snapshot(dir), before);
  },
  'edited-rendered-block'(dir) {
    install(dir);
    for (const rel of ['CLAUDE.md', 'GEMINI.md', 'AGENT_ONBOARDING.md']) {
      const text = read(dir, rel).toString().replace(BEGIN, BEGIN + '\nMy hand-edited block line.');
      write(dir, rel, text);
    }
    const before = Object.fromEntries(['CLAUDE.md', 'GEMINI.md', 'AGENT_ONBOARDING.md'].map(rel => [rel, read(dir, rel)]));
    const r = uninstall(dir);
    code(r, 0);
    for (const [rel, bytes] of Object.entries(before)) kept(r, dir, rel, bytes);
  },
  'edited-profile-and-box'(dir) {
    install(dir);
    for (const rel of ['USER.md', 'chatgpt-box1.txt']) fs.appendFileSync(path.join(dir, rel), '\nMy own addition.\n');
    const before = Object.fromEntries(['USER.md', 'chatgpt-box1.txt'].map(rel => [rel, read(dir, rel)]));
    const r = uninstall(dir);
    code(r, 0);
    for (const [rel, bytes] of Object.entries(before)) kept(r, dir, rel, bytes);
  },
  'edited-scaffold-rule-hook'(dir) {
    install(dir, 3);
    const names = ['notes/README.md', 'notes/decisions.md', 'rules/50-output-style.md', 'hooks/claude-code/session-start.sh'];
    for (const rel of names) fs.appendFileSync(path.join(dir, rel), '\n# My own addition.\n');
    const before = Object.fromEntries(names.map(rel => [rel, read(dir, rel)]));
    const r = uninstall(dir);
    code(r, 0);
    for (const [rel, bytes] of Object.entries(before)) kept(r, dir, rel, bytes);
    assert.match(r.output, /settings/i);
  },
  'current-rule-render'(dir) {
    install(dir, 3);
    const rel = 'rules/50-output-style.md';
    const text = read(dir, rel).toString().replace('## universal\n', '## universal\nGive the local project summary first.\n');
    write(dir, rel, text);
    const rendered = spawnSync(process.execPath, [path.join(ROOT, 'render/render.cjs'), '--dir', dir], { cwd: ROOT, encoding: 'utf8' });
    assert.ifError(rendered.error);
    assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
    const r = uninstall(dir);
    code(r, 0);
    kept(r, dir, rel, Buffer.from(text));
    for (const name of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'system-prompt.md']) {
      assert.ok(!exists(dir, name), `${name} matches the current local sources and is removed`);
    }
  },
  'config-symlink'(root) {
    const dir = path.join(root, 'install'), outside = path.join(root, 'outside');
    fs.mkdirSync(dir); fs.mkdirSync(outside);
    install(dir);
    fs.renameSync(path.join(dir, CONFIG), path.join(outside, CONFIG));
    fs.symlinkSync(path.join(outside, CONFIG), path.join(dir, CONFIG));
    refusedUnchanged(dir, CONFIG, /symlink/i, outside);
  },
  'directory-symlink'(root) {
    const dir = path.join(root, 'install'), outside = path.join(root, 'outside');
    fs.mkdirSync(dir); fs.mkdirSync(outside);
    install(dir, 3);
    fs.renameSync(path.join(dir, 'notes'), path.join(outside, 'notes'));
    fs.symlinkSync(path.join(outside, 'notes'), path.join(dir, 'notes'));
    refusedUnchanged(dir, 'notes', /symlink/i, outside);
  },
  'source-symlink'(root) {
    const dir = path.join(root, 'install'), outside = path.join(root, 'outside');
    fs.mkdirSync(dir); fs.mkdirSync(outside);
    install(dir, 3);
    const rel = 'rules/50-output-style.md';
    fs.renameSync(path.join(dir, rel), path.join(outside, 'rule.md'));
    fs.symlinkSync(path.join(outside, 'rule.md'), path.join(dir, rel));
    refusedUnchanged(dir, rel, /symlink/i, outside);
  },
  'path-traversal'(root) {
    const dir = path.join(root, 'install'), outside = path.join(root, 'outside');
    fs.mkdirSync(dir); fs.mkdirSync(outside);
    install(dir, 2);
    write(outside, 'README.md', 'USER DATA\n');
    config(dir, value => { value.onboarding.notes_path = '../outside'; });
    refusedUnchanged(dir, 'notes_path', /relative|path|outside/i, outside);
  },
  'invalid-config'(root) {
    const variants = ['{broken', 'null', '[]', '{"targets":["../outside"],"level":1}', '{"targets":["claude"],"level":99}', '{"targets":["claude"],"onboarding":{"unknown":"value"},"level":1}'];
    for (const [i, text] of variants.entries()) {
      const dir = path.join(root, `config-${i}`);
      fs.mkdirSync(dir); install(dir); write(dir, CONFIG, text);
      refusedUnchanged(dir, CONFIG, /JSON|object|target|level|answer|unknown/i);
    }
  },
  'malformed-marker'(dir) {
    install(dir, 3);
    write(dir, 'AGENTS.md', `# Keep this\n${BEGIN}\nMissing end marker\n`);
    refusedUnchanged(dir, 'AGENTS.md', /marker|malformed/i);
  },
  'legacy-config'(root) {
    for (const edited of [false, true]) {
      const dir = path.join(root, edited ? 'edited' : 'clean');
      fs.mkdirSync(dir); install(dir, 3);
      config(dir, value => { delete value.preservedTargets; });
      if (edited) fs.appendFileSync(path.join(dir, 'CLAUDE.md'), '\nMy own legacy instruction.\n');
      const before = read(dir, 'CLAUDE.md'), r = uninstall(dir);
      code(r, 0);
      if (edited) kept(r, dir, 'CLAUDE.md', before);
      else assert.deepEqual(fs.readdirSync(dir), [], 'legacy config removes exact generated files');
    }
  },
  'answer-variants'(root) {
    const variants = [
      { signature: 'no', notes_path: 'workspace/my notes' },
      { notes_tool: 'notion', notes_path: 'Studio Wiki' },
      { notes_tool: 'onenote', notes_path: 'Work Notebook' }
    ];
    for (const [i, answers] of variants.entries()) {
      const dir = path.join(root, `answers-${i}`);
      fs.mkdirSync(dir); install(dir, 3, answers);
      const r = uninstall(dir);
      code(r, 0);
      assert.deepEqual(fs.readdirSync(dir), [], `answer variant ${i} leaves an empty directory`);
    }
  },
  'help'() {
    const r = run(['--help']);
    code(r, 0);
    assert.match(r.output, /--uninstall/);
    assert.match(r.output, /--dry/);
  },
  // Regression for the MEDIUM finding in the code-reviewer audit of the --uninstall feature:
  // installPlan() and the uninstall recipe used to rebuild "what install would have written"
  // from whatever package version happens to be running at removal time, so any later release
  // of this very package (a normal `npx agent-personalizer --uninstall` with no version pin)
  // made every untouched level-3 file it changed read as "edited" and get kept forever.
  'version-drift'(root) {
    const pkg = path.join(root, 'pkg');
    const cli = copyPackage(pkg);
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    code(runCli(cli, ['--dir', target, '--ai', 'claude,agents', '--level', '3', '--answers', '-', '--yes'], '{}'), 0);

    // Install must have recorded a hash for the file the reproduction targets.
    const cfg = JSON.parse(read(target, CONFIG));
    assert.ok(cfg.installed && cfg.installed['rules/50-output-style.md'], 'install must record a hash for a tracked rules/ file');

    // An actual edit made INSIDE the installed folder must still be recognized and kept,
    // hash-based comparison or not.
    fs.appendFileSync(path.join(target, 'notes', 'decisions.md'), '\nMy own decision.\n');
    const editedBefore = read(target, 'notes/decisions.md');

    // Simulate a later release of the PACKAGE ITSELF: nothing in `target` changes, only the
    // package version that would now run `--uninstall` does (here: one rule file's content).
    fs.appendFileSync(path.join(pkg, 'rules', '50-output-style.md'), '\n<!-- a later release of this package -->\n');

    const r = runCli(cli, ['--uninstall', '--dir', target, '--dry']);
    code(r, 0);
    assert.match(r.output, /would remove rules\/50-output-style\.md/, `an untouched file must not read as edited after the package moves on: ${r.output.trim()}`);
    assert.doesNotMatch(r.output, /kept {3}rules\/50-output-style\.md/, `must not fall back to comparing against the now-different live package: ${r.output.trim()}`);
    assert.match(r.output, /kept {3}notes\/decisions\.md \(edited\)/, `an actually edited file must still be kept: ${r.output.trim()}`);
    assert.deepEqual(read(target, 'notes/decisions.md'), editedBefore, 'a dry run changes nothing');

    // Legacy fallback: a config saved before this field existed (0.5.x or earlier) has no
    // "installed" entry to compare against, so it falls back to the older, over-retaining
    // comparison exactly as before, for that path only.
    delete cfg.installed;
    write(target, CONFIG, JSON.stringify(cfg, null, 2) + '\n');
    const legacy = runCli(cli, ['--uninstall', '--dir', target, '--dry']);
    code(legacy, 0);
    assert.match(legacy.output, /kept {3}rules\/50-output-style\.md \(edited\)/, `without a recorded hash, the fallback must read the drifted file as edited: ${legacy.output.trim()}`);
  }
};

const selected = process.argv.slice(2);
if (selected.some(name => !Object.hasOwn(cases, name))) {
  console.error('Unknown case. Available: ' + Object.keys(cases).join(', '));
  process.exit(2);
}
let passed = 0, failed = 0;
for (const name of selected.length ? selected : Object.keys(cases)) {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'uninstall-test-'));
  try { cases[name](dir); console.log(`PASS uninstall ${name}`); passed++; }
  catch (e) { console.log(`FAIL uninstall ${name}: ${e.message.split('\n')[0]}`); failed++; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
console.log(`uninstall: ${passed} passed, ${failed} failed, 0 skipped`);
process.exitCode = failed ? 1 : 0;
