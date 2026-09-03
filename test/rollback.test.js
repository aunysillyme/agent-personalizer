#!/usr/bin/env node
'use strict';
/* Fault injection for the commit/rollback path in render/render.js.
   Runs render as a module with fs.renameSync patched:
     case A: the second commit rename throws  -> every target byte-for-byte as before, no temps, no backups, exit 2
     case B: the second commit rename throws AND the restore rename of the first target throws
             -> the first target's backup is KEPT, stderr says ROLLBACK INCOMPLETE, exit 2
   usage: node test/rollback.test.js <project-dir-copy-of-the-example>   exit 0 = both cases behaved */
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('need a project dir'); process.exit(2); }
const render = require(path.join(__dirname, '..', 'render', 'render.js'));

function snapshot(names) { const o = {}; for (const n of names) o[n] = fs.existsSync(path.join(dir, n)) ? fs.readFileSync(path.join(dir, n)) : null; return o; }
function same(a, b) { return (a === null && b === null) || (a && b && a.equals(b)); }
function temps() { return fs.readdirSync(dir).filter(n => /\.agent-personalizer\.(tmp|bak)$/.test(n)); }

function run(faults) {
  const realRename = fs.renameSync, realExit = process.exit, realErr = console.error;
  let renames = 0; const errs = [];
  fs.renameSync = (a, b) => { renames++; const which = faults(renames, a, b); if (which) throw new Error(`injected: ${which}`); return realRename(a, b); };
  process.exit = (code) => { throw Object.assign(new Error('exit'), { code }); };
  console.error = (m) => errs.push(String(m));
  process.argv = ['node', 'render.js', '--dir', dir, '--targets', 'claude,agents'];
  let code = 0;
  try { render.main(); } catch (e) { if (e.message === 'exit') code = e.code; else { fs.renameSync = realRename; process.exit = realExit; console.error = realErr; throw e; } }
  fs.renameSync = realRename; process.exit = realExit; console.error = realErr;
  return { code, errs, renames };
}

const names = ['CLAUDE.md', 'AGENTS.md'];
fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'HANDWRITTEN CLAUDE\n');
fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'HANDWRITTEN AGENTS\n');
let ok = true;
const say = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); ok = ok && cond; };

// case A: second commit rename fails; the first must be rolled back
let before = snapshot(names);
let r = run((n) => n === 2 ? 'second commit rename' : null);
let after = snapshot(names);
say(r.code === 2, `A: exit 2 (got ${r.code})`);
say(same(before['CLAUDE.md'], after['CLAUDE.md']) && same(before['AGENTS.md'], after['AGENTS.md']), 'A: both targets byte-for-byte restored');
say(temps().length === 0, `A: no temps or backups left (${temps().join(', ') || 'none'})`);
say(r.errs.some(e => /Every target was restored/.test(e)), 'A: reported a complete rollback');

// case B: second commit rename fails AND the restore of the first target fails
before = snapshot(names);
r = run((n, a, b) => n === 2 ? 'second commit rename' : (n === 3 && /\.bak$/.test(a) ? 'restore rename' : null));
after = snapshot(names);
const kept = temps().filter(n => /CLAUDE\.md.*\.bak$/.test(n));
say(r.code === 2, `B: exit 2 (got ${r.code})`);
say(kept.length === 1, `B: the first target's backup was KEPT (${kept.join(', ') || 'none'})`);
say(kept.length === 1 && fs.readFileSync(path.join(dir, kept[0])).equals(before['CLAUDE.md']), 'B: kept backup holds the original bytes');
say(r.errs.some(e => /ROLLBACK INCOMPLETE/.test(e)) && r.errs.some(e => /CLAUDE\.md: original kept at/.test(e)), 'B: stderr names the affected target and its backup');
say(!r.errs.some(e => /Every target was restored/.test(e)), 'B: did not claim a complete rollback');
say(same(before['AGENTS.md'], after['AGENTS.md']), 'B: the untouched second target is unchanged');
process.exit(ok ? 0 : 1);
