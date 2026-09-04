#!/usr/bin/env node
'use strict';
/*
  gate.js: the zero-personal-data gate.

  Scans every regular, non-binary file under a directory for terms listed in
  check/forbidden.local.txt and fails loudly on any hit. The list itself is gitignored:
  a list of your own identifiers must never ship in a public repo.

  usage:
    node check/gate.js [--dir <root>] [--list <file>]     scan; exit 0 clean, 1 on hits, 2 on setup error
    node check/gate.js --self-test                        prove the gate can go red on a seeded hit

  Fail-closed: a missing or empty list is exit 2, never a pass.
  Coverage: anywhere inside a git work tree (a subfolder included), exactly what git would
  ship from --dir down: for every cached path the INDEX blob (what a commit publishes) plus
  the working-tree copy when it differs (what the next `git add` publishes); for every
  untracked, not-ignored path the working-tree copy. A gitignored scratch file cannot fail
  the gate, a forgotten new file cannot dodge it, and a leak staged then cleaned on disk is
  still caught. A symlink is never followed, but its target text is scanned (git ships it). Git enumeration failing inside a
  repo is a setup error (exit 2), never a silent fallback. Outside a repo, or with --all,
  every regular file under --dir. Any extension. Binary files (a NUL
  byte in the first 8 KB) are skipped. Symlinks are never followed.
  Matching: case-insensitive substring. Lines "allow:<exact text>" whitelist that exact
  string (attribution you keep on purpose); a forbidden term inside an allowed string
  does not count. Unicode lookalikes are not detected; the list is for your real strings.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function die(msg) { console.error(`GATE SETUP ERROR: ${msg}`); process.exit(2); }

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  if (v === undefined || v === '' || v.startsWith('--')) die(`${name} needs a non-empty value`);
  return v;
}

function loadList(file) {
  if (!fs.existsSync(file)) die(`${file} not found.\nCopy check/forbidden.example.txt to that path and fill it in. The gate does not pass without it.`);
  const terms = [], allow = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (line.startsWith('allow:')) {
      const a = line.slice(6).trim();
      if (!a) die(`${file}:${n + 1}: empty allow entry`);
      allow.push(a);
    } else terms.push(line);
  });
  if (!terms.length) die('forbidden list has no terms.');
  return { terms, allow };
}

function isBinary(bytes) { return bytes.subarray(0, 8192).includes(0); }

function* walk(root) {
  for (const name of fs.readdirSync(root).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(root, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) { yield p; continue; }        // yielded so its TARGET TEXT gets scanned; never followed
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile()) yield p;
  }
}

function allowedSpans(lineLower, allow) {
  const spans = [];
  for (const a of allow) {
    const al = a.toLowerCase();
    if (!al.length) continue;
    let i = lineLower.indexOf(al);
    while (i !== -1) { spans.push([i, i + al.length]); i = lineLower.indexOf(al, i + al.length); }
  }
  return spans;
}

/* What git would ship, as {label, bytes} items:
   - every cached path: the INDEX blob (that is what a commit publishes), and the working-tree
     copy as well when it differs from the index (that is what `git add` would publish next);
   - every untracked, not-ignored path: the working-tree copy.
   A tracked submodule (gitlink, mode 160000) is refused: its files are not in this index. */
function git(root, args, input) {
  return execFileSync('git', ['-C', root, ...args], { input, maxBuffer: 1 << 28 });
}

function* gitItems(root) {
  const stage = git(root, ['ls-files', '-z', '--stage']).toString('utf8');
  const cached = [];
  for (const rec of stage.split('\0')) {
    if (!rec) continue;
    const m = rec.match(/^(\d{6}) ([0-9a-f]{40,64}) (\d)\t([\s\S]*)$/);
    if (!m) die(`unreadable index record: ${rec.slice(0, 80)}`);
    const [, mode, oid, , rel] = m;
    if (mode === '160000') die(`tracked submodule at ${rel}: the gate does not descend into submodules. Run it inside the submodule, or pass --all to walk every file under --dir.`);
    cached.push({ oid, rel, link: mode === '120000' });   // a symlink entry ships its TARGET TEXT as the blob; scanned, never followed
  }
  // index blobs, in one batch
  if (cached.length) {
    const out = git(root, ['cat-file', '--batch'], cached.map(c => c.oid).join('\n') + '\n');
    let pos = 0;
    for (const c of cached) {
      const nl = out.indexOf(0x0a, pos);
      if (nl === -1) die(`git cat-file: short output for ${c.rel}`);
      const header = out.subarray(pos, nl).toString('utf8');
      const hm = header.match(/^([0-9a-f]+) (\w+) (\d+)$/);
      if (!hm) die(`git cat-file: unexpected header for ${c.rel}: ${header}`);
      const size = Number(hm[3]);
      const body = out.subarray(nl + 1, nl + 1 + size);
      pos = nl + 1 + size + 1;
      yield { label: c.link ? `${c.rel} (index, symlink target)` : `${c.rel} (index)`, bytes: body };
    }
  }
  // working-tree copies that differ from the index
  const changed = new Set(git(root, ['diff', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean));
  for (const c of cached) {
    if (!changed.has(c.rel)) continue;
    const item = treeItem(root, c.rel, ' (working tree)');
    if (item) yield item;
  }
  // untracked, not ignored
  const others = git(root, ['ls-files', '-z', '--others', '--exclude-standard']).toString('utf8').split('\0').filter(Boolean);
  for (const rel of others) {
    const item = treeItem(root, rel, '');
    if (item) yield item;
  }
}

/* A working-tree entry as scan bytes: a regular file's content, or a symlink's TARGET TEXT
   (readlink, never followed). Anything else is skipped. */
function treeItem(root, rel, suffix) {
  const p = path.join(root, rel);
  let st; try { st = fs.lstatSync(p); } catch (_) { return null; }
  if (st.isSymbolicLink()) return { label: `${rel}${suffix || ' (working tree)'} symlink target`, bytes: Buffer.from(fs.readlinkSync(p), 'utf8') };
  if (st.isFile()) return { label: `${rel}${suffix}`, bytes: fs.readFileSync(p) };
  return null;
}

function* walkItems(root) {
  for (const p of walk(root)) {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) yield { label: `${path.relative(root, p)} (symlink target)`, bytes: Buffer.from(fs.readlinkSync(p), 'utf8') };
    else yield { label: path.relative(root, p), bytes: fs.readFileSync(p) };
  }
}

