#!/usr/bin/env node
'use strict';
/*
  gate.js: the zero-personal-data gate.

  Scans every file in a directory tree for terms listed in check/forbidden.local.txt
  and fails loudly on any hit. The list itself is gitignored: a list of your own
  identifiers must never ship in a public repo.

  usage:
    node check/gate.js [--dir <root>] [--list <file>]     scan; exit 0 clean, 1 on hits, 2 on setup error
    node check/gate.js --self-test                        prove the gate can go red on a seeded hit

  Fail-closed: a missing list is exit 2, never a pass.
  Matching: case-insensitive substring. Lines "allow:<exact text>" whitelist that exact
  string (attribution you keep on purpose); a forbidden term inside an allowed string
  does not count.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);
const SKIP_FILES = new Set(['forbidden.local.txt']);
const TEXT_EXT = /\.(md|txt|js|json|sh|yml|yaml|toml|html|css|ts|mjs|cjs)$/i;

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function loadList(file) {
  if (!fs.existsSync(file)) {
    console.error(`GATE SETUP ERROR: ${file} not found.\nCopy check/forbidden.example.txt to that path and fill it in. The gate does not pass without it.`);
    process.exit(2);
  }
  const terms = [], allow = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('allow:')) allow.push(line.slice(6).trim());
    else terms.push(line);
  }
  if (!terms.length) { console.error('GATE SETUP ERROR: forbidden list has no terms.'); process.exit(2); }
  return { terms, allow };
}

function* walk(root) {
  for (const name of fs.readdirSync(root)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(root, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (!SKIP_FILES.has(name) && TEXT_EXT.test(name)) yield p;
  }
}

function allowedSpans(lineLower, allow) {
  const spans = [];
  for (const a of allow) {
    const al = a.toLowerCase();
    let i = lineLower.indexOf(al);
    while (i !== -1) { spans.push([i, i + al.length]); i = lineLower.indexOf(al, i + 1); }
  }
  return spans;
}

function scan(root, list, listFile) {
  const hits = [];
  const skipPath = listFile ? path.resolve(listFile) : null;
  for (const file of walk(root)) {
    if (skipPath && path.resolve(file) === skipPath) continue;
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
  return hits;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-selftest-'));
  const listFile = path.join(tmp, 'forbidden.txt');
  fs.writeFileSync(listFile, 'Seeded Secret Name\nallow:Copyright Seeded Secret Name Ltd\n');
  fs.writeFileSync(path.join(tmp, 'clean.md'), 'Nothing to see. Copyright Seeded Secret Name Ltd is allowed.\n');
  fs.writeFileSync(path.join(tmp, 'dirty.md'), 'This mentions seeded secret name in prose.\n');
  const hits = scan(tmp, loadList(listFile), listFile);
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = hits.length === 1 && hits[0].file === 'dirty.md';
  console.log(ok ? 'self-test: gate went red on the seeded hit and stayed green on the allowed string (1 hit, dirty.md)' : `self-test FAILED: expected exactly 1 hit in dirty.md, got ${JSON.stringify(hits)}`);
  process.exit(ok ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const root = path.resolve(String(arg('--dir', path.join(__dirname, '..'))));
  const listFile = path.resolve(String(arg('--list', path.join(__dirname, 'forbidden.local.txt'))));
  const hits = scan(root, loadList(listFile), listFile);
  if (hits.length) {
    console.log(`GATE FAILED: ${hits.length} hit(s)`);
    for (const h of hits) console.log(`  ${h.file}:${h.line}  "${h.term}"`);
    process.exit(1);
  }
  console.log(`gate clean: 0 hits across ${[...walk(root)].length} files`);
}

main();
