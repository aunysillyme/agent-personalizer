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

// Fixture with its own copy of the script, so a default-root run executes that copy's neighbours.
function withScript(name, renderer) {
  const dir = fixture(name);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(CHECK, path.join(dir, 'scripts/check-set.mjs'));
  if (renderer) fs.writeFileSync(path.join(dir, '.repo-build/render-set.mjs'), renderer);
  return dir;
}
function runCopy(dir, args = []) {
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts/check-set.mjs'), ...args], { cwd: scratch, encoding: 'utf8' });
  assert.ifError(result.error);
  return { code: result.status, output: result.stdout + result.stderr };
}

try {
  const clean = run([]);
  code(clean, 0);
  assert.equal(clean.output, 'Set blocks and pinned hashes match.\n');
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

  // An unpinned renderer must never run: appended code writes a marker and exits 0.
  const unpinned = withScript('unpinned-renderer');
  const marker = path.join(unpinned, 'ran.marker');
  fs.appendFileSync(path.join(unpinned, '.repo-build/render-set.mjs'),
    `\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\nprocess.exit(0);\n`);
  for (const args of [[], ['--root', unpinned]]) {
    const result = runCopy(unpinned, args);
    code(result, 1);
    assert(result.output.startsWith('SET_DRIFT: .repo-build/render-set.mjs: '), result.output);
    assert.equal(fs.existsSync(marker), false, 'unpinned renderer code ran');
  }
  console.log('PASS set never executes a renderer that fails its pin');

  // Symlinked inputs (and a symlinked directory) are refused even when the bytes are identical.
  for (const file of ['.repo-build/set.lock.json', 'package.json', '.repo-build/render-set.mjs', '.repo-build']) {
    const dir = fixture('link-' + file.replace(/\W/g, '-'));
    const real = path.join(scratch, 'real-' + file.replace(/\W/g, '-'));
    const link = path.join(dir, file);
    fs.mkdirSync(real);
    if (file === '.repo-build') {
      for (const name of fs.readdirSync(link)) fs.copyFileSync(path.join(link, name), path.join(real, name));
      fs.rmSync(link, { recursive: true });
    } else {
      fs.copyFileSync(link, path.join(real, 'copy'));
      fs.rmSync(link);
    }
    try { fs.symlinkSync(file === '.repo-build' ? real : path.join(real, 'copy'), link); } catch (error) {
      console.log('SKIP symlink ' + file + ': ' + error.code);
      continue;
    }
    const result = run(['--root', dir]);
    code(result, 2);
    assert(/symlink/.test(result.output), result.output);
  }
  console.log('PASS set symlinked inputs exit 2');

  // --root runs the renderer hashed under that root, never the script-relative one.
  const own = withScript('own-copy', `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(path.join(scratch, 'own.marker'))}, 'ran');
export const renderSet = () => ({ changed: [] });
`);
  const viaRoot = runCopy(own, ['--root', fixture('root-clean')]);
  code(viaRoot, 0);
  assert.equal(fs.existsSync(path.join(scratch, 'own.marker')), false, 'the script-relative renderer ran');
  console.log('PASS set --root runs only the hashed renderer');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
