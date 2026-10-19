'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const CHECK = path.join(ROOT, 'scripts/check-set.mjs');
const files = ['README.md', 'llms.txt', 'package.json', '.repo-build/render-set.mjs', '.repo-build/set.json', '.repo-build/set.lock.json'];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'personalizer-set-'));

function run(args, cwd = ROOT) {
  const result = spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  return { code: result.status, output: result.stdout + result.stderr };
}
function code(result, expected) { assert.equal(result.code, expected, result.output); }
function fixture(name) {
  const dir = path.join(scratch, name);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  return dir;
}
function drift(dir, names) {
  const before = files.map(file => fs.readFileSync(path.join(dir, file)));
  const result = run(['--root', dir]);
  code(result, 1);
  const lines = result.output.trim().split('\n');
  assert.equal(lines.length, names.length, result.output);
  for (const name of names) assert(lines.some(line => line.startsWith(`SET_DRIFT: ${name}: `)), result.output);
  for (const line of lines) assert(line.includes('npx repo-build-skill@0.1.1 set sync (maintainer-run, outside CI)'), line);
  files.forEach((file, i) => assert.deepEqual(fs.readFileSync(path.join(dir, file)), before[i], file + ' was changed by the check'));
}

try {
  const clean = run([]);
  code(clean, 0);
  assert.equal(clean.output, 'Set blocks and locked hashes match.\n');
  code(run([], scratch), 0);
  code(run(['--root', fixture('clean')]), 0);
  console.log('PASS set clean checkout and --root copy');

  for (const file of ['README.md', 'llms.txt', '.repo-build/render-set.mjs', '.repo-build/set.json']) {
    const dir = fixture(path.basename(file));
    if (file === 'README.md' || file === 'llms.txt') {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      const changed = file === 'README.md'
        ? text.replace('| **agent-personalizer** |', '| **edited-personalizer** |')
        : text.replace('- [repo-build-skill]', '- [edited-repo-build-skill]');
      assert.notEqual(changed, text);
      fs.writeFileSync(path.join(dir, file), changed);
    } else fs.appendFileSync(path.join(dir, file), '\n');
    drift(dir, [file]);
    console.log('PASS set drift ' + file);
  }

  const both = fixture('both-hashes');
  for (const file of ['.repo-build/render-set.mjs', '.repo-build/set.json']) fs.appendFileSync(path.join(both, file), '\n');
  drift(both, ['.repo-build/render-set.mjs', '.repo-build/set.json']);
  console.log('PASS set reports every hash drift');

  for (const file of files) {
    const dir = fixture('missing-' + path.basename(file));
    fs.unlinkSync(path.join(dir, file));
    code(run(['--root', dir]), 2);
  }
  const badLock = fixture('bad-lock');
  fs.writeFileSync(path.join(badLock, '.repo-build/set.lock.json'), '{}\n');
  code(run(['--root', badLock]), 2);
  for (const args of [['--root'], ['--root', '--bad'], ['--bad'], ['--root', scratch, 'extra']]) code(run(args), 2);
  console.log('PASS set missing files, malformed lock and bad usage exit 2');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
