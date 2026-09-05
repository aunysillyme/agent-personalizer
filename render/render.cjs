#!/usr/bin/env node
'use strict';
/*
  render.cjs: USER.md + rules/*.md  ->  per-AI instruction files.

  usage:
    node render/render.cjs [--dir <project>] [--targets claude,agents,gemini,chatgpt,prompt] [--check]
    node render/render.cjs [--dir <project>] --contract [--contract-target claude] [--no-personal]

  --dir               project folder holding USER.md and rules/ (default: cwd). The folder you
                      name is followed once (realpath); nothing beneath it may be a symlink.
  --targets           which renders to write; default: <dir>/.agent-personalizer.json, else "claude,agents".
                      The "onboarding" target renders AGENT_ONBOARDING.md from the interview answers
                      stored in .agent-personalizer.json (render/onboarding.cjs).
  --check             render to memory, compare with disk; exit 1 on drift, 0 clean
  --contract          print the inject:true rules for one target to stdout (session-start hooks):
                      the onboarding block (how to work with this person) when answers exist and
                      personal content is allowed, then each rule: universal, personal (same
                      condition), then the target's binding block.
  --contract-target   which target's surface filter, personal policy and binding to use (default claude)

  Rules render from the interview answers as well as the profile: a rule whose frontmatter says
  `requires: <answer>=<value>` is left out of every render and every contract when the stored
  answer differs (no stored answers = the defaults). The ChatGPT target, when answers exist,
  renders a compact profile and the contract block plus the inject:true rules, sized for its
  two boxes; without answers it falls back to the full profile and every rule for that surface.

  Rendered text lives between two marker lines inside each target file. Bytes outside the
  markers are preserved exactly (line endings included); a target that is not valid UTF-8 is
  refused rather than re-encoded (sources too). Outputs are staged beside their targets under
  per-run random names with the target's own mode (0644 for new files), existing targets are
  backed up, and a failure at any point restores every target and removes every staged file.
  If a restore itself fails, the backup is kept and named, and the exit is 2 with ROLLBACK
  INCOMPLETE on stderr; a backup is never deleted unless its target was restored or committed.
  A cleanup that fails (a staged file or a backup that cannot be removed) is named on stderr
  with exit 2, never silently ignored. Backups carry the target's mode regardless of umask. The renderer refuses to write when
  the marker state is anything other than "no block yet" or "exactly one BEGIN followed by
  exactly one END", and it validates every target before writing any.

  Safety: sources (USER.md, rules/, each rule file) and targets must be regular files or
  directories inside the real project folder, never symlinks. Marker tokens are rejected
  inside sources; markers inside a fenced code block in a TARGET are ignored. rules/ must exist.
  Frontmatter keys are whitelisted; unknown, duplicate, malformed or CRLF
  frontmatter is an error, never a silent default. Unexpected .md files in rules/ are an
  error. No network. No environment variables read. No secrets written.

  exit codes: 0 ok · 1 drift (--check) · 2 refused or invalid input
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const onboarding = require('./onboarding.cjs');

class Refusal extends Error {}
/* die(): exit 2 with the reason. When a caller (the installer's preflight) sets module.exports.DIE_THROWS,
   the same refusal is thrown as a Refusal instead, so the caller can add its own context and exit. */
function die(msg) { if (module.exports && module.exports.DIE_THROWS) throw new Refusal(msg); console.error(`render: ${msg}`); process.exit(2); }


const BEGIN = '<!-- agent-personalizer:begin -->';
const END = '<!-- agent-personalizer:end -->';
function readJson(file, what) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { die(`${what}: cannot read ${file} (${e.code || e.message})`); }
  try { return JSON.parse(text); } catch (e) { die(`${what}: ${file} is not valid JSON (${e.message})`); }
}
const TARGETS = readJson(path.join(__dirname, 'targets.json'), 'targets');
if (!TARGETS || typeof TARGETS !== 'object' || Array.isArray(TARGETS) || !Object.keys(TARGETS).length) die('targets: targets.json must be a non-empty object');
for (const [k, t] of Object.entries(TARGETS)) if (!t || typeof t !== 'object' || typeof t.file !== 'string') die(`targets: target "${k}" needs a string "file"`);
const KNOWN = Object.keys(TARGETS);
const BINDINGS = new Set(Object.values(TARGETS).map(t => t.binding).filter(Boolean));
const SECTION_RE = /^(universal|personal|origin|binding:[a-z]+)$/;
const META_KEYS = new Set(['id', 'title', 'inject', 'surfaces', 'requires']);
const RULE_FILE_RE = /^\d{2}-[A-Za-z0-9._-]+\.md$/;