/* Does any ancestor (root included) carry .git metadata? Checked without git. */
function hasGitMetadata(root) {
  let dir = root;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/* true = inside a git work tree; false = git confirmed "not a repository", or git could
   not run AND no .git metadata exists anywhere above. Git failing while .git metadata is
   present is a setup error: a walk over a repo can miss tracked files under skipped
   directories, so the gate refuses rather than degrades. */
function insideGitRepo(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === 'true';
  } catch (e) {
    const err = String(e.stderr || e.message || '');
    if (!hasGitMetadata(root)) return false;
    if (e.status === 128 && /not a git repository/i.test(err)) die(`${root} carries .git metadata that git rejects as not a repository (${err.trim().split('\n')[0]}). Repair it, or pass --all to scan every file under --dir.`);
    die(`${root} carries git metadata but git could not run (${err.trim().split('\n')[0] || e.code || 'unknown error'}). Fix git, or pass --all to scan every file under --dir.`);
  }
}

function fileSet(root, all) {
  if (all) return { items: walkItems(root), mode: 'walk' };
  if (insideGitRepo(root)) {
    let items;
    try { items = [...gitItems(root)]; } catch (e) { if (e && e.message && /^(tracked submodule|unreadable index|git cat-file)/.test(e.message)) throw e; die(`git enumeration failed inside a repository: ${e.message}`); }
    return { items, mode: 'git' };
  }
  return { items: walkItems(root), mode: 'walk' };
}

function scan(root, list, listFile, all) {
  const hits = [];
  let files = 0;
  const skipPath = listFile ? path.resolve(listFile) : null;
  const set = fileSet(root, all);
  scan.mode = set.mode;
  const skipRel = skipPath && (skipPath + '').startsWith(root + path.sep) ? path.relative(root, skipPath) : null;
  for (const item of set.items) {
    if (skipRel && (item.label === skipRel || item.label.startsWith(skipRel + ' ('))) continue;
    if (isBinary(item.bytes)) continue;
    files++;
    const lines = item.bytes.toString('utf8').split('\n');
    lines.forEach((line, n) => {
      const lower = line.toLowerCase();
      const spans = allowedSpans(lower, list.allow);
      for (const term of list.terms) {
        const t = term.toLowerCase();
        let i = lower.indexOf(t);
        while (i !== -1) {
          const inside = spans.some(([a, b]) => i >= a && i + t.length <= b);
          if (!inside) hits.push({ file: item.label, line: n + 1, term });
          i = lower.indexOf(t, i + 1);
        }
      }
    });
  }
  return { hits, files };
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-selftest-'));
  let ok = false;
  try {
    const listFile = path.join(tmp, 'forbidden.txt');
    fs.writeFileSync(listFile, 'Seeded Secret Name\nallow:Copyright Seeded Secret Name Ltd\n');
    fs.writeFileSync(path.join(tmp, 'clean.md'), 'Nothing to see. Copyright Seeded Secret Name Ltd is allowed.\n');
    fs.writeFileSync(path.join(tmp, 'dirty.md'), 'This mentions seeded secret name in prose.\n');
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'RUN echo seeded secret name\n');
    fs.writeFileSync(path.join(tmp, 'blob.bin'), Buffer.from([0x73, 0x65, 0x00, 0x65, 0x64]));
    const { hits } = scan(tmp, loadList(listFile), listFile, true);
    const files = hits.map(h => h.file).sort().join(',');
    ok = hits.length === 2 && files === 'Dockerfile,dirty.md';
    console.log(ok ? 'self-test: gate went red on the seeded hits (dirty.md, Dockerfile), green on the allowed string, skipped the binary' : `self-test FAILED: expected hits in Dockerfile and dirty.md only, got ${JSON.stringify(hits)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exitCode = ok ? 0 : 1;
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const root = path.resolve(arg('--dir', path.join(__dirname, '..')));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) die(`--dir ${root} is not a directory`);
  const listFile = path.resolve(arg('--list', path.join(__dirname, 'forbidden.local.txt')));
  const all = process.argv.includes('--all');
  const { hits, files } = scan(root, loadList(listFile), listFile, all);
  if (hits.length) {
    console.log(`GATE FAILED: ${hits.length} hit(s)`);
    for (const h of hits) console.log(`  ${h.file}:${h.line}  "${h.term}"`);
    process.exit(1);
  }
  console.log(`gate clean: 0 hits across ${files} files (${scan.mode === 'git' ? 'files git would ship, index blobs included' : 'every file under --dir'})`);
}

main();
