'use strict';
// Global targets have fixed home-relative names (except CODEX_HOME when set); profile ownership stays inside its own folder.
const fs = require('fs');
const { rootedAbsolute, resolveHome, resolveCodexHome, walkRealChain, hasNonEmptyOverride } = require('./home.cjs');
const path = require('path');
const renderer = require('../render/render.cjs');
const onboarding = require('../render/onboarding.cjs');
const { sha256, validateInventory } = require('./install-plan.cjs');
const SOURCE = '.agent-personalizer';
const CONFIG = `${SOURCE}/.agent-personalizer.json`;
const TARGETS = { claude: '.claude/CLAUDE.md', agents: '.codex/AGENTS.md', gemini: '.gemini/GEMINI.md', hermes: '.hermes/SOUL.md' };
const HASH = /^[a-f0-9]{64}$/;
const refuse = message => { throw new renderer.Refusal(message); };

function decode(bytes, rel) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (_) { refuse(`${rel} is not valid UTF-8; nothing was written`); }
}
function blockHash(text, rel) {
  const ms = renderer.markerState(text, rel);
  if (ms.kind === 'malformed') refuse(`${rel}: malformed marker block; nothing was changed`);
  return ms.kind === 'one' ? sha256(Buffer.from(text.slice(ms.bStart, ms.eEnd))) : null;
}
function stripOwnedBlock(text, ms, owned) {
  let before = text.slice(0, ms.bStart), after = text.slice(ms.eEnd);
  if (after.startsWith('\r\n')) after = after.slice(2);
  else if (after.startsWith('\n')) after = after.slice(1);
  if (owned.appended && owned.separator && before.endsWith(owned.separator)) {
    before = before.slice(0, -owned.separator.length);
  }
  return before + after;
}
function validateGlobal(cfg) {
  if (!cfg.global || cfg.level !== 1) refuse('global profile config must identify a level-1 global install');
  for (const target of cfg.targets || []) if (!Object.hasOwn(TARGETS, target) && target !== 'onboarding') refuse(`unsupported global target: ${target}`);
  if (cfg.globalFiles !== undefined && (!cfg.globalFiles || typeof cfg.globalFiles !== 'object' || Array.isArray(cfg.globalFiles))) refuse('invalid global target inventory');
  for (const [key, info] of Object.entries(cfg.globalFiles || {})) {
    if (!Object.hasOwn(TARGETS, key) || !info || typeof info.created !== 'boolean' || !HASH.test(info.blockHash) || !HASH.test(info.fileHash)
        || !['', '\n', '\n\n'].includes(info.separator) || typeof info.appended !== 'boolean') refuse('invalid global target ownership');
    if (info.path !== undefined && (key !== 'agents' || !rootedAbsolute(info.path))) refuse('invalid global target path');
    if (info.createdDirs !== undefined && (key !== 'agents' || !Array.isArray(info.createdDirs) || info.createdDirs.some(d => !rootedAbsolute(d)))) {
      refuse('invalid global target directory ownership');
    }
  }
  if (cfg.globalDirectories !== undefined && (!Array.isArray(cfg.globalDirectories) || cfg.globalDirectories.some(rel => ![SOURCE, '.claude', '.codex', '.gemini', '.hermes'].includes(rel)))) refuse('invalid global directory inventory');
}