const VALUE_OPTS = ['--dir', '--targets', '--contract-target'];
const FLAG_OPTS = ['--check', '--contract', '--no-personal'];
/* Parse argv once, strictly: value options at most once each, flags at most once, nothing unknown. */
function parseArgs() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_OPTS.includes(a)) {
      if (a in out) die(`${a} given more than once`);
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) die(`${a} needs a non-empty value`);
      out[a] = v; i++;
    } else if (FLAG_OPTS.includes(a)) {
      if (a in out) die(`${a} given more than once`);
      out[a] = true;
    } else die(`unknown option "${a}" (known: ${[...VALUE_OPTS, ...FLAG_OPTS].join(', ')})`);
  }
  return out;
}
let ARGS = null;
function arg(name, dflt) { if (!ARGS) ARGS = parseArgs(); return name in ARGS ? ARGS[name] : dflt; }

/* lstat helper: the entry must exist as a regular file or directory, not a symlink. */
function mustBe(p, kind, where) {
  let st;
  try { st = fs.lstatSync(p); } catch (_) { return null; }
  if (st.isSymbolicLink()) die(`${where} is a symlink; refusing to follow it`);
  if (kind === 'file' && !st.isFile()) die(`${where} is not a regular file`);
  if (kind === 'dir' && !st.isDirectory()) die(`${where} is not a directory`);
  return st;
}

function parseFrontmatter(text, where) {
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const close = text.indexOf('\n---\n', 4);
  if (close === -1) die(`${where}: frontmatter opened with --- but never closed`);
  const meta = {};
  for (const line of text.slice(4, close).split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) die(`${where}: unreadable frontmatter line "${line}"`);
    const key = kv[1];
    if (!META_KEYS.has(key)) die(`${where}: unknown frontmatter key "${key}" (allowed: ${[...META_KEYS].join(', ')})`);
    if (key in meta) die(`${where}: duplicate frontmatter key "${key}"`);
    let v = kv[2].trim();
    if (v.startsWith('[')) {
      if (!v.endsWith(']')) die(`${where}: frontmatter list "${key}" is not closed`);
      v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    meta[key] = v;
  }
  if ('surfaces' in meta) {
    if (!Array.isArray(meta.surfaces) || !meta.surfaces.length) die(`${where}: "surfaces" must be a non-empty list`);
    const bad = meta.surfaces.filter(s => !KNOWN.includes(s));
    if (bad.length) die(`${where}: unknown surface(s) ${bad.join(', ')} (known: ${KNOWN.join(', ')})`);
  }
  if ('inject' in meta && typeof meta.inject !== 'boolean') die(`${where}: "inject" must be true or false`);
  if ('requires' in meta) {
    const m = typeof meta.requires === 'string' && meta.requires.match(/^([a-z_]+)=([A-Za-z0-9_-]+)$/);
    if (!m) die(`${where}: "requires" must read <answer>=<value>, e.g. signature=yes`);
    const q = onboarding.QUESTIONS.find(x => x.id === m[1]);
    if (!q) die(`${where}: "requires" names an unknown answer "${m[1]}"`);
    if (q.type !== 'choice' || !q.options.some(o => o[0] === m[2])) die(`${where}: "requires" value "${m[2]}" is not a choice for "${m[1]}" (${q.type === 'choice' ? q.options.map(o => o[0]).join(', ') : 'not a choice question'})`);
    meta.requires = { answer: m[1], value: m[2] };
  }
  for (const k of ['id', 'title']) if (k in meta && (typeof meta[k] !== 'string' || !meta[k].trim())) die(`${where}: "${k}" must be non-empty text`);
  return { meta, body: text.slice(close + 5) };
}

