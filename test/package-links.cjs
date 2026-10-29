#!/usr/bin/env node
'use strict';

// Validate against npm's actual file inventory, rather than the working tree.
// No tarball is written and no dependencies are installed by this check.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert').strict;

const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--repo')) throw new Error('usage: package-links.cjs [--repo path]');
const ROOT = args.length ? path.resolve(args[1]) : path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cache = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'ap-pack-cache-'));
let packed;
try {
  packed = spawnSync(npm, ['pack', '--dry-run', '--json', '--cache', cache], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, HOME: cache, USERPROFILE: cache, npm_config_offline: 'true' } });
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
  function stripExamples(text) {
    let output = '';
    for (let i = 0; i < text.length;) {
      if (i === 0 || text[i - 1] === '\n') {
        const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(text.slice(i));
        if (fence) {
          const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \t\r]*$', 'gm');
          close.lastIndex = i + fence[0].length;
          const match = close.exec(text);
          i = match ? close.lastIndex : text.length;
          output += '\n';
          continue;
        }
      }
      if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i + 4);
        if (close !== -1) { i = close + 3; continue; }
      }
      if (text[i] === '\\' && /[\\`]/.test(text[i + 1] || '')) {
        output += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (text[i] === '`') {
        const ticks = /^`+/.exec(text.slice(i))[0];
        const runs = /`+/g;
        runs.lastIndex = i + ticks.length;
        let match;
        while ((match = runs.exec(text))) {
          if (/\n[ \t\r]*\n/.test(text.slice(i + ticks.length, match.index))) { match = null; break; }
          if (match[0].length === ticks.length) break;
        }
        if (match) { i = runs.lastIndex; output += ' '; continue; }
        output += ticks;
        i += ticks.length;
        continue;
      }
      output += text[i++];
    }
    return output;
  }
  let body = markdown, previous;
  do {
    previous = body;
    body = stripExamples(body);
  } while (body !== previous);
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
  for (const line of body.split('\n')) {
    const ref = line.match(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/);
    if (ref) links.push(ref[1] || ref[2]);
  }
  for (const m of body.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi)) links.push(m[1]);
  return links;
}

assert.deepEqual(destinations('<!<!---->-- [x](missing.md) -->'), [], 'nested comments must not surface a link');
assert.deepEqual(destinations('<!-- [x](visible.md)'), ['visible.md'], 'unfinished comment openers do not truncate link checking');
assert.deepEqual(destinations('<!-- hidden --> [x](visible.md)'), ['visible.md'], 'links outside comments still resolve');
assert.deepEqual(destinations('Inline `<!--` then [x](visible.md)'), ['visible.md'], 'inline comment examples do not hide later links');
assert.deepEqual(destinations('Inline ``code ` <!--`` then [x](visible.md)'), ['visible.md'], 'longer inline code delimiters protect comment examples');
assert.deepEqual(destinations('```md\n<!--\n```\n[x](visible.md)'), ['visible.md'], 'fenced comment examples do not hide later links');
assert.deepEqual(destinations('````md\r\n```\r\n<!--\r\n````\r\n[x](visible.md)'), ['visible.md'], 'CRLF fences close at the matching delimiter length');
assert.deepEqual(destinations('`[x](missing.md)` [x](visible.md)'), ['visible.md'], 'inline code links are examples');
assert.deepEqual(destinations('<!-- hidden ` --> [x](visible.md) `'), ['visible.md'], 'backticks inside comments cannot hide a later link');
assert.deepEqual(destinations('` example [x](visible.md) ``'), ['visible.md'], 'inline code needs matching delimiter lengths');
assert.deepEqual(destinations("It's a `x\n\n[a](missing.md)\n\nend `"), ['missing.md'], 'inline code cannot cross a blank line');
assert.deepEqual(destinations('`x\r\n \t\r\n[a](missing.md)\r\nend `'), ['missing.md'], 'blank lines may contain whitespace and CRLF');
assert.deepEqual(destinations('\\`[a](missing.md)\\`'), ['missing.md'], 'escaped backticks do not open inline code');
assert.deepEqual(destinations('\\\\`[a](hidden.md)` [a](visible.md)'), ['visible.md'], 'an escaped backslash leaves a code delimiter');
assert.deepEqual(destinations('`x\n[a](hidden.md)` [a](visible.md)'), ['visible.md'], 'inline code may cross a single newline');

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
