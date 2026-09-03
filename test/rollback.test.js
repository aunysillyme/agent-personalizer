#!/usr/bin/env node
'use strict';
/* Fault injection for the commit/rollback path in render/render.js.
   Runs render as a module with fs.renameSync patched:
     case A: the second commit rename throws  -> every target byte-for-byte as before, no temps, no backups, exit 2
     case B: the second commit rename throws AND the restore rename of the first target throws
             -> the first target's backup is KEPT, stderr says ROLLBACK INCOMPLETE, exit 2
     case C: the second commit rename throws AND unlinking the second staged file throws
             -> targets restored, the staged file is named under ROLLBACK INCOMPLETE, exit 2, no "restored" claim
     case D: second target ABSENT before the run, its commit rename throws
             -> first restored, second still absent, complete rollback reported, no leftovers
     case E: after a successful commit, deleting a backup throws
             -> targets written, CLEANUP INCOMPLETE names the backup, exit 2
   Case A also runs under umask 077 and asserts the restored target keeps its 0666 mode.
   usage: node test/rollback.test.js <project-dir-copy-of-the-example>   exit 0 = both cases behaved */
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('need a project dir'); process.exit(2); }
const render = require(path.join(__dirname, '..', 'render', 'render.js'));

function snapshot(names) { const o = {}; for (const n of names) o[n] = fs.existsSync(path.join(dir, n)) ? fs.readFileSync(path.join(dir, n)) : null; return o; }
function same(a, b) { return (a === null && b === null) || (a && b && a.equals(b)); }
function temps() { return fs.readdirSync(dir).filter(n => /\.agent-personalizer\.(tmp|bak)$/.test(n)); }

function run(faults, unlinkFault) {
  const realRename = fs.renameSync, realUnlink = fs.unlinkSync, realExit = process.exit, realErr = console.error;
  let renames = 0; const errs = [];
  fs.renameSync = (a, b) => { renames++; const which = faults(renames, a, b); if (which) throw new Error(`injected: ${which}`); return realRename(a, b); };
  fs.unlinkSync = (p) => { if (unlinkFault && unlinkFault(p)) throw new Error('injected: unlink'); return realUnlink(p); };
  process.exit = (code) => { throw Object.assign(new Error('exit'), { code }); };
  console.error = (m) => errs.push(String(m));
  process.argv = ['node', 'render.js', '--dir', dir, '--targets', 'claude,agents'];
  let code = 0;
  const restore = () => { fs.renameSync = realRename; fs.unlinkSync = realUnlink; process.exit = realExit; console.error = realErr; };
  try { render.main(); } catch (e) { if (e.message === 'exit') code = e.code; else { restore(); throw e; } }
  restore();
  return { code, errs, renames };
}

const names = ['CLAUDE.md', 'AGENTS.md'];
fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'HANDWRITTEN CLAUDE\n');
fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'HANDWRITTEN AGENTS\n');
let ok = true;
const say = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); ok = ok && cond; };

// case A: second commit rename fails; the first must be rolled back, mode included, under a restrictive umask
fs.chmodSync(path.join(dir, 'CLAUDE.md'), 0o666);
const oldUmask = process.umask(0o077);
let before = snapshot(names);
let r = run((n) => n === 2 ? 'second commit rename' : null);
let after = snapshot(names);
process.umask(oldUmask);
say(r.code === 2, `A: exit 2 (got ${r.code})`);
say((fs.statSync(path.join(dir, 'CLAUDE.md')).mode & 0o777) === 0o666, `A: restored target keeps mode 0666 under umask 077 (got ${(fs.statSync(path.join(dir, 'CLAUDE.md')).mode & 0o777).toString(8)})`);
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
for (const n of temps()) fs.unlinkSync(path.join(dir, n));

// case C: second commit rename fails AND the second staged file cannot be unlinked
before = snapshot(names);
r = run((n) => n === 2 ? 'second commit rename' : null, (p) => /AGENTS\.md\..*\.tmp$/.test(p));
after = snapshot(names);
say(r.code === 2, `C: exit 2 (got ${r.code})`);
say(same(before['CLAUDE.md'], after['CLAUDE.md']) && same(before['AGENTS.md'], after['AGENTS.md']), 'C: both targets byte-for-byte restored');
say(r.errs.some(e => /ROLLBACK INCOMPLETE/.test(e)) && r.errs.some(e => /staged output not removed: \.AGENTS\.md\./.test(e)), 'C: the leftover staged file is named');
say(!r.errs.some(e => /Every target was restored/.test(e)), 'C: did not claim a complete rollback');
for (const n of temps()) fs.unlinkSync(path.join(dir, n));

// case D: second target absent before the run; its commit rename fails
fs.unlinkSync(path.join(dir, 'AGENTS.md'));
before = snapshot(names);
r = run((n) => n === 2 ? 'second commit rename' : null);
after = snapshot(names);
say(r.code === 2, `D: exit 2 (got ${r.code})`);
say(same(before['CLAUDE.md'], after['CLAUDE.md']) && after['AGENTS.md'] === null, 'D: first restored, absent second still absent');
say(r.errs.some(e => /Every target was restored/.test(e)) && !r.errs.some(e => /ROLLBACK INCOMPLETE/.test(e)), 'D: reported a complete rollback, not a false incomplete one');
say(temps().length === 0, 'D: no leftovers');

// case E: commit succeeds, deleting the first target's backup fails
fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'HANDWRITTEN AGENTS\n');
r = run(() => null, (p) => /CLAUDE\.md\..*\.bak$/.test(p));
say(r.code === 2, `E: exit 2 (got ${r.code})`);
say(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').includes('agent-personalizer:begin'), 'E: targets were written');
say(r.errs.some(e => /CLEANUP INCOMPLETE/.test(e)) && r.errs.some(e => /backup not removed: \.CLAUDE\.md\./.test(e)), 'E: the leftover backup is named');
process.exit(ok ? 0 : 1);