function parseSections(body, where) {
  const sections = {};
  let current = null;
  const lines = body.split('\n');
  const fenced = fenceMap(lines, where);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = fenced[i] ? null : line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const name = h[1].trim();
      if (!SECTION_RE.test(name)) die(`${where}: unknown section "## ${name}" (allowed: universal, personal, origin, binding:<ai>)`);
      if (name.startsWith('binding:') && !BINDINGS.has(name.slice(8))) die(`${where}: unknown binding "${name}" (known: ${[...BINDINGS].map(b => 'binding:' + b).join(', ')})`);
      if (name in sections) die(`${where}: duplicate section "## ${name}"`);
      current = name; sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
    else if (line.trim()) die(`${where}: text before the first "## " section heading would be dropped ("${line.trim().slice(0, 40)}"); move it into a section`);
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].join('\n').trim();
  return sections;
}

/* CommonMark-style fence tracking over LF-split lines: an opening fence is 3+ backticks or
   tildes after at most 3 spaces; it closes only on the same character, at least the opening
   length, with nothing but whitespace after. Returns one boolean per line: inside a fence?
   An unterminated fence is an error, never a guess. */
function fenceMap(lines, where) {
  const inside = new Array(lines.length).fill(false);
  let open = null; // { ch, len, line }
  lines.forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      inside[i] = true;
      if (m && m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === '') open = null;
    } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      open = { ch: m[1][0], len: m[1].length, line: i + 1 };
      inside[i] = true;
    }
  });
  if (open) die(`${where}: code fence opened on line ${open.line} is never closed; fix it by hand`);
  return inside;
}

function rejectMarkers(text, where) {
  if (text.includes(BEGIN) || text.includes(END)) die(`${where}: contains a render marker token; those are reserved for rendered files`);
}

function decodeUtf8(bytes, where) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (_) { die(`${where}: not valid UTF-8. Nothing was written`); }
}

/* .agent-personalizer.json, fully validated on EVERY load (render, --check and --contract alike):
   targets a unique list of known targets, level an integer 1-4, onboarding a valid answer set. */
function readConfig(root) {
  const cfgPath = path.join(root, '.agent-personalizer.json');
  if (!mustBe(cfgPath, 'file', '.agent-personalizer.json')) return null;
  const cfg = readJson(cfgPath, 'config');
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) die('config: .agent-personalizer.json must be an object');
  if ('targets' in cfg) {
    if (!Array.isArray(cfg.targets)) die('config: .agent-personalizer.json "targets" must be a list');
    const bad = cfg.targets.filter(t => !KNOWN.includes(t));
    if (bad.length) die(`config: .agent-personalizer.json lists unknown target(s): ${bad.join(', ')} (known: ${KNOWN.join(', ')})`);
    if (new Set(cfg.targets).size !== cfg.targets.length) die('config: .agent-personalizer.json lists a target twice');
  }
  if ('level' in cfg && !(Number.isInteger(cfg.level) && cfg.level >= 1 && cfg.level <= 4)) die(`config: .agent-personalizer.json "level" must be an integer 1-4 (found ${JSON.stringify(cfg.level)})`);
  if ('onboarding' in cfg) {
    try { cfg.onboarding = onboarding.validate(cfg.onboarding); } catch (e) { die(`config: onboarding answers: ${e.message}`); }
  }
  return cfg;
}

function readSource(p, where) {
  mustBe(p, 'file', where);
  const text = decodeUtf8(fs.readFileSync(p), where).replace(/\r\n/g, '\n');
  rejectMarkers(text, where);
  return text;
}

function loadRules(root) {
  const rdir = path.join(root, 'rules');
  if (!mustBe(rdir, 'dir', 'rules/')) die('rules/ is missing; an intentionally empty rule set is an empty rules/ directory, not a missing one');
  const out = [];
  for (const f of fs.readdirSync(rdir).sort()) {
    if (f === 'README.md') continue;
    if (!f.endsWith('.md')) continue;
    if (!RULE_FILE_RE.test(f)) die(`rules/${f}: unexpected file name; rule files are NN-name.md (README.md is the one exception)`);
    const where = `rules/${f}`;
    const text = readSource(path.join(rdir, f), where);
    const { meta, body } = parseFrontmatter(text, where);
    const sections = parseSections(body, where);
    if (!sections.universal) die(`${where}: missing "## universal" block`);
    out.push({ file: f, meta, sections });
  }
  return out;
}

