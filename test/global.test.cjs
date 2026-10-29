'use strict';
// Every global journey stays inside an invented HOME, including the session history.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/agent-personalizer.js');
const temp = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'apg-'));
const begin = '<!-- agent-personalizer:begin -->';
const end = '<!-- agent-personalizer:end -->';
const targets = ['.claude/CLAUDE.md', '.codex/AGENTS.md', '.gemini/GEMINI.md'];
const install = ['--global', '--ai', 'claude,agents,gemini', '--yes'];
function home(name) {
  const folder = path.join(temp, name);
  fs.mkdirSync(folder);
  return folder;
}
function write(folder, rel, bytes) {
  const file = path.join(folder, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}
function run(folder, args, expected = 0, extra = {}) {
  const out = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    env: { ...process.env, HOME: folder, USERPROFILE: folder, ...extra } });
  assert.equal(out.status, expected, `${args.join(' ')}\n${out.stdout}${out.stderr}`);
  return out.stdout + out.stderr;
}
function snapshot(folder) {
  const result = {};
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) result[rel] = { link: fs.readlinkSync(file) };
      else if (stat.isDirectory()) { result[rel] = { directory: true }; walk(file, rel); }
      else result[rel] = { sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mode: stat.mode & 0o777 };
    }
  }
  walk(folder);
  return result;
}
try {
  const fresh = home('fresh');
  run(fresh, install);
  for (const rel of targets) {
    const text = fs.readFileSync(path.join(fresh, rel), 'utf8');
    assert.equal(text.split(begin).length, 2, `${rel}: exactly one marked block`);
    assert.equal(text.split(end).length, 2, `${rel}: exactly one closing marker`);
    assert(text.includes(path.join(fs.realpathSync(fresh), '.agent-personalizer', 'USER.md')), 'Global profile pointers work from every project.');
    assert(text.includes('npx agent-personalizer --global'), 'Learning re-renders the global profile.');
  }
  for (const rel of ['USER.md', 'LEARNED.md', '.agent-personalizer.json']) assert(fs.existsSync(path.join(fresh, '.agent-personalizer', rel)), rel);
  const cfg = JSON.parse(fs.readFileSync(path.join(fresh, '.agent-personalizer/.agent-personalizer.json')));
  assert.equal(cfg.level, 1);
  const first = snapshot(fresh);
  run(fresh, ['--global']);
  assert.deepEqual(snapshot(fresh), first, 'Global re-run is byte-idempotent.');
  run(fresh, ['--global', '--uninstall']);
  for (const rel of targets) assert(!fs.existsSync(path.join(fresh, rel)), `${rel}: fresh owned target removed`);
  for (const rel of ['USER.md', 'LEARNED.md', '.agent-personalizer.json']) assert(!fs.existsSync(path.join(fresh, '.agent-personalizer', rel)), `${rel}: fresh source removed`);
  console.log('ok: global fresh three-target install, level-1 source, idempotent re-run and uninstall');

  const preserved = home('preserved');
  const above = '\ufeff# Existing instructions\r\nKeep these bytes.\r\n';
  const below = '\r\n# More instructions\r\nNo final newline';
  run(preserved, ['--global', '--ai', 'claude', '--yes']);
  const owned = fs.readFileSync(path.join(preserved, targets[0]), 'utf8');
  write(preserved, targets[0], above + owned.replace(/\n/g, '\r\n') + below);
  run(preserved, ['--global', '--ai', 'claude', '--yes']);
  const written = fs.readFileSync(path.join(preserved, targets[0]));
  assert(written.subarray(0, Buffer.byteLength(above)).equals(Buffer.from(above)), 'BOM and CRLF above the marker stay exact.');
  assert(written.subarray(-Buffer.byteLength(below)).equals(Buffer.from(below)), 'User bytes below the marker and missing final newline stay exact.');
  const afterInstall = snapshot(preserved);
  run(preserved, ['--global']);
  assert.deepEqual(snapshot(preserved), afterInstall, 'Re-rendering mixed line endings is idempotent.');
  run(preserved, ['--global', '--uninstall']);
  assert(fs.readFileSync(path.join(preserved, targets[0])).equals(Buffer.from(above + below)), 'Uninstall removes only the marked block and its own marker lines.');
  console.log('ok: global preserves user bytes above and below markers, BOM, CRLF and no final newline');

  const unmarked = home('unmarked');
  const original = Buffer.from('\ufeff# User instructions\r\nNo final newline');
  write(unmarked, targets[0], original);
  run(unmarked, ['--global', '--ai', 'claude', '--level', '1', '--yes']);
  assert(fs.readFileSync(path.join(unmarked, targets[0])).subarray(0, original.length).equals(original));
  run(unmarked, ['--global', '--uninstall']);
  assert(fs.readFileSync(path.join(unmarked, targets[0])).equals(original), 'Uninstall restores an unmarked original without an added final newline.');
  console.log('ok: global unmarked original is restored byte for byte');

  for (const kind of ['target', 'parent']) {
    const linked = home(`linked-${kind}`);
    const outside = home(`outside-${kind}`);
    const outsideFile = write(outside, 'AGENTS.md', 'Outside instructions stay unchanged.\n');
    if (kind === 'target') {
      fs.mkdirSync(path.join(linked, '.codex'));
      fs.symlinkSync(outsideFile, path.join(linked, targets[1]));
    } else fs.symlinkSync(outside, path.join(linked, '.codex'));
    const before = snapshot(linked), outsideBefore = snapshot(outside);
    assert.match(run(linked, install, 2), /symlink/i);
    assert.deepEqual(snapshot(linked), before, `${kind} symlink refusal writes nothing.`);
    assert.deepEqual(snapshot(outside), outsideBefore, `${kind} symlink destination stays unchanged.`);
  }
  console.log('ok: global target and parent symlinks refuse before any writes');

  const rollback = home('rollback');
  write(rollback, targets[0], 'First target original\r\n');
  write(rollback, targets[1], 'Second target original without newline');
  fs.chmodSync(path.join(rollback, targets[0]), 0o640);
  const beforeFailure = snapshot(rollback);
  const fault = path.join(temp, 'rename-fault.cjs');
  fs.writeFileSync(fault, `const fs = require('node:fs'); const path = require('node:path');
const rename = fs.renameSync; let failed = false;
const home = fs.realpathSync(process.env.HOME);
fs.renameSync = function(from, to) {
  if (!failed && to === path.join(home, '.codex', 'AGENTS.md')) {
    failed = true; throw new Error('injected second global target rename failure');
  }
  return rename.apply(this, arguments);
};
`);
  const failed = spawnSync(process.execPath, [cli, ...install], { cwd: root, encoding: 'utf8',
    env: { ...process.env, HOME: rollback, USERPROFILE: rollback, NODE_OPTIONS: `--require ${fault}` } });
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
  assert.match(failed.stdout + failed.stderr, /injected second global target rename failure/);
  assert.deepEqual(snapshot(rollback), beforeFailure, 'Second-target failure restores the first, file mode, source files and created directories.');
  console.log('ok: global second-target rename failure rolls back targets and profile source tree');

  for (const args of [['--global', '--ai', 'chatgpt', '--yes'], ['--global', '--ai', 'prompt', '--yes'],
    ['--global', '--dir', '.', '--ai', 'claude', '--yes'], ['--global', '--ai', 'claude', '--level', '2', '--yes'],
    ['--global', '--ai', 'claude', '--level', '3', '--yes']]) {
    const rejected = home(`invalid-${fs.readdirSync(temp).length}`);
    const message = run(rejected, args, 2);
    assert.match(message, /global/i);
    assert.deepEqual(snapshot(rejected), {}, 'Invalid global option combinations write nothing.');
  }
  console.log('ok: global refuses unsupported targets, --dir and levels 2/3');

  const learning = home('learning');
  run(learning, ['--global', '--ai', 'claude', '--yes']);
  const otherProject = path.join(temp, 'other-project');
  const slug = otherProject.replace(/[:\\/]/g, '-');
  const session = write(learning, `.claude/projects/${slug}/typed.jsonl`, JSON.stringify({ type: 'user', cwd: otherProject, message: { content: 'GLOBAL_OTHER_PROJECT_TYPED keep examples concise.' } }) + '\n');
  const log = path.join(temp, 'history-reads');
  const logger = path.join(temp, 'history-preload.cjs');
  fs.writeFileSync(logger, `const fs = require('node:fs'); const path = require('node:path');
const history = path.join(process.env.HOME, '.claude', 'projects');
for (const name of ['open', 'readdir']) { const original = fs.promises[name]; fs.promises[name] = function(file, ...args) {
  if (typeof file === 'string' && (file === history || file.startsWith(history + path.sep))) fs.appendFileSync(process.env.AP_GLOBAL_READ_LOG, file + '\\n');
  return original.call(this, file, ...args);
}; }
`);
  const consentEnv = { NODE_OPTIONS: `--require ${logger}`, AP_GLOBAL_READ_LOG: log };
  run(learning, ['learn', '--global'], 2, consentEnv);
  assert(!fs.existsSync(log), 'Session history is not read without consent.');
  const digest = path.join(learning, '.agent-personalizer/.agent-personalizer/digest.md');
  assert(!fs.existsSync(digest), 'No digest is written without consent.');
  const learned = run(learning, ['learn', '--global', '--yes'], 0, consentEnv);
  assert.match(learned, /all projects/);
  assert(fs.readFileSync(digest, 'utf8').includes('GLOBAL_OTHER_PROJECT_TYPED'), 'Global learning includes sessions belonging to another project.');
  assert(!learned.includes('GLOBAL_OTHER_PROJECT_TYPED'), 'Session text stays out of terminal output.');
  const historyBefore = fs.readFileSync(session);
  run(learning, ['learn', '--global', '--forget']);
  assert(!fs.existsSync(digest));
  assert(fs.readFileSync(session).equals(historyBefore));
  console.log('ok: global learning requires consent and reads all projects; forget keeps app history');

  const edited = home('edited');
  run(edited, ['--global', '--ai', 'claude', '--yes']);
  const editedUser = '# USER.md\n\nUser-edited profile.\n';
  const editedLearned = '# LEARNED.md\n\n## Learned\n- [said, confirmed] Keep user decisions.\n';
  write(edited, '.agent-personalizer/USER.md', editedUser);
  write(edited, '.agent-personalizer/LEARNED.md', editedLearned);
  fs.appendFileSync(path.join(edited, targets[0]), 'User text added after install.\n');
  run(edited, ['--global', '--uninstall']);
  assert.equal(fs.readFileSync(path.join(edited, '.agent-personalizer/USER.md'), 'utf8'), editedUser);
  assert.equal(fs.readFileSync(path.join(edited, '.agent-personalizer/LEARNED.md'), 'utf8'), editedLearned);
  assert.equal(fs.readFileSync(path.join(edited, targets[0]), 'utf8'), 'User text added after install.\n');
  console.log('ok: global uninstall retains edited profile sources and user text in a created target');

  const editedBlock = home('edited-block');
  run(editedBlock, ['--global', '--ai', 'agents', '--yes']);
  const blockFile = path.join(editedBlock, targets[1]);
  const blockBytes = fs.readFileSync(blockFile, 'utf8').replace('## Rules', '## Rules\n\nMy edited block.');
  fs.writeFileSync(blockFile, blockBytes);
  run(editedBlock, ['--global', '--uninstall']);
  assert.equal(fs.readFileSync(blockFile, 'utf8'), blockBytes, 'Edited generated blocks are retained.');
  assert(fs.existsSync(path.join(editedBlock, '.agent-personalizer/.agent-personalizer.json')), 'Retained edits keep their ownership record.');
  console.log('ok: global uninstall retains edited blocks and their configuration');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
