#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node scripts/check-set.mjs [--root <dir>]';
const fix = 'run npx repo-build-skill@0.1.1 set sync (maintainer-run, outside CI)';
const renderer = '.repo-build/render-set.mjs';
const vendored = '.repo-build/set.json';
const lockFile = '.repo-build/set.lock.json';
const inputs = [renderer, vendored, lockFile, 'README.md', 'llms.txt', 'package.json'];
/** @param {Uint8Array} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Read one input as bytes. Every component below the root must be a real entry (no symlink) and the file regular.
 * @param {string} root
 * @param {string} file
 */
function readInput(root, file) {
  let path = root;
  let stat;
  for (const part of file.split('/')) {
    path = join(path, part);
    try {
      stat = lstatSync(path);
    } catch {
      throw Error(`${file}: missing or unreadable`);
    }
    if (stat.isSymbolicLink()) throw Error(`${file}: symlinks are not allowed`);
  }
  if (!stat.isFile()) throw Error(`${file}: not a regular file`);
  return readFileSync(path);
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1] || args[1].startsWith('--'))) throw Error(usage);
  const root = args.length ? resolve(args[1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const bytes = new Map(inputs.map(file => [file, readInput(root, file)]));
  const lock = JSON.parse(bytes.get(lockFile).toString('utf8'));
  for (const key of ['renderer_sha256', 'vendored_sha256']) {
    if (!lock || typeof lock[key] !== 'string' || !/^[a-f0-9]{64}$/.test(lock[key])) throw Error(`Invalid ${lockFile}: ${key}`);
  }
  // Pins first: renderer code is imported only after its exact bytes match the lock.
  const drift = [];
  for (const [file, key] of [[renderer, 'renderer_sha256'], [vendored, 'vendored_sha256']]) {
    if (sha256(bytes.get(file)) !== lock[key]) drift.push(file);
  }
  if (!drift.length) {
    // Import the hashed bytes themselves, never a second copy from disk.
    const { renderSet } = await import(`data:text/javascript;base64,${bytes.get(renderer).toString('base64')}`);
    drift.push(...renderSet({ root, check: true }).changed);
  }
  if (drift.length) {
    for (const file of drift) console.error(`SET_DRIFT: ${file}: ${fix}`);
    process.exitCode = 1;
  } else {
    console.log('Set blocks and pinned hashes match.');
  }
} catch (error) {
  console.error(`SET_CHECK: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
