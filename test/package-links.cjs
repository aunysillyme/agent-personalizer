#!/usr/bin/env node
'use strict';

// Validate against npm's actual file inventory, rather than the working tree.
// No tarball is written and no dependencies are installed by this check.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--repo')) throw new Error('usage: package-links.cjs [--repo path]');
const ROOT = args.length ? path.resolve(args[1]) : path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cache = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'ap-pack-cache-'));
let packed;
try {
  packed = spawnSync(npm, ['pack', '--dry-run', '--json', '--cache', cache], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
} finally { fs.rmSync(cache, { recursive: true, force: true }); }
if (packed.error) throw packed.error;
if (packed.status !== 0) { console.error(packed.stderr || packed.stdout); process.exit(packed.status || 1); }
const result = JSON.parse(packed.stdout);
// npm 10/11 return an array; npm 12 keys the same entries by package name.
const inventory = Array.isArray(result) ? result : Object.values(result);
if (inventory.length !== 1 || !Array.isArray(inventory[0].files)) throw new Error('npm pack returned no file inventory');
const files = new Set(inventory[0].files.map(file => file.path));

function destinations(markdown) {
  // Links shown as code samples or inside comments are examples, rather than
  // navigation in the rendered Markdown. Inline code can appear in link labels.
  const source = markdown.replace(/<!--[^]*?-->/g, '').split('\n');
  let fence = null;
  const lines = source.filter(line => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (fence === m[1][0]) fence = null;
      return false;
    }
    return !fence;
  });
  const body = lines.join('\n');
  const links = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== ']' || body[i + 1] !== '(') continue;
    let p = i + 2;
    while (/\s/.test(body[p] || '') && p < body.length) p++;
    if (body[p] === '<') {
      const end = body.indexOf('>', p + 1);
      if (end >= 0) links.push(body.slice(p + 1, end));
      continue;
    }
    const start = p;
    let depth = 0;
    while (p < body.length) {
      if (body[p] === '\\') { p += 2; continue; }
      if (body[p] === '(') depth++;
      if (body[p] === ')') { if (!depth) break; depth--; }
      if (/\s/.test(body[p]) && !depth) break;
      p++;
    }
    if (p > start) links.push(body.slice(start, p).replace(/\\([()])/g, '$1'));
  }
  for (const line of lines) {
    const ref = line.match(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/);
    if (ref) links.push(ref[1] || ref[2]);
  }
  for (const m of body.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi)) links.push(m[1]);
  return links;
}

let checked = 0;
const errors = [];
for (const name of [...files].filter(file => /\.md$/i.test(file)).sort()) {
  const markdown = fs.readFileSync(path.join(ROOT, name), 'utf8');
  for (const url of destinations(markdown)) {
    if (!url || url.startsWith('#') || url.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(url)) continue;
    checked++;
    let dest;
    try { dest = decodeURIComponent(url.split(/[?#]/)[0]); }
    catch (_) { errors.push(`${name}: invalid URL ${url}`); continue; }
    if (!dest) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), dest));
    const inside = !dest.startsWith('/') && target !== '..' && !target.startsWith('../');
    const directory = target.replace(/\/$/, '') + '/';
    if (!inside || !(files.has(target) || [...files].some(file => file.startsWith(directory)))) errors.push(`${name}: ${url} -> missing packed target ${target}`);
  }
}
if (errors.length) {
  for (const error of errors) console.error(`FAIL packed Markdown link: ${error}`);
  console.error(`${errors.length} unresolved links in ${checked} relative links checked`);
  process.exitCode = 1;
} else console.log(`${checked} relative links resolve inside the npm pack inventory`);