function loadProfile(root) {
  const p = path.join(root, 'USER.md');
  if (!fs.existsSync(p) && !(() => { try { fs.lstatSync(p); return true; } catch (_) { return false; } })()) return null;
  const text = readSource(p, 'USER.md');
  fenceMap(text.split('\n'), 'USER.md');                    // an unterminated fence in the profile is an error, not a surprise later
  return text.replace(/^#\s+USER\.md\s*\n/, '').replace(/\n---\n\*Template from agent-personalizer[^\n]*\n?$/, '').trim();
}

/* Resolve a target's relative filename to a path provably inside the real project root,
   with no symlink anywhere on the way. */
function safeTargetPath(root, rel, key) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /[\\]/.test(rel) || rel.split('/').some(p => p === '..' || p === '' || p === '.'))
    die(`target "${key}": file name "${rel}" is not a plain relative path`);
  const parts = rel.split('/');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    const where = `target "${key}": ${path.relative(root, cur)}`;
    const st = mustBe(cur, i < parts.length - 1 ? 'dir' : 'file', where);
    if (i < parts.length - 1 && !st) die(`${where}: directory does not exist; create it first`);
  }
  if (!(cur + path.sep).startsWith(root + path.sep) || cur === root) die(`target "${key}": resolves outside the project folder`);
  return cur;
}

function renderRule(rule, target) {
  const s = rule.sections;
  const out = [`### ${rule.meta.title || rule.meta.id || rule.file}`, '', s.universal];
  if (target.personal && s.personal) out.push('', s.personal);
  if (target.binding && s[`binding:${target.binding}`]) out.push('', s[`binding:${target.binding}`]);
  if (target.origin && s.origin) out.push('', s.origin.split('\n').map(l => `> ${l}`).join('\n'));
  return out.join('\n');
}

/* the rules that reach one surface: the surfaces filter, then the requires filter against the
   stored answers (defaults when none are stored, so a rule set without an interview still renders) */
function rulesFor(rules, key, answers) {
  const a = answers || onboarding.defaults();
  return rules.filter(r => (!Array.isArray(r.meta.surfaces) || r.meta.surfaces.includes(key))
    && (!r.meta.requires || a[r.meta.requires.answer] === r.meta.requires.value));
}
const answersOf = (cfg) => (cfg && cfg.onboarding) ? cfg.onboarding : null;

