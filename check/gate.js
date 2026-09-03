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
  Coverage: anywhere inside a git work tree (a subfolder included), exactly the files git
  would ship from --dir down (tracked plus untracked and not ignored:
  `git ls-files --cached --others --exclude-standard`), so a gitignored scratch file cannot
  fail the gate and a forgotten new file cannot dodge it. Git enumeration failing inside a
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

function isBinary(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n).includes(0);
  } finally { fs.closeSync(fd); }
}

function* walk(root) {
  for (const name of fs.readdirSync(root).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(root, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) continue;
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

function* gitFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  for (const rel of out.split('\0')) {
    if (!rel) continue;
    const p = path.join(root, rel);
    let st; try { st = fs.lstatSync(p); } catch (_) { continue; }
    if (st.isFile() && !st.isSymbolicLink()) yield p;
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
    if (e.status === 128 && /not a git repository/i.test(err)) return false;
    if (!hasGitMetadata(root)) return false;
    die(`${root} carries git metadata but git could not run (${err.trim().split('\n')[0] || e.code || 'unknown error'}). Fix git, or pass --all to scan every file under --dir.`);
  }
}

function fileSet(root, all) {
  if (all) return { files: walk(root), mode: 'walk' };
  if (insideGitRepo(root)) {
    let files;
    try { files = [...gitFiles(root)]; } catch (e) { die(`git enumeration failed inside a repository: ${e.message}`); }
    return { files, mode: 'git' };
  }
  return { files: walk(root), mode: 'walk' };
}

function scan(root, list, listFile, all) {
  const hits = [];
  let files = 0;
  const skipPath = listFile ? path.resolve(listFile) : null;
  const set = fileSet(root, all);
  scan.mode = set.mode;
  for (const file of set.files) {
    if (skipPath && path.resolve(file) === skipPath) continue;
    if (isBinary(file)) continue;
    files++;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, n) => {
      const lower = line.toLowerCase();
      const spans = allowedSpans(lower, list.allow);
      for (const term of list.terms) {
        const t = term.toLowerCase();
        let i = lower.indexOf(t);
        while (i !== -1) {
          const inside = spans.some(([a, b]) => i >= a && i + t.length <= b);
          if (!inside) hits.push({ file: path.relative(root, file), line: n + 1, term });
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
  console.log(`gate clean: 0 hits across ${files} files (${scan.mode === 'git' ? 'files git would ship' : 'every file under --dir'})`);
}

main();