function resolveCodexTarget(root, profileRoot) {
  const raw = resolveCodexHome(root);
  const { base, missingDirs, dir } = walkRealChain(raw, { allowDarwinRootLink: true, action: 'nothing was written' });
  if (dir === profileRoot || (dir + path.sep).startsWith(profileRoot + path.sep)) {
    refuse('CODEX_HOME cannot point inside ~/.agent-personalizer; nothing was written');
  }
  const defaultDir = path.join(root, '.codex');
  if (dir === defaultDir) return { external: false, dir, rel: TARGETS.agents, full: path.join(dir, 'AGENTS.md') };
  const full = path.join(dir, 'AGENTS.md');
  if (!missingDirs.length) {
    let fileSt = null;
    try { fileSt = fs.lstatSync(full); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (fileSt) {
      if (fileSt.isSymbolicLink()) refuse(`${full} is a symlink; refusing to write through it`);
      if (!fileSt.isFile()) refuse(`${full} is not a regular file; nothing was written`);
    }
  }
  return { external: true, base, missingDirs, dir, file: 'AGENTS.md', full };
}

function readExternalFile(full, label, action = 'nothing was changed') {
  const dir = path.dirname(full);
  const chain = walkRealChain(dir, { allowDarwinRootLink: false, action });
  if (chain.missingDirs.length) return null;
  let st = null;
  try { st = fs.lstatSync(full); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (st.isSymbolicLink()) refuse(`${label} is a symlink; ${action}`);
  if (!st.isFile()) refuse(`${label} is not a regular file; ${action}`);
  return fs.readFileSync(full);
}

async function run({ args, commitPlan, probe, readConfig, ask }) {
  const prior = renderer.DIE_THROWS;
  renderer.DIE_THROWS = true;
  try { return await execute({ args, commitPlan, probe, readConfig, ask }); }
  finally { renderer.DIE_THROWS = prior; }
}
async function execute({ args, commitPlan, probe, readConfig, ask }) {
  if ('--dir' in args) refuse('--global cannot be combined with --dir');
  if ('--level' in args && args['--level'] !== '1') refuse('--global supports only --level 1');
  const home = resolveHome();
  const info = fs.lstatSync(home);
  if (info.isSymbolicLink() || !info.isDirectory()) refuse('global home must be a real directory, never a symlink');
  const root = fs.realpathSync(home);
  const source = probe(root, SOURCE);
  if (source.exists && !fs.lstatSync(source.full).isDirectory()) refuse(`${SOURCE} is not a directory`);
  const profileRoot = path.join(root, SOURCE);
  const stored = readConfig(profileRoot, 1);
  if (stored.cfgExists) validateGlobal(stored.cfg);
  if (args.command === 'learn') {
    for (const opt of ['--ai', '--level', '--answers', '--defaults', '--quick', '--full', '--compact', '--uninstall', '--dry']) if (opt in args) refuse(`${opt} is not a learn option`);
    if (args['--forget'] && (args['--all-projects'] || args['--yes'])) refuse('--forget cannot be combined with --all-projects or --yes');
    if (!stored.cfgExists) refuse(`missing config: expected ${path.join(root, CONFIG)}`);
    const learning = require('./learn.cjs');
    return args['--forget'] ? learning.forget(profileRoot) : learning.learn({ dir: profileRoot, yes: !!args['--yes'], allProjects: true });
  }
  if (args['--forget'] || args['--all-projects']) refuse('--forget and --all-projects need learn');
  if (args['--uninstall']) {
    for (const opt of ['--ai', '--level', '--answers', '--defaults', '--quick', '--full', '--compact']) if (opt in args) refuse(`${opt} is an install option; --uninstall reads the stored config`);
    if (!stored.cfgExists) refuse(`missing config: expected ${path.join(root, CONFIG)}`);
    return uninstall({ root, cfg: stored.cfg, dry: !!args['--dry'], commitPlan, probe });
  }
  if (args['--dry']) refuse('--dry needs --uninstall');
  const interactive = !!process.stdin.isTTY && !args['--yes'];
  if (!stored.cfgExists && !interactive && (!args['--yes'] || !args['--ai'])) refuse('non-interactive --global needs --ai and --yes');
  let ais = args['--ai'] || (stored.cfgExists ? stored.cfg.targets.filter(t => t !== 'onboarding').join(',') : 'claude,agents');
  if (interactive && !stored.cfgExists) ais = await ask('Global AIs (claude,agents,gemini,hermes)', ais);
  const targets = ais.split(',').map(s => s.trim()).filter(Boolean);
  if (!targets.length || new Set(targets).size !== targets.length) refuse('choose each global AI once');
  for (const key of targets) if (!Object.hasOwn(TARGETS, key)) refuse(`--global supports only claude, agents, gemini and hermes (unsupported target: ${key})`);
  if (args['--answers'] && args['--defaults']) refuse('--answers and --defaults are exclusive');
  let answers = stored.prevAnswers || onboarding.defaults();
  if (args['--answers']) {
    const file = args['--answers'];
    try { answers = onboarding.validate(JSON.parse(fs.readFileSync(file === '-' ? 0 : path.resolve(file), 'utf8'))); }
    catch (e) { refuse(`--answers: ${e.message}`); }
  }
  const codexTarget = targets.includes('agents') ? resolveCodexTarget(root, profileRoot) : null;
  const old = stored.cfg;
  const installed = { ...(old.installed || {}) };
  const writes = [], removals = [], external = [], pruneExternalDirs = [];
  const read = rel => {
    const found = probe(root, `${SOURCE}/${rel}`);
    if (!found.exists) return null;
    if (!fs.lstatSync(found.full).isFile()) refuse(`${SOURCE}/${rel} is not a regular file`);
    return fs.readFileSync(found.full);
  };
  // Validate the complete previous inventory, including paths omitted by this run.
  for (const rel of Object.keys(installed)) read(rel);
  for (const rel of old.createdDirectories || []) {
    const found = probe(root, `${SOURCE}/${rel}`);
    if (found.exists && !fs.lstatSync(found.full).isDirectory()) refuse(`${rel} is not a directory`);
  }
  renderer.preflightSources(profileRoot);
  const learnedBytes = read('LEARNED.md');
  const plannedLearned = learnedBytes || fs.readFileSync(path.join(__dirname, '../templates/LEARNED.md'));
  const learned = { ...onboarding.parseLearned(decode(plannedLearned, 'LEARNED.md'), 'LEARNED.md'), hash: sha256(plannedLearned) };
  const profile = read('USER.md');
  const user = !profile || (installed['USER.md'] && sha256(profile) === installed['USER.md'])
    ? Buffer.from(onboarding.renderUser(answers, { notesScaffolded: false, entries: learned })) : profile;
  function writeSource(rel, bytes, firstOnly = false) {
    const existing = read(rel);
    if (existing && (firstOnly || installed[rel] !== sha256(existing))) { console.log(`kept   ${SOURCE}/${rel} (edited or pre-existing)`); return; }
    installed[rel] = sha256(bytes);
    writes.push({ rel: `${SOURCE}/${rel}`, bytes });
  }
  writeSource('USER.md', user);
  if (!learnedBytes) writeSource('LEARNED.md', plannedLearned, true);
  const cfg = { ...old, global: true, targets: [...targets, 'onboarding'], level: 1, ruleSet: 'core-5', onboarding: onboarding.sparse(answers), installed,
    createdDirectories: old.createdDirectories || [], globalFiles: { ...(old.globalFiles || {}) }, toolingVersion: require('../package.json').version };
  if (args['--compact']) cfg.compact = true;
  const renderCfg = { ...cfg, onboarding: answers };
  const qualify = text => text
    .replace(/`USER\.md` sits next to `(?:CLAUDE|AGENTS|GEMINI)\.md`\.(?: In (?:Claude Code|Gemini CLI and Google Antigravity), `(?:CLAUDE|GEMINI)\.md` loads automatically;)?/g, 'Read `USER.md` from the global profile source.')
    .replace(/"npx agent-personalizer --dir \.", or "node render\/render\.cjs --dir \." at level 3/g, '"npx agent-personalizer --global"')
    .replace(/(^|[^A-Za-z0-9_./-])(USER\.md|LEARNED\.md|AGENT_ONBOARDING\.md|\.agent-personalizer\.json|\.agent-personalizer\/digest\.md)(?![A-Za-z0-9_/-])/g, (_, prefix, rel) => prefix + path.join(profileRoot, rel));

  // If agents moved between ~/.codex and a custom CODEX_HOME, retire the unedited block at the old location.
  const oldAgents = old.globalFiles?.agents;
  if (codexTarget && oldAgents) {
    const oldFull = oldAgents.path || path.join(root, TARGETS.agents);
    if (oldFull !== codexTarget.full) {
      if (!oldAgents.path) {
        const prevFound = probe(root, TARGETS.agents);
        if (prevFound.exists) {
          if (!fs.lstatSync(prevFound.full).isFile()) refuse(`${TARGETS.agents} is not a regular file`);
          const prevText = decode(fs.readFileSync(prevFound.full), TARGETS.agents);
          const prevMs = renderer.markerState(prevText, TARGETS.agents);
          const prevHash = blockHash(prevText, TARGETS.agents);
          if (prevMs.kind === 'one' && prevHash === oldAgents.blockHash) {
            const stripped = stripOwnedBlock(prevText, prevMs, oldAgents);
            if (oldAgents.created && stripped === '') removals.push({ rel: TARGETS.agents });
            else writes.push({ rel: TARGETS.agents, bytes: Buffer.from(stripped) });
          } else if (prevMs.kind === 'one') console.log(`kept   ${TARGETS.agents} (edited)`);
        }
      } else {
        const prevBytes = readExternalFile(oldAgents.path, oldAgents.path);
        if (prevBytes) {
          const prevText = decode(prevBytes, oldAgents.path);
          const prevMs = renderer.markerState(prevText, oldAgents.path);
          const prevHash = blockHash(prevText, oldAgents.path);
          if (prevMs.kind === 'one' && prevHash === oldAgents.blockHash) {
            const stripped = stripOwnedBlock(prevText, prevMs, oldAgents);
            if (oldAgents.created && stripped === '') external.push({ base: path.dirname(oldAgents.path), missingDirs: [], file: path.basename(oldAgents.path), remove: true });
            else external.push({ base: path.dirname(oldAgents.path), missingDirs: [], file: path.basename(oldAgents.path), bytes: Buffer.from(stripped) });
            for (const d of oldAgents.createdDirs || []) pruneExternalDirs.push(d);
          } else if (prevMs.kind === 'one') console.log(`kept   ${oldAgents.path} (edited)`);
        }
      }
    }
  }

  const rendered = renderer.renderedContents(profileRoot, renderCfg, { profileSource: decode(user, 'USER.md'), learned, boilerplate: qualify });
  for (const entry of rendered) {
    if (entry.key === 'onboarding') { writeSource(entry.rel, Buffer.from(renderer.splice(null, entry.block, entry.rel))); continue; }
    const isExternalAgents = entry.key === 'agents' && codexTarget && codexTarget.external;
    const label = isExternalAgents ? codexTarget.full : TARGETS[entry.key];
    let text = null, exists = false;
    if (isExternalAgents) {
      const existingBytes = fs.existsSync(codexTarget.full) ? fs.readFileSync(codexTarget.full) : null;
      exists = !!existingBytes;
      if (existingBytes) text = decode(existingBytes, label);
    } else {
      const found = probe(root, label);
      exists = found.exists;
      if (found.exists && !fs.lstatSync(found.full).isFile()) refuse(`${label} is not a regular file`);
      if (found.exists) text = decode(fs.readFileSync(found.full), label);
    }
    const ms = text === null ? { kind: 'none' } : renderer.markerState(text, label);
    if (ms.kind === 'malformed') refuse(`${label}: malformed marker block`);
    const samePriorPath = Object.hasOwn(cfg.globalFiles, entry.key)
      && ((entry.key !== 'agents') || (cfg.globalFiles.agents?.path || path.join(root, TARGETS.agents)) === (isExternalAgents ? codexTarget.full : path.join(root, TARGETS.agents)));
    if (ms.kind === 'one' && !samePriorPath) {
      refuse(`${label}: foreign agent-personalizer block; remove the block from <!-- agent-personalizer:begin --> through <!-- agent-personalizer:end -->, then re-run --global. Nothing was written`);
    }
    const block = `Profile source: \`${path.join(profileRoot, 'USER.md')}\`. Read \`${path.join(profileRoot, 'AGENT_ONBOARDING.md')}\` for working preferences.\n\n` + entry.block;
    const output = renderer.splice(text, block, label);
    if (output.length > renderer.FILE_BUDGET) console.log(`OVER BUDGET  ${label} (${output.length} characters, budget ${renderer.FILE_BUDGET}; --compact shortens rules)`);
    if (renderer.markerState(output, label).kind !== 'one' || renderer.between(output, label) !== block) refuse(`${label}: generated block would not re-parse; nothing was written`);
    const prior = ms.kind === 'one' && samePriorPath ? cfg.globalFiles[entry.key] : null;
    const meta = { created: !exists || !!prior?.created, blockHash: blockHash(output, label), fileHash: sha256(Buffer.from(output)),
      appended: prior ? prior.appended : ms.kind === 'none', separator: prior ? prior.separator : (text === null ? '' : text.endsWith('\n') ? '\n' : '\n\n') };
    if (isExternalAgents) {
      meta.path = codexTarget.full;
      if (prior?.createdDirs?.length) meta.createdDirs = [...prior.createdDirs];
      external.push({ base: codexTarget.base, missingDirs: codexTarget.missingDirs, file: codexTarget.file, bytes: Buffer.from(output), report: `update ${label} (global profile)` });
    } else {
      writes.push({ rel: label, bytes: Buffer.from(output), report: `update ${label} (global profile)` });
    }
    cfg.globalFiles[entry.key] = meta;
  }
  const learnRequested = interactive && !stored.cfgExists ? await require('./learn.cjs').requestConsent({ allProjects: true }) : false;
  const outputPaths = new Set([CONFIG, ...writes.map(p => p.rel), ...removals.map(p => p.rel)]);
  await commitPlan(root, { writes, removals, external, outputPaths,
    prepare(newDirectories, externalNewDirs = []) {
      if (codexTarget?.external && cfg.globalFiles.agents && externalNewDirs.length) {
        cfg.globalFiles.agents.createdDirs = [...new Set([...(cfg.globalFiles.agents.createdDirs || []), ...externalNewDirs])];
      }
      cfg.globalDirectories = [...new Set([...(old.globalDirectories || []), ...[...newDirectories].filter(rel => [SOURCE, '.claude', '.codex', '.gemini', '.hermes'].includes(rel))])].sort();
      writes.push({ rel: CONFIG, bytes: Buffer.from(JSON.stringify(cfg, null, 2) + '\n') });
    }
  });
  for (const dir of pruneExternalDirs.sort((a, b) => b.length - a.length)) {
    try {
      const chain = walkRealChain(dir, { allowDarwinRootLink: false, action: 'nothing was removed' });
      if (!chain.missingDirs.length && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (_) {}
  }
  if (codexTarget && hasNonEmptyOverride(codexTarget.dir)) {
    console.warn(`Warning: ${path.join(codexTarget.dir, 'AGENTS.override.md')} is non-empty and overrides ${codexTarget.full} in Codex; Codex ignores AGENTS.md in that directory while AGENTS.override.md has content.`);
  }
  if (targets.includes('hermes') && process.env.HERMES_HOME) {
    let hermesHome = path.resolve(process.env.HERMES_HOME);
    try { hermesHome = fs.realpathSync(hermesHome); } catch (_) {}
    if (hermesHome !== path.join(root, '.hermes')) console.warn('Warning: Hermes reads SOUL.md from HERMES_HOME; the block was written to ~/.hermes/SOUL.md.');
  }
  if (learnRequested) await require('./learn.cjs').learn({ dir: profileRoot, consented: true, allProjects: true });
  console.log(`Global profile installed. Re-run with --global after editing ${profileRoot}.`);
}

async function uninstall({ root, cfg, dry, commitPlan, probe }) {
  validateInventory(cfg);
  const writes = [], removals = [], external = [], retained = [], externalDirs = [];
  const read = rel => {
    const found = probe(root, rel);
    if (!found.exists) return null;
    if (!fs.lstatSync(found.full).isFile()) refuse(`${rel} is not a regular file; nothing was removed`);
    return fs.readFileSync(found.full);
  };
  for (const [key, owned] of Object.entries(cfg.globalFiles || {})) {
    if (owned.path) {
      const bytes = readExternalFile(owned.path, owned.path, 'nothing was removed');
      for (const d of owned.createdDirs || []) externalDirs.push(d);
      if (!bytes) continue;
      const text = decode(bytes, owned.path), ms = renderer.markerState(text, owned.path);
      const currentHash = blockHash(text, owned.path);
      if (ms.kind === 'none') continue;
      if (currentHash !== owned.blockHash) { retained.push(owned.path); continue; }
      const output = stripOwnedBlock(text, ms, owned);
      if (owned.created && output === '') external.push({ base: path.dirname(owned.path), missingDirs: [], file: path.basename(owned.path), remove: true, display: owned.path });
      else external.push({ base: path.dirname(owned.path), missingDirs: [], file: path.basename(owned.path), bytes: Buffer.from(output), display: owned.path });
      continue;
    }
    const rel = TARGETS[key], bytes = read(rel);
    if (!bytes) continue;
    const text = decode(bytes, rel), ms = renderer.markerState(text, rel);
    const currentHash = blockHash(text, rel);
    if (ms.kind === 'none') continue;
    if (currentHash !== owned.blockHash) { retained.push(rel); continue; }
    const output = stripOwnedBlock(text, ms, owned);
    if (owned.created && output === '') removals.push({ rel });
    else writes.push({ rel, bytes: Buffer.from(output) });
  }
  for (const [rel, hash] of Object.entries(cfg.installed || {})) {
    const fullRel = `${SOURCE}/${rel}`, bytes = read(fullRel);
    if (!bytes) continue;
    if (sha256(bytes) === hash) removals.push({ rel: fullRel });
    else retained.push(fullRel);
  }
  const directories = [...(cfg.globalDirectories || []), ...(cfg.createdDirectories || []).map(rel => `${SOURCE}/${rel}`)];
  for (const rel of directories) {
    const found = probe(root, rel);
    if (found.exists && !fs.lstatSync(found.full).isDirectory()) refuse(`${rel} is not a directory`);
  }
  for (const dir of externalDirs) {
    walkRealChain(dir, { allowDarwinRootLink: false, action: 'nothing was removed' });
  }
  if (!retained.length) removals.push({ rel: CONFIG });
  for (const rel of retained) console.log(`kept   ${rel} (edited)`);
  if (dry) {
    for (const p of [...writes, ...removals]) console.log(`would ${p.bytes ? 'update' : 'remove'} ${p.rel}`);
    for (const ext of external) console.log(`would ${ext.remove ? 'remove' : 'update'} ${ext.display}`);
    return;
  }
  const outputPaths = new Set([...writes, ...removals].map(p => p.rel));
  await commitPlan(root, { writes, removals, external, outputPaths });
  for (const dir of externalDirs.sort((a, b) => b.length - a.length)) {
    const chain = walkRealChain(dir, { allowDarwinRootLink: false, action: 'nothing was removed' });
    if (!chain.missingDirs.length && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  for (const rel of directories.sort((a, b) => b.split('/').length - a.split('/').length)) {
    const found = probe(root, rel);
    if (found.exists && fs.readdirSync(found.full).length === 0) fs.rmdirSync(found.full);
  }
  console.log(retained.length ? 'Global configuration kept for review of edited files.' : 'Global profile uninstalled.');
}
module.exports = { run };