function renderTarget(key, target, profile, rules, cfg) {
  if (target.source === 'onboarding') {
    if (!cfg || !cfg.onboarding) die(`target "${key}": no onboarding answers in .agent-personalizer.json. Run the installer (it asks), or pass --answers <file>`);
    return onboarding.renderOnboarding(cfg.onboarding);
  }
  const answers = answersOf(cfg);
  const lines = [`## ${target.header}`, '', '_Generated by agent-personalizer from `USER.md`, `rules/` and your onboarding answers. Edit those, then re-render. Do not edit between the markers._', ''];
  if (target.boxes) {
    // With answers: a compact profile and the contract block plus the inject:true rules, in
    // consequence order, so the two boxes fit their budget and no restriction depends on trimming.
    // Without answers: the full profile and every rule for this surface (the pre-interview shape).
    const picked = rulesFor(rules, key, answers).filter(r => !answers || r.meta.inject === true);
    const ruleText = picked.map(r => {
      const s = r.sections, parts = [s.universal];
      if (target.personal && s.personal && !answers) parts.push(s.personal);
      if (target.binding && s[`binding:${target.binding}`]) parts.push(s[`binding:${target.binding}`]);
      return parts.join('\n\n');
    }).join('\n\n');
    const box1 = answers ? onboarding.compactProfile(answers) : (profile || '(no USER.md found)');
    const box2 = answers ? [onboarding.contractBlock(answers, { files: false }).split('\n').slice(2).join('\n'), ruleText].filter(Boolean).join('\n\n') : ruleText;
    const over = [];
    const warn = (label, text) => {
      if (text.length > target.limit) { over.push(label); return `\n> **${label} is OVER BUDGET: ${text.length} characters, the box allows about ${target.limit}.** Nothing was cut for you. Trim from the bottom up: the box is ordered by consequence (restrictions first, style last), so the last lines are the cheapest to lose.`; }
      return `\n> ${label}: ${text.length} of about ${target.limit} characters.`;
    };
    // a wrapping fence longer than any backtick or tilde run inside the content, so content fences can never close it
    const fenceFor = (text) => { let n = 3; for (const m of text.matchAll(/(`{3,}|~{3,})/g)) n = Math.max(n, m[1].length + 1); return '`'.repeat(n); };
    const f1 = fenceFor(box1), f2 = fenceFor(box2);
    lines.push('### Box 1: "What would you like ChatGPT to know about you?"', '', '_Copy only the text inside the fence below; the counts and headings stay here._', '', f1, box1, f1, warn('Box 1', box1), '');
    lines.push('### Box 2: "How would you like ChatGPT to respond?"', '', '_Copy only the text inside the fence below._', '', f2, box2, f2, warn('Box 2', box2));
    if (!answers) lines.push('', '> No onboarding answers in `.agent-personalizer.json`, so this is the full profile and every rule. Run the installer (it asks) for the compact, budgeted form.');
    else lines.push('', `> ChatGPT has no file access, so only the rules marked \`inject: true\` are here (${picked.length}). The rest live in \`rules/\`; for a ChatGPT Project, upload \`AGENT_ONBOARDING.md\` and \`rules/\` as project files instead of pasting.`);
    renderTarget.overBudget = (renderTarget.overBudget || []).concat(over.map(l => `${target.file}: ${l}`));
    return lines.join('\n');
  }
  if (target.profile && profile) lines.push('## Profile', '', profile, '');
  lines.push('## Rules', '');
  for (const r of rulesFor(rules, key, answers)) lines.push(renderRule(r, target), '');
  return lines.join('\n').trimEnd();
}

/* Marker positions as byte ranges of whole lines. Markers count only as standalone lines
   OUTSIDE fenced code blocks, so a quoted example in the target is never mistaken for the
   owned block. */
function markerState(text, where) {
  const lines = text.split('\n');
  const fenced = fenceMap(lines, where);
  const b = [], e = [];
  let pos = 0;
  lines.forEach((raw, i) => {
    if (!fenced[i]) {
      const t = (raw.endsWith('\r') ? raw.slice(0, -1) : raw).trim();
      if (t === BEGIN) b.push([pos, pos + raw.length]);
      else if (t === END) e.push([pos, pos + raw.length]);
    }
    pos += raw.length + 1;
  });
  if (!b.length && !e.length) return { kind: 'none' };
  if (b.length === 1 && e.length === 1 && b[0][0] < e[0][0])
    return { kind: 'one', bStart: b[0][0], bEnd: b[0][1], eStart: e[0][0], eEnd: e[0][1] };
  return { kind: 'malformed', begins: b.length, ends: e.length };
}

function splice(existing, block, file) {
  const body = `${BEGIN}\n${block}\n${END}`;
  if (existing == null) return body + '\n';
  const st = markerState(existing, file);
  if (st.kind === 'malformed') die(`${file}: malformed marker block (${st.begins} begin, ${st.ends} end). Fix it by hand; nothing was written`);
  if (st.kind === 'none') return existing + (existing.endsWith('\n') ? '' : '\n') + '\n' + body + '\n';
  return existing.slice(0, st.bStart) + body + existing.slice(st.eEnd);
}

function between(existing, file) {
  const st = markerState(existing, file);
  if (st.kind === 'malformed') die(`${file}: malformed marker block (${st.begins} begin, ${st.ends} end)`);
  if (st.kind === 'none') return null;
  return existing.slice(st.bEnd, st.eStart).replace(/\r\n/g, '\n').replace(/^\n/, '').replace(/\n$/, '');
}

function main() {
  ARGS = parseArgs();
  const requested = path.resolve(arg('--dir', process.cwd()));
  let root;
  try { root = fs.realpathSync(requested); } catch (_) { die(`--dir ${requested} does not exist`); }
  if (!fs.statSync(root).isDirectory()) die(`--dir ${requested} is not a directory`);
  const check = !!arg('--check', false);
  const contract = !!arg('--contract', false);
  const rules = loadRules(root);
  const profile = loadProfile(root);

  if (contract) {
    const key = arg('--contract-target', 'claude');
    if (!KNOWN.includes(key)) die(`unknown contract target "${key}"`);
    const target = TARGETS[key];
    const withPersonal = target.personal && !arg('--no-personal', false);
    const cfgC = readConfig(root);
    const inject = rulesFor(rules, key, answersOf(cfgC)).filter(r => r.meta.inject === true);
    const out = [`[agent-personalizer] Session-start contract for ${key}. Injected in full at the start of every session so these rules are in context at the moment of decision.`, ''];
    if (cfgC && cfgC.onboarding && withPersonal) out.push(onboarding.contractBlock(cfgC.onboarding), '');
    for (const r of inject) {
      out.push(`## ${r.meta.title || r.meta.id || r.file}`, '', r.sections.universal);
      if (withPersonal && r.sections.personal) out.push('', r.sections.personal);
      if (target.binding && r.sections[`binding:${target.binding}`]) out.push('', r.sections[`binding:${target.binding}`]);
      out.push('');
    }
    process.stdout.write(out.join('\n'));
    return;
  }

  let targets;
  const cfg = readConfig(root);
  const explicit = arg('--targets', null);
  if (explicit) targets = explicit.split(',').map(s => s.trim()).filter(Boolean);
  else if (cfg) {
    if (Array.isArray(cfg.targets)) targets = cfg.targets;
    else if (cfg.targets === undefined) targets = ['claude', 'agents'];
    else die('config: .agent-personalizer.json "targets" must be a list');
  }
  else targets = ['claude', 'agents'];
  if (!targets.length) die('no targets');
  if (new Set(targets).size !== targets.length) die(`a target is listed twice (${targets.join(',')})`);

  // Preflight everything: paths, existing content, marker state, final bytes. Then write.
  const plan = targets.map(key => {
    const target = TARGETS[key];
    if (!target) die(`unknown target "${key}" (known: ${KNOWN.join(', ')})`);
    const file = safeTargetPath(root, target.file, key);
    const block = renderTarget(key, target, profile, rules, cfg);
    let existing = null;
    if (fs.existsSync(file)) {
      existing = decodeUtf8(fs.readFileSync(file), target.file);
    }
    if (!check) {
      try { fs.accessSync(existing == null ? path.dirname(file) : file, fs.constants.W_OK); }
      catch (_) { die(`${target.file}: not writable. Nothing was written`); }
    }
    const current = existing == null ? null : between(existing, target.file);
    const output = check ? null : splice(existing, block, target.file);
    // the generated file must itself re-parse to exactly one block, or the next render would refuse it
    if (output != null) { const st = markerState(output, `${target.file} (generated)`); if (st.kind !== 'one' || between(output, `${target.file} (generated)`) !== block) die(`${target.file}: generated content would not re-parse cleanly; a fence in USER.md or a rule is unbalanced. Nothing was written`); }
    const mode = existing == null ? 0o644 : (fs.statSync(file).mode & 0o777);
    return { key, target, file, block, current, output, mode };
  });

  // Every final path must be distinct, and no final path may look like a staging file.
  // Checked in every mode, before any output.
  const finals = plan.map(p => p.file);
  if (new Set(finals).size !== finals.length) die('two targets resolve to the same file. Nothing was written');
  if (finals.some(f => /\.agent-personalizer\.(tmp|bak)$/.test(f))) die('a target file name uses the staging suffix. Nothing was written');

  if (check) {
    let drift = 0;
    for (const p of plan) {
      if (p.current === null) { console.log(`DRIFT  ${p.target.file}: missing or no marker block`); drift++; }
      else if (p.current !== p.block) { console.log(`DRIFT  ${p.target.file}: rendered block differs from source`); drift++; }
      else console.log(`ok     ${p.target.file}`);
    }
    console.log(drift ? `\n${drift} file(s) drifted. Re-render with: node render/render.cjs --dir ${root}` : '\nclean: every rendered file matches its source');
    process.exit(drift ? 1 : 0);
  }
  // Commit: stage every output beside its target under a per-run random name, back up every
  // existing target, rename staged -> final one by one, and on any failure put every backup
  // back and remove every staged file. A stale .tmp/.bak from an earlier crash never blocks a
  // run (names are unique) and is never deleted automatically (it may be the only copy).
  const run = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const staged = [], committed = [];
  const tryUnlink = (p, kept, what) => { try { fs.unlinkSync(p); } catch (e) { if (e.code !== 'ENOENT') kept.push(`${what}: ${path.basename(p)} (${e.message})`); } };
  const undo = (why) => {
    const kept = [];
    for (const c of committed) {
      if (c.bak && c.done) {
        try { fs.renameSync(c.bak, c.file); }               // target was replaced: original back in place, mode carried by the backup
        catch (e) { kept.push(`${c.label}: original kept at ${path.basename(c.bak)} (${e.message})`); }
      } else if (c.bak) {
        tryUnlink(c.bak, kept, `${c.label}: stale backup not removed`);   // target was never replaced: the original is still in place, drop the copy
      } else if (c.done) {
        try { fs.unlinkSync(c.file); }                      // target did not exist before and was created by this run
        catch (e) { kept.push(`${c.label}: created target not removed (${e.message})`); }
      }
      // else: target did not exist before and the rename never happened; nothing to restore
    }
    for (const s of staged) tryUnlink(s.tmp, kept, 'staged output not removed');
    if (kept.length) {
      console.error(`render: ${why}.`);
      console.error('render: ROLLBACK INCOMPLETE. Handle these by hand; nothing else was deleted:');
      for (const k of kept) console.error(`  ${k}`);
      process.exit(2);
    }
    die(`${why}. Every target was restored; nothing changed`);
  };
  try {
    for (const p of plan) {
      const tmp = path.join(path.dirname(p.file), `.${path.basename(p.file)}.${run}.agent-personalizer.tmp`);
      staged.push({ tmp, file: p.file, label: p.target.file, mode: p.mode });   // recorded BEFORE the file can exist; cleanup tolerates ENOENT
      fs.writeFileSync(tmp, p.output, { flag: 'wx', mode: p.mode });
      fs.chmodSync(tmp, p.mode);
    }
  } catch (e) { undo(`could not stage output (${e.message})`); }
  try {
    for (const s of staged) {
      let bak = null;
      const rec = { file: s.file, bak: null, label: s.label, done: false };
      committed.push(rec);                                  // recorded before the first artifact exists
      if (fs.existsSync(s.file)) {
        bak = path.join(path.dirname(s.file), `.${path.basename(s.file)}.${run}.agent-personalizer.bak`);
        rec.bak = bak;                                      // recorded BEFORE the copy can exist
        fs.copyFileSync(s.file, bak, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(bak, s.mode);                          // carries the target's mode into a restore, whatever the umask
      }
      fs.renameSync(s.tmp, s.file);
      rec.done = true;
    }
  } catch (e) { undo(`could not commit output (${e.message})`); }
  const leftovers = [];
  for (const c of committed) if (c.bak) tryUnlink(c.bak, leftovers, 'backup not removed');
  for (const s of staged) console.log(`wrote  ${s.label}`);
  for (const o of (renderTarget.overBudget || [])) console.log(`OVER BUDGET  ${o} (written in full; trim by hand, bottom up)`);
  if (leftovers.length) {
    console.error('render: every target was written, but CLEANUP INCOMPLETE. Remove these by hand (they hold copies of the previous targets):');
    for (const l of leftovers) console.error(`  ${l}`);
    process.exit(2);
  }

}

/* Everything the renderer would refuse about the SOURCES already present in a folder, checked without
   writing: an existing rules/ (each file parsed as loadRules does) and an existing USER.md (as
   loadProfile does). A missing rules/ or USER.md is fine here: the installer is about to create them. */
function preflightSources(root) {
  if (mustBe(path.join(root, 'rules'), 'dir', 'rules/')) loadRules(root);
  loadProfile(root);
}

module.exports = { main, fenceMap, markerState, splice, between, preflightSources, Refusal, DIE_THROWS: false };
if (require.main === module) main();
