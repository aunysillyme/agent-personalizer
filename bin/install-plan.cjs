'use strict';
// Shared, read-only recipe and ownership checks. Recorded hashes are the owning inventory;
// the static release table recognizes untouched copies from before hashes were recorded.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PKG = path.resolve(__dirname, '..');
const onboarding = require('../render/onboarding.cjs');
const RUNTIME_FILES = ['render/render.cjs', 'render/targets.json', 'render/onboarding.cjs', 'hooks/README.md', 'hooks/claude-code/session-start.sh', 'check/gate.cjs', 'check/forbidden.example.txt'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stripSignature = text => text.split('\n').filter(line => !line.includes('40-sign-every-edit.md') && !/^`?Last edited by:/.test(line)).join('\n');

function recordedHash(cfg, rel) {
  return cfg.installed && Object.hasOwn(cfg.installed, rel) ? cfg.installed[rel] : undefined;
}
function validateInventory(cfg) {
  if ('installed' in cfg && (!cfg.installed || typeof cfg.installed !== 'object' || Array.isArray(cfg.installed))) throw new Error('"installed" must be a path-to-sha256 object');
  const validPath = rel => typeof rel === 'string' && rel && !path.isAbsolute(rel) && !rel.includes('\\') && !rel.split('/').some(p => !p || p === '.' || p === '..');
  for (const [rel, hash] of Object.entries(cfg.installed || {})) {
    if (!validPath(rel) || rel === '.agent-personalizer.json') throw new Error(`invalid installed path ${JSON.stringify(rel)}`);
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`invalid installed sha256 for ${rel}`);
  }
  if ('createdDirectories' in cfg && (!Array.isArray(cfg.createdDirectories) || cfg.createdDirectories.some(rel => !validPath(rel)) || new Set(cfg.createdDirectories).size !== cfg.createdDirectories.length)) throw new Error('"createdDirectories" must be a unique list of relative paths');
  if ('toolingVersions' in cfg && (!cfg.toolingVersions || typeof cfg.toolingVersions !== 'object' || Array.isArray(cfg.toolingVersions))) throw new Error('"toolingVersions" must be an object');
}
function knownVersions(rel, bytes) {
  const hashes = require('./known-hashes.json').files[rel] || {};
  const hash = sha256(bytes);
  return Object.entries(hashes).filter(([, variants]) => Object.values(variants).includes(hash)).map(([version]) => version.slice(1));
}
function ownership(cfg, rel, bytes, { legacy = false, expected } = {}) {
  const recorded = recordedHash(cfg, rel);
  const versions = knownVersions(rel, bytes);
  const version = (cfg.toolingVersions || {})[rel] || cfg.toolingVersion || versions.at(-1);
  return { unedited: recorded !== undefined ? sha256(bytes) === recorded : legacy && (versions.length > 0 || (expected && bytes.equals(expected))), version };
}

// Match one semantic pointer slot at a time, then compare the whole original line.
// Splitting retains every line terminator so a kept user line is byte-for-byte unchanged.
function migrateHome(current, previous, next, markerState) {
  const key = line => {
    if (/^- Notes(?: the|:)/.test(line)) return 'notes';
    if (/^- Session log/.test(line)) return 'sessions';
    if (/^- Decisions log/.test(line)) return 'decisions';
    if (/^- Inbox/.test(line)) return 'inbox';
    if (/^- Rules, one file each/.test(line)) return 'rules';
    const standing = /^- ([^.]+)\..*\[owner:/.exec(line);
    return standing ? `rule:${standing[1]}` : null;
  };
  const template = text => text.split('\n').map(line => ({ key: key(line), text: line })).filter(line => line.key);
  const before = template(previous), after = template(next);
  const old = new Map(before.map(line => [line.key, line.text]));
  const fresh = new Map(after.map(line => [line.key, line.text]));
  const ms = markerState(current);
  let offset = 0;
  const lines = (current.match(/[^\n]*(?:\n|$)/g) || []).filter(Boolean).map(raw => {
    const line = { raw, text: raw.endsWith('\n') ? raw.slice(0, -1) : raw, outside: ms.kind !== 'one' || offset < ms.bStart || offset >= ms.eEnd };
    offset += raw.length;
    return line;
  });
  const edited = [];
  let changed = false;
  for (const [id, text] of old) {
    const replacement = fresh.get(id);
    const matches = lines.filter(line => line.outside && line.text === text);
    if (!matches.length) {
      for (const line of lines) if (line.outside && key(line.text) === id) edited.push(line.text);
      continue;
    }
    if (text === replacement) continue;
    for (const line of matches) {
      line.raw = replacement === undefined ? '' : replacement + (line.raw.endsWith('\n') ? '\n' : '');
      line.text = replacement || '';
      changed = true;
    }
  }
  for (let i = 0; i < after.length; i++) {
    const entry = after[i];
    if (old.has(entry.key) || lines.some(line => line.outside && line.text === entry.text)) continue;
    let anchor = -1;
    for (let j = i - 1; j >= 0 && anchor === -1; j--) anchor = lines.findLastIndex(line => line.outside && key(line.text) === after[j].key && line.raw);
    // The rules-directory pointer goes immediately after the onboarding pointer.
    if (anchor === -1 && entry.key === 'rules') anchor = lines.findIndex(line => line.outside && /^- Agent onboarding /.test(line.text));
    if (anchor === -1) { edited.push(`missing pointer: ${entry.text}`); continue; }
    const ending = lines[anchor].raw.endsWith('\n') ? '\n' : '';
    if (!ending) { edited.push(`missing pointer: ${entry.text}`); continue; }
    lines.splice(anchor + 1, 0, { raw: entry.text + '\n', text: entry.text, outside: true });
    changed = true;
  }
  return { text: lines.map(line => line.raw).join(''), edited, changed };
}

function installPlan({ answers, level, targets, notesScaffolded }) {
  const base = onboarding.baseFor(answers);
  const kind = onboarding.kindOf(answers);
  const plan = [];                                        // { rel, src | text }
  // signature=no: the signature rule file is not installed (a `requires:` rule that is absent cannot drift back in),
  // and every copied markdown loses its `Last edited by:` template line and its pointer to the rule.
  const noSig = answers.signature === 'no';
  const stripSig = (t) => noSig ? stripSignature(t) : t;
  const mdCopy = (rel, src) => plan.push({ rel, text: stripSig(fs.readFileSync(src, 'utf8')) });
  // rules/ is copied at level 3, where it becomes yours to edit; levels 1 and 2 render from the package's rules
  if (level >= 3) for (const f of fs.readdirSync(path.join(PKG, 'rules')).sort()) {
    if (noSig && f === '40-sign-every-edit.md') continue;
    mdCopy(`rules/${f}`, path.join(PKG, 'rules', f));
  }
  // The home templates carry four `notes/...` pointer lines. They collapse to ONE line whenever the
  // folder they name will not be there to read: a cloud notes tool has no local folder at all, and no
  // level below 2 creates one, so a level-1 install used to hand the first session four broken
  // pointers. NOTES_ONE_LINE is also what the level-2 upgrade looks for, byte for byte.
  const NOTES_ONE_LINE = (why) => `- Notes: see \`AGENT_ONBOARDING.md\` § Where you may write (${why})`;
  const NOTES_LATER = `no local notes folder at level 1; level 2 creates \`${base}/\``;
  // Is the folder every notes pointer names going to be there to read? The README is the file the AI
  // is told to read before it writes, and the level-2 scaffold creates it with the folder. The LEVEL
  // alone is a proxy that is wrong in both directions: a level-1 install can land beside a notes
  // folder that already exists, and a re-run at a lower level does not delete what a higher one made
  // (round 1, findings 4 and 5). One boolean drives the home-file collapse and both rendered files,
  // so they can never disagree about the same folder.
  const notesWhy = kind === 'cloud' ? 'reached through its connector, no local files'
    : !notesScaffolded ? NOTES_LATER
    : kind !== 'disk' ? 'local fallback folder `notes/`'
    : null;                                               // disk, scaffold present: the four paths, retargeted at notes_path
  const home = (name) => {
    let t = fs.readFileSync(path.join(PKG, 'templates', name), 'utf8');
    if (level < 3) {
      // no local rules/: the pointers point at the rendered block below, which carries the full text
      t = t.split('\n').filter(l => !/Rules, one file each, the owning copy/.test(l)).join('\n');
      t = t.replace(/`\[owner: rules\/[^\]]+\]`/g, '`[owner: the rendered block below]`');
    }
    if (notesWhy) {
      let done = false;
      t = t.split('\n').filter(l => { if (!/`notes\//.test(l)) return true; if (done) return false; done = true; return true; })
        .map(l => /`notes\//.test(l) ? NOTES_ONE_LINE(notesWhy) : l).join('\n');
    } else if (base !== 'notes') t = t.replace(/\bnotes\//g, `${base}/`);
    return stripSig(t);
  };
  const POINTER = 'pointer file; the renderer fills its block below';
  if (targets.includes('claude')) plan.push({ rel: 'CLAUDE.md', text: home('CLAUDE.md'), note: POINTER });
  if (targets.includes('agents')) plan.push({ rel: 'AGENTS.md', text: home('AGENTS.md'), note: POINTER });
  if (level >= 2 && kind !== 'cloud') {                   // a cloud tool's notes are not local files; no folder named after a workspace
    mdCopy(`${base}/README.md`, path.join(PKG, 'templates', 'FOLDER_README.md'));
    mdCopy(`${base}/sessions/TEMPLATE-week.md`, path.join(PKG, 'templates', 'session-log.md'));
    mdCopy(`${base}/decisions.md`, path.join(PKG, 'templates', 'decisions-log.md'));
    mdCopy(`${base}/inbox/README.md`, path.join(PKG, 'templates', 'INBOX_README.md'));
  }
  if (level >= 3) {
    for (const rel of RUNTIME_FILES)
      plan.push({ rel, src: path.join(PKG, rel) });
  }

  return { plan, stripSig, notesWhy, NOTES_ONE_LINE, NOTES_LATER };
}

module.exports = { installPlan, RUNTIME_FILES, stripSignature, sha256, recordedHash, validateInventory, knownVersions, ownership, migrateHome };
