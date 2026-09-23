'use strict';
// Plan every deletion from stored answers and current sources before changing anything.
// Installed JavaScript is compared as bytes, never loaded or executed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const renderer = require('../render/render.cjs');
const onboarding = require('../render/onboarding.cjs');
const TARGETS = require('../render/targets.json');
const { installPlan } = require('./install-plan.cjs');
const CONFIG = '.agent-personalizer.json';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// The recorded hash for a path, or undefined for a config written before this field existed
// (0.5.x and earlier) or for a path install never recorded. undefined means: fall back to
// recomputing the expected bytes from the currently running package, exactly as before.
const recordedHash = (cfg, rel) => (cfg.installed && typeof cfg.installed === 'object' && !Array.isArray(cfg.installed)) ? cfg.installed[rel] : undefined;

function refuse(message) { throw new renderer.Refusal(message); }
function uninstall(dir, { dry = false } = {}) {
  const previousThrows = renderer.DIE_THROWS;
  renderer.DIE_THROWS = true;
  try { return run(dir, dry); }
  catch (e) {
    console.error(`agent-personalizer: ${e.message}`);
    process.exitCode = e instanceof renderer.Refusal ? 2 : 1;
  } finally { renderer.DIE_THROWS = previousThrows; }
}

function run(dir, dry) {
  const requested = path.resolve(dir);
  let st;
  try { st = fs.lstatSync(requested); }
  catch (e) {
    if (e.code === 'ENOENT') refuse(`missing config: expected ${path.join(requested, CONFIG)}`);
    throw e;
  }
  if (st.isSymbolicLink()) refuse(`--dir ${requested} is a symlink; nothing was removed`);
  if (!st.isDirectory()) refuse(`--dir ${requested} is not a directory`);
  // Resolve the user-selected boundary once, as the installer does. All paths beneath it
  // are walked with lstat, including missing and dangling entries, before any read or write.
  const root = fs.realpathSync(requested);
  const observations = new Map();
  const dirs = new Set();
  function probe(rel, kind = 'file') {
    if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..'))
      refuse(`refusing path ${JSON.stringify(rel)} outside the install folder`);
    let cur = root;
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      cur = path.join(cur, parts[i]);
      let info;
      try { info = fs.lstatSync(cur); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      const label = parts.slice(0, i + 1).join('/');
      if (info.isSymbolicLink()) refuse(`${label} is a symlink; nothing was removed`);
      const directory = i < parts.length - 1 || kind === 'dir';
      if (directory ? !info.isDirectory() : !info.isFile()) refuse(`${label} is not a regular ${directory ? 'directory' : 'file'}; nothing was removed`);
      if (!observations.has(label)) observations.set(label, { info, kind: directory ? 'dir' : 'file' });
    }
    return cur;
  }
  function read(rel) {
    const full = probe(rel);
    if (!full) return null;
    const bytes = fs.readFileSync(full, { flag: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) });
    const entry = observations.get(rel);
    if (!entry.bytes) entry.bytes = bytes;
    return bytes;
  }
  function text(bytes, rel) {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch (_) { refuse(`${rel} is not valid UTF-8; nothing was removed`); }
  }
  function parentDirs(rel) {
    let parent = path.posix.dirname(rel);
    while (parent !== '.') { dirs.add(parent); parent = path.posix.dirname(parent); }
  }

  if (!read(CONFIG)) refuse(`missing config: expected ${path.join(root, CONFIG)}`);
  let cfg;
  try { cfg = renderer.readConfig(root); }
  catch (e) { if (e instanceof renderer.Refusal) refuse(`${CONFIG}: ${e.message}`); throw e; }
  if (!Array.isArray(cfg.targets) || !cfg.targets.length || !cfg.onboarding || !Number.isInteger(cfg.level))
    refuse(`${CONFIG} needs stored targets, level and onboarding answers for --uninstall`);
  const answers = cfg.onboarding;
  const level = Math.min(cfg.level, 3);
  const base = onboarding.baseFor(answers);
  // The renderer consults this path even at level 1. Validate it before rendering.
  const notesScaffolded = !!probe(`${base}/README.md`);
  const recipe = installPlan({ answers, level, targets: cfg.targets, notesScaffolded }).plan;
  const homeNames = new Set(['CLAUDE.md', 'AGENTS.md']);
  const expected = new Map();
  for (const p of recipe) {
    if (homeNames.has(p.rel)) continue; // compare these after rendering their block
    const bytes = p.src ? fs.readFileSync(p.src) : Buffer.from(p.text);
    if (expected.has(p.rel) && !expected.get(p.rel).equals(bytes)) refuse(`${p.rel}: conflicting install paths; nothing was removed`);
    expected.set(p.rel, bytes);
  }
  const tracked = new Set([CONFIG, 'USER.md', ...recipe.map(p => p.rel)]);
  for (const key of cfg.targets) {
    const target = TARGETS[key];
    tracked.add(target.file);
    for (const rel of Object.values(target.boxFiles || {})) tracked.add(rel);
  }
  // Check every tracked file first, including hook/runtime copies and raw paste files.
  for (const rel of tracked) { read(rel); parentDirs(rel); }
  // Custom local rules also influence the render. Validate and snapshot them, including
  // README.md which the rule loader skips, so a symlink there cannot hide from preflight.
  if (probe('rules', 'dir')) {
    for (const name of fs.readdirSync(path.join(root, 'rules'))) {
      if (name.endsWith('.md')) read(`rules/${name}`);
    }
  }
  const rendered = renderer.renderedContents(root, cfg);
  const plan = [];
  const add = (rel, action, output, reason) => plan.push({ rel, action, output, reason });
  for (const entry of rendered) {
    const { rel, key, block, raw } = entry;
    const bytes = read(rel);
    if (!bytes) continue;
    const recorded = recordedHash(cfg, rel);
    if (raw) {
      const unedited = recorded ? sha256(bytes) === recorded : bytes.equals(Buffer.from(block));
      add(rel, unedited ? 'remove' : 'keep', null, 'edited');
      continue;
    }
    const existing = text(bytes, rel);
    const ms = renderer.markerState(existing, rel);
    if (ms.kind === 'malformed') refuse(`${rel}: malformed marker block; nothing was removed`);
    // Exact block bytes matter here. --check normalizes CRLF for drift reporting, but
    // uninstall treats even a line-ending edit inside the owned block as an edit.
    const generated = renderer.splice(null, block, rel);
    const expectedBlock = generated.slice(0, -1);
    const matchesBlock = ms.kind === 'one' && existing.slice(ms.bStart, ms.eEnd) === expectedBlock;
    if (cfg.preservedTargets && cfg.preservedTargets.includes(key)) {
      // Only the block is ours here; the rest of the file is the user's, whatever it says.
      // Install records the hash of the exact inner block text it wrote (the same shape
      // `renderer.between` extracts: markers and their surrounding blank line stripped), so a
      // later package release changing rules/ or USER.md cannot make an untouched block look
      // edited (or vice versa).
      const currentBlock = renderer.between(existing, rel);
      const blockUnedited = recorded ? (currentBlock !== null && sha256(Buffer.from(currentBlock)) === recorded) : matchesBlock;
      if (blockUnedited) add(rel, 'strip', Buffer.from(existing.slice(0, ms.bStart) + existing.slice(ms.eEnd)), 'pre-existing file; removed only the marked block');
      else add(rel, 'keep', null, ms.kind === 'none' ? 'pre-existing file; block already absent' : 'edited');
      continue;
    }
    if (recorded) {
      // Install recorded the exact whole-file bytes it wrote for this target; compare against
      // that instead of re-rendering from whatever package version happens to be running now.
      add(rel, sha256(bytes) === recorded ? 'remove' : 'keep', null, 'edited or pre-existing content');
      continue;
    }
    const candidates = [Buffer.from(generated)];
    if (homeNames.has(rel)) {
      // Legacy fallback only (no recorded hash: a config from before this field existed).
      // Earlier levels and notes-presence states can leave unchanged pointer templates
      // behind on a later run. They are all produced by the same installer recipe.
      for (let l = 1; l <= level; l++) for (const ns of [false, true]) {
        const home = installPlan({ answers, level: l, targets: [key], notesScaffolded: ns }).plan.find(p => p.rel === rel);
        candidates.push(Buffer.from(renderer.splice(home.text, block, rel)));
      }
    }
    add(rel, candidates.some(candidate => candidate.equals(bytes)) ? 'remove' : 'keep', null, 'edited or pre-existing content');
  }
  const user = read('USER.md');
  if (user) {
    const recordedUser = recordedHash(cfg, 'USER.md');
    const userUnedited = recordedUser ? sha256(user) === recordedUser : [false, true].some(ns => user.equals(Buffer.from(onboarding.renderUser(answers, { notesScaffolded: ns }))));
    add('USER.md', userUnedited ? 'remove' : 'keep', null, 'edited');
  }
  for (const [rel, bytes] of expected) {
    const existing = read(rel);
    if (!existing) continue;
    const recorded = recordedHash(cfg, rel);
    // Install recorded the exact bytes it wrote for this tracked file; a later release of this
    // very package (a newer rules/, render/ or template file) must never make an untouched file
    // read as edited. Only a config with no record for this path (0.5.x or earlier) falls back
    // to comparing against what the currently running package would write.
    const unedited = recorded ? sha256(existing) === recorded : existing.equals(bytes);
    add(rel, unedited ? 'remove' : 'keep', null, 'edited');
  }
  if (new Set(plan.map(p => p.rel)).size !== plan.length) refuse('conflicting tracked paths; nothing was removed');
  const retained = plan.filter(p => p.action !== 'remove');
  const removeConfig = retained.length === 0;
  const gone = new Set(plan.filter(p => p.action === 'remove').map(p => p.rel));
  const emptyDirs = [];
  for (const rel of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b))) {
    if (!probe(rel, 'dir')) continue;
    if (fs.readdirSync(path.join(root, rel)).every(name => gone.has(`${rel}/${name}`))) {
      emptyDirs.push(rel); gone.add(rel);
    }
  }
  // Recheck the whole snapshot and permissions before the first change. An invalid or
  // concurrently changed path leaves every file alone. There is no recursive deletion.
  for (const [rel, saved] of observations) {
    const full = probe(rel, saved.kind);
    if (!full) refuse(`${rel} changed during preflight; nothing was removed`);
    const now = fs.lstatSync(full);
    if (now.dev !== saved.info.dev || now.ino !== saved.info.ino || now.mode !== saved.info.mode || (saved.bytes && !fs.readFileSync(full).equals(saved.bytes)))
      refuse(`${rel} changed during preflight; nothing was removed`);
  }
  for (const rel of [...plan.filter(p => p.action !== 'keep').map(p => p.rel), ...emptyDirs, ...(removeConfig ? [CONFIG] : [])]) {
    try { fs.accessSync(path.dirname(path.join(root, rel)), fs.constants.W_OK); }
    catch (_) { refuse(`${rel}: parent directory is not writable; nothing was removed`); }
  }
  const label = dry ? 'would ' : '';
  if (dry) console.log('Dry run: preview only; no files changed.');
  for (const p of plan) {
    if (p.action === 'keep') { console.log(`kept   ${p.rel} (${p.reason})`); continue; }
    if (!dry) {
      const full = probe(p.rel);
      if (!full || !fs.readFileSync(full).equals(observations.get(p.rel).bytes)) refuse(`${p.rel} changed before removal; config kept, rerun after reviewing the folder`);
      if (p.action === 'remove') fs.unlinkSync(full);
      else {
        // Replace rather than truncate, preserving permissions without writing through a hard link.
        const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${crypto.randomBytes(8).toString('hex')}.agent-personalizer.tmp`);
        try {
          fs.writeFileSync(tmp, p.output, { flag: 'wx', mode: observations.get(p.rel).info.mode & 0o777 });
          fs.chmodSync(tmp, observations.get(p.rel).info.mode & 0o777);
          probe(p.rel);
          fs.renameSync(tmp, full);
        } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
      }
    }
    console.log(`${label}${p.action === 'strip' ? 'update' : 'remove'} ${p.rel}${p.action === 'strip' ? ` (${p.reason})` : ''}`);
  }
  for (const rel of emptyDirs) {
    if (!dry) {
      const full = probe(rel, 'dir');
      if (full && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      else continue;
    }
    console.log(`${label}remove ${rel}/ (empty)`);
  }
  // Config is always the final removal. A kept tracked path keeps the record for review.
  if (removeConfig) {
    if (!dry) {
      for (const p of plan) if (probe(p.rel)) refuse(`${p.rel} still exists; ${CONFIG} kept`);
      const full = probe(CONFIG);
      if (!full || !fs.readFileSync(full).equals(observations.get(CONFIG).bytes)) refuse(`${CONFIG} changed; config kept`);
      fs.unlinkSync(full);
    }
    console.log(`${label}remove ${CONFIG}`);
  } else console.log(`kept   ${CONFIG} (tracked files remain; review the kept paths above)`);
  if (level >= 3) console.log('Manual step: remove any SessionStart entry for hooks/claude-code/session-start.sh from .claude/settings.json or ~/.claude/settings.json if you registered it. Settings are kept.');
}

module.exports = { uninstall };
