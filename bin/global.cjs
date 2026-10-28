'use strict';
// Global targets have fixed home-relative names; profile ownership stays inside its own folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const renderer = require('../render/render.cjs');
const onboarding = require('../render/onboarding.cjs');
const { sha256, validateInventory } = require('./install-plan.cjs');
const SOURCE = '.agent-personalizer';
const CONFIG = `${SOURCE}/.agent-personalizer.json`;
const TARGETS = { claude: '.claude/CLAUDE.md', agents: '.codex/AGENTS.md', gemini: '.gemini/GEMINI.md' };
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
function validateGlobal(cfg) {
  if (!cfg.global || cfg.level !== 1) refuse('global profile config must identify a level-1 global install');
  for (const target of cfg.targets || []) if (!Object.hasOwn(TARGETS, target) && target !== 'onboarding') refuse(`unsupported global target: ${target}`);
  if (cfg.globalFiles !== undefined && (!cfg.globalFiles || typeof cfg.globalFiles !== 'object' || Array.isArray(cfg.globalFiles))) refuse('invalid global target inventory');
  for (const [key, info] of Object.entries(cfg.globalFiles || {})) {
    if (!Object.hasOwn(TARGETS, key) || !info || typeof info.created !== 'boolean' || !HASH.test(info.blockHash) || !HASH.test(info.fileHash)
        || !['', '\n', '\n\n'].includes(info.separator) || typeof info.appended !== 'boolean') refuse('invalid global target ownership');
  }
  if (cfg.globalDirectories !== undefined && (!Array.isArray(cfg.globalDirectories) || cfg.globalDirectories.some(rel => ![SOURCE, '.claude', '.codex', '.gemini'].includes(rel)))) refuse('invalid global directory inventory');
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
  const home = os.homedir();
  const info = fs.lstatSync(home);
  if (info.isSymbolicLink() || !info.isDirectory()) refuse('global home must be a real directory, never a symlink');
  const root = fs.realpathSync(home);
  const source = probe(root, SOURCE);
  if (source.exists && !fs.lstatSync(source.full).isDirectory()) refuse(`${SOURCE} is not a directory`);
  const profileRoot = path.join(root, SOURCE);
  const stored = readConfig(profileRoot, 1);
  if (stored.cfgExists) validateGlobal(stored.cfg);
  if (args.command === 'learn') {
    for (const opt of ['--ai', '--level', '--answers', '--defaults', '--quick', '--full', '--uninstall', '--dry']) if (opt in args) refuse(`${opt} is not a learn option`);
    if (args['--forget'] && (args['--all-projects'] || args['--yes'])) refuse('--forget cannot be combined with --all-projects or --yes');
    if (!stored.cfgExists) refuse(`missing config: expected ${path.join(root, CONFIG)}`);
    const learning = require('./learn.cjs');
    return args['--forget'] ? learning.forget(profileRoot) : learning.learn({ dir: profileRoot, yes: !!args['--yes'], allProjects: true });
  }
  if (args['--forget'] || args['--all-projects']) refuse('--forget and --all-projects need learn');
  if (args['--uninstall']) {
    for (const opt of ['--ai', '--level', '--answers', '--defaults', '--quick', '--full']) if (opt in args) refuse(`${opt} is an install option; --uninstall reads the stored config`);
    if (!stored.cfgExists) refuse(`missing config: expected ${path.join(root, CONFIG)}`);
    return uninstall({ root, cfg: stored.cfg, dry: !!args['--dry'], commitPlan, probe });
  }
  if (args['--dry']) refuse('--dry needs --uninstall');
  const interactive = !!process.stdin.isTTY && !args['--yes'];
  if (!stored.cfgExists && !interactive && (!args['--yes'] || !args['--ai'])) refuse('non-interactive --global needs --ai and --yes');
  let ais = args['--ai'] || (stored.cfgExists ? stored.cfg.targets.filter(t => t !== 'onboarding').join(',') : 'claude,agents');
  if (interactive && !stored.cfgExists) ais = await ask('Global AIs (claude,agents,gemini)', ais);
  const targets = ais.split(',').map(s => s.trim()).filter(Boolean);
  if (!targets.length || new Set(targets).size !== targets.length) refuse('choose each global AI once');
  for (const key of targets) if (!Object.hasOwn(TARGETS, key)) refuse(`--global supports only claude, agents and gemini (unsupported target: ${key})`);
  if (args['--answers'] && args['--defaults']) refuse('--answers and --defaults are exclusive');
  let answers = stored.prevAnswers || onboarding.defaults();
  if (args['--answers']) {
    const file = args['--answers'];
    try { answers = onboarding.validate(JSON.parse(fs.readFileSync(file === '-' ? 0 : path.resolve(file), 'utf8'))); }
    catch (e) { refuse(`--answers: ${e.message}`); }
  }
  const old = stored.cfg;
  const installed = { ...(old.installed || {}) };
  const writes = [];
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
  const renderCfg = { ...cfg, onboarding: answers };
  const rendered = renderer.renderedContents(profileRoot, renderCfg, { profileSource: decode(user, 'USER.md'), learned });
  const qualify = text => text
    .replace(/`USER\.md` sits next to `(?:CLAUDE|AGENTS)\.md`\./g, 'Read `USER.md` from the global profile source.')
    .replace(/"npx agent-personalizer --dir \.", or "node render\/render\.cjs --dir \." at level 3/g, '"npx agent-personalizer --global"')
    .replace(/(^|[^A-Za-z0-9_./-])(USER\.md|LEARNED\.md|AGENT_ONBOARDING\.md|\.agent-personalizer\.json|\.agent-personalizer\/digest\.md)(?![A-Za-z0-9_/-])/g, (_, prefix, rel) => prefix + path.join(profileRoot, rel));
  for (const entry of rendered) {
    if (entry.key === 'onboarding') { writeSource(entry.rel, Buffer.from(renderer.splice(null, qualify(entry.block), entry.rel))); continue; }
    const rel = TARGETS[entry.key];
    const found = probe(root, rel);
    if (found.exists && !fs.lstatSync(found.full).isFile()) refuse(`${rel} is not a regular file`);
    const text = found.exists ? decode(fs.readFileSync(found.full), rel) : null;
    const ms = text === null ? { kind: 'none' } : renderer.markerState(text, rel);
    if (ms.kind === 'malformed') refuse(`${rel}: malformed marker block`);
    const block = `Profile source: \`${path.join(profileRoot, 'USER.md')}\`. Read \`${path.join(profileRoot, 'AGENT_ONBOARDING.md')}\` for working preferences.\n\n` + qualify(entry.block);
    const output = renderer.splice(text, block, rel);
    if (renderer.markerState(output, rel).kind !== 'one' || renderer.between(output, rel) !== block) refuse(`${rel}: generated block would not re-parse; nothing was written`);
    const prior = ms.kind === 'one' ? cfg.globalFiles[entry.key] : null;
    cfg.globalFiles[entry.key] = { created: !found.exists || !!cfg.globalFiles[entry.key]?.created, blockHash: blockHash(output, rel), fileHash: sha256(Buffer.from(output)),
      appended: prior ? prior.appended : ms.kind === 'none', separator: prior ? prior.separator : (text === null ? '' : text.endsWith('\n') ? '\n' : '\n\n') };
    writes.push({ rel, bytes: Buffer.from(output), report: `update ${rel} (global profile)` });
  }
  const learnRequested = interactive && !stored.cfgExists ? await require('./learn.cjs').requestConsent({ allProjects: true }) : false;
  const outputPaths = new Set([CONFIG, ...writes.map(p => p.rel)]);
  await commitPlan(root, { writes, outputPaths,
    prepare(newDirectories) {
      cfg.globalDirectories = [...new Set([...(old.globalDirectories || []), ...[...newDirectories].filter(rel => [SOURCE, '.claude', '.codex', '.gemini'].includes(rel))])].sort();
      writes.push({ rel: CONFIG, bytes: Buffer.from(JSON.stringify(cfg, null, 2) + '\n') });
    }
  });
  if (learnRequested) await require('./learn.cjs').learn({ dir: profileRoot, consented: true, allProjects: true });
  console.log(`Global profile installed. Re-run with --global after editing ${profileRoot}.`);
}

