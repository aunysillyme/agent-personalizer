import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node scripts/check-set.mjs [--root <dir>]';
const fix = 'run npx repo-build-skill@0.1.1 set sync (maintainer-run, outside CI)';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1] || args[1].startsWith('--'))) throw Error(usage);
  const root = args.length ? path.resolve(args[1]) : fileURLToPath(new URL('../', import.meta.url));
  const files = ['README.md', 'llms.txt', 'package.json', '.repo-build/render-set.mjs', '.repo-build/set.json', '.repo-build/set.lock.json'];
  const contents = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file))]));
  const lock = JSON.parse(contents.get('.repo-build/set.lock.json').toString('utf8'));
  for (const key of ['renderer_sha256', 'vendored_sha256']) {
    if (typeof lock[key] !== 'string' || !/^[a-f0-9]{64}$/.test(lock[key])) throw Error(`Invalid .repo-build/set.lock.json: ${key}`);
  }

  const { renderSet } = await import('../.repo-build/render-set.mjs');
  const drift = new Set();
  let renderError;
  try {
    const result = renderSet({ root, check: true });
    for (const file of result.changed) drift.add(file);
  } catch (error) { renderError = error; }
  for (const [file, key] of [['.repo-build/render-set.mjs', 'renderer_sha256'], ['.repo-build/set.json', 'vendored_sha256']]) {
    if (sha256(contents.get(file)) !== lock[key]) drift.add(file);
  }
  if (renderError && !drift.size) throw renderError;
  if (drift.size) {
    for (const file of drift) console.error(`SET_DRIFT: ${file}: ${fix}`);
    process.exitCode = 1;
  } else {
    console.log('Set blocks and locked hashes match.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
