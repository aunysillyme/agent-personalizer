#!/usr/bin/env node
'use strict';
/*
  render.js: USER.md + rules/*.md  ->  per-AI instruction files.

  usage:
    node render/render.js [--dir <project>] [--targets claude,agents,gemini,chatgpt,prompt] [--check]
    node render/render.js [--dir <project>] --contract [--contract-target claude] [--no-personal]

  --dir               project folder holding USER.md and rules/ (default: cwd). The folder you
                      name is followed once (realpath); nothing beneath it may be a symlink.
  --targets           which renders to write; default: <dir>/.agent-personalizer.json, else "claude,agents"
  --check             render to memory, compare with disk; exit 1 on drift, 0 clean
  --contract          print the inject:true rules for one target to stdout (session-start hooks):
                      universal, then personal only if that target's policy allows it and
                      --no-personal is absent, then the target's binding block.
  --contract-target   which target's surface filter, personal policy and binding to use (default claude)

  Rendered text lives between two marker lines inside each target file. Bytes outside the
  markers are preserved exactly (line endings included); a target that is not valid UTF-8 is
  refused rather than re-encoded (sources too). Outputs are staged beside their targets under
  per-run random names, existing targets are backed up, and a failure at any point restores
  every target and removes every staged file. The renderer refuses to write when
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

function die(msg) { console.error(`render: ${msg}`); process.exit(2); }


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
const META_KEYS = new Set(['id', 'title', 'inject', 'surfaces']);
const RULE_FILE_RE = /^\d{2}-[A-Za-z0-9._-]+\.md$/;


function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  if (v === undefined || v === '' || v.startsWith('--')) die(`${name} needs a non-empty value`);
  return v;
}

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

function rulesFor(rules, key) {
  return rules.filter(r => !Array.isArray(r.meta.surfaces) || r.meta.surfaces.includes(key));
}

function renderTarget(key, target, profile, rules) {
  const lines = [`## ${target.header}`, '', '_Generated by agent-personalizer from `USER.md` and `rules/`. Edit those, then re-render. Do not edit between the markers._', ''];
  if (target.boxes) {
    const box1 = profile || '(no USER.md found)';
    const box2 = rulesFor(rules, key).map(r => {
      const s = r.sections, parts = [s.universal];
      if (target.personal && s.personal) parts.push(s.personal);
      if (target.binding && s[`binding:${target.binding}`]) parts.push(s[`binding:${target.binding}`]);
      return parts.join('\n\n');
    }).join('\n\n');
    const warn = (label, text) => text.length > target.limit ? `\n> ${label} is ${text.length} characters; the box allows about ${target.limit}. Trim before pasting.` : `\n> ${label}: ${text.length} characters.`;
    lines.push('### Box 1: "What would you like ChatGPT to know about you?"', '', '```', box1, '```', warn('Box 1', box1), '');
    lines.push('### Box 2: "How would you like ChatGPT to respond?"', '', '```', box2, '```', warn('Box 2', box2));
    return lines.join('\n');
  }
  if (target.profile && profile) lines.push('## Profile', '', profile, '');
  lines.push('## Rules', '');
  for (const r of rulesFor(rules, key)) lines.push(renderRule(r, target), '');
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
  const requested = path.resolve(arg('--dir', process.cwd()));
  let root;
  try { root = fs.realpathSync(requested); } catch (_) { die(`--dir ${requested} does not exist`); }
  if (!fs.statSync(root).isDirectory()) die(`--dir ${requested} is not a directory`);
  const check = process.argv.includes('--check');
  const contract = process.argv.includes('--contract');
  const rules = loadRules(root);
  const profile = loadProfile(root);

  if (contract) {
    const key = arg('--contract-target', 'claude');
    if (!KNOWN.includes(key)) die(`unknown contract target "${key}"`);
    const target = TARGETS[key];
    const withPersonal = target.personal && !process.argv.includes('--no-personal');
    const inject = rulesFor(rules, key).filter(r => r.meta.inject === true);
    const out = [`[agent-personalizer] Session-start contract for ${key}. These rules win at the moment of decision; they are injected in full, every session.`, ''];
    for (const r of inject) {
      out.push(`## ${r.meta.title || r.meta.id}`, '', r.sections.universal);
      if (withPersonal && r.sections.personal) out.push('', r.sections.personal);
      if (target.binding && r.sections[`binding:${target.binding}`]) out.push('', r.sections[`binding:${target.binding}`]);
      out.push('');
    }
    process.stdout.write(out.join('\n'));
    return;
  }

  let targets;
  const cfgPath = path.join(root, '.agent-personalizer.json');
  const explicit = arg('--targets', null);
  if (explicit) targets = explicit.split(',').map(s => s.trim()).filter(Boolean);
  else if (mustBe(cfgPath, 'file', '.agent-personalizer.json')) {
    const cfg = readJson(cfgPath, 'config');
    if (cfg && Array.isArray(cfg.targets)) targets = cfg.targets;
    else if (cfg && cfg.targets === undefined) targets = ['claude', 'agents'];
    else die('config: .agent-personalizer.json "targets" must be a list');
  }
  else targets = ['claude', 'agents'];
  if (!targets.length) die('no targets');

  // Preflight everything: paths, existing content, marker state, final bytes. Then write.
  const plan = targets.map(key => {
    const target = TARGETS[key];
    if (!target) die(`unknown target "${key}" (known: ${KNOWN.join(', ')})`);
    const file = safeTargetPath(root, target.file, key);
    const block = renderTarget(key, target, profile, rules);
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
    return { key, target, file, block, current, output };
  });

  if (check) {
    let drift = 0;
    for (const p of plan) {
      if (p.current === null) { console.log(`DRIFT  ${p.target.file}: missing or no marker block`); drift++; }
      else if (p.current !== p.block) { console.log(`DRIFT  ${p.target.file}: rendered block differs from source`); drift++; }
      else console.log(`ok     ${p.target.file}`);
    }
    console.log(drift ? `\n${drift} file(s) drifted. Re-render with: node render/render.js --dir ${root}` : '\nclean: every rendered file matches its source');
    process.exit(drift ? 1 : 0);
  }
  // Every final path must be distinct, and no final path may look like a staging file.
  const finals = plan.map(p => p.file);
  if (new Set(finals).size !== finals.length) die('two targets resolve to the same file. Nothing was written');
  if (finals.some(f => /\.agent-personalizer\.(tmp|bak)$/.test(f))) die('a target file name uses the staging suffix. Nothing was written');

  // Commit: stage every output beside its target under a per-run random name, back up every
  // existing target, rename staged -> final one by one, and on any failure put every backup
  // back and remove every staged file. A stale .tmp/.bak from an earlier crash never blocks a
  // run (names are unique) and is never deleted automatically (it may be the only copy).
  const run = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const staged = [], backups = [], committed = [];
  const undo = (why) => {
    for (const c of committed) { try { if (c.bak) fs.renameSync(c.bak, c.file); else fs.unlinkSync(c.file); } catch (_) {} }
    for (const s of staged) { try { fs.unlinkSync(s.tmp); } catch (_) {} }
    for (const b of backups) { try { fs.unlinkSync(b); } catch (_) {} }
    die(`${why}. Every target was restored; nothing changed`);
  };
  try {
    for (const p of plan) {
      const tmp = path.join(path.dirname(p.file), `.${path.basename(p.file)}.${run}.agent-personalizer.tmp`);
      fs.writeFileSync(tmp, p.output, { flag: 'wx' });
      staged.push({ tmp, file: p.file, label: p.target.file });
    }
  } catch (e) { undo(`could not stage output (${e.message})`); }
  try {
    for (const s of staged) {
      let bak = null;
      if (fs.existsSync(s.file)) { bak = path.join(path.dirname(s.file), `.${path.basename(s.file)}.${run}.agent-personalizer.bak`); fs.copyFileSync(s.file, bak, fs.constants.COPYFILE_EXCL); backups.push(bak); }
      fs.renameSync(s.tmp, s.file);
      committed.push({ file: s.file, bak });
    }
  } catch (e) { undo(`could not commit output (${e.message})`); }
  for (const b of backups) { try { fs.unlinkSync(b); } catch (_) {} }
  for (const s of staged) console.log(`wrote  ${s.label}`);
}

main();