async function uninstall({ root, cfg, dry, commitPlan, probe }) {
  validateInventory(cfg);
  const writes = [], removals = [], retained = [];
  const read = rel => {
    const found = probe(root, rel);
    if (!found.exists) return null;
    if (!fs.lstatSync(found.full).isFile()) refuse(`${rel} is not a regular file; nothing was removed`);
    return fs.readFileSync(found.full);
  };
  for (const [key, owned] of Object.entries(cfg.globalFiles || {})) {
    const rel = TARGETS[key], bytes = read(rel);
    if (!bytes) continue;
    const text = decode(bytes, rel), ms = renderer.markerState(text, rel);
    const currentHash = blockHash(text, rel);
    if (ms.kind === 'none') continue;
    if (currentHash !== owned.blockHash) { retained.push(rel); continue; }
    let before = text.slice(0, ms.bStart), after = text.slice(ms.eEnd);
    if (after.startsWith('\r\n')) after = after.slice(2);
    else if (after.startsWith('\n')) after = after.slice(1);
    if (owned.appended) {
      if (owned.separator && before.endsWith(owned.separator)) before = before.slice(0, -owned.separator.length);
    }
    const output = before + after;
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
  if (!retained.length) removals.push({ rel: CONFIG });
  for (const rel of retained) console.log(`kept   ${rel} (edited)`);
  if (dry) {
    for (const p of [...writes, ...removals]) console.log(`would ${p.bytes ? 'update' : 'remove'} ${p.rel}`);
    return;
  }
  const outputPaths = new Set([...writes, ...removals].map(p => p.rel));
  await commitPlan(root, { writes, removals, outputPaths });
  for (const rel of directories.sort((a, b) => b.split('/').length - a.split('/').length)) {
    const found = probe(root, rel);
    if (found.exists && fs.readdirSync(found.full).length === 0) fs.rmdirSync(found.full);
  }
  console.log(retained.length ? 'Global configuration kept for review of edited files.' : 'Global profile uninstalled.');
}
module.exports = { run };
