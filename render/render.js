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
  markers are preserved exactly (line endings included). The renderer refuses to write when
  the marker state is anything other than "no block yet" or "exactly one BEGIN followed by
  exactly one END", and it validates every target before writing any.

  Safety: sources (USER.md, rules/, each rule file) and targets must be regular files or
  directories inside the real project folder, never symlinks. Marker tokens are rejected
  inside sources. Frontmatter keys are whitelisted; unknown, duplicate, malformed or CRLF
  frontmatter is an error, never a silent default. Unexpected .md files in rules/ are an
  error. No network. No environment variables read. No secrets written.

  exit codes: 0 ok · 1 drift (--check) · 2 refused or invalid input
*/
const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- agent-personalizer:begin -->';
const END = '<!-- agent-personalizer:end -->';
const TARGETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));
const KNOWN = Object.keys(TARGETS);
const SECTION_RE = /^(universal|personal|origin|binding:[a-z]+)$/;
const META_KEYS = new Set(['id', 'title', 'inject', 'surfaces']);
const RULE_FILE_RE = /^\d{2}-[A-Za-z0-9._-]+\.md$/;

function die(msg) { console.error(`render: ${msg}`); process.exit(2); }

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
  for (const line of body.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const name = h[1].trim();
      if (!SECTION_RE.test(name)) die(`${where}: unknown section "## ${name}" (allowed: universal, personal, origin, binding:<ai>)`);
      if (name in sections) die(`${where}: duplicate section "## ${name}"`);
      current = name; sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].join('\n').trim();
  return sections;
}

function rejectMarkers(text, where) {
  if (text.includes(BEGIN) || text.includes(END)) die(`${where}: contains a render marker token; those are reserved for rendered files`);
}

function readSource(p, where) {
  mustBe(p, 'file', where);
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  rejectMarkers(text, where);
  return text;
}

function loadRules(root) {
  const rdir = path.join(root, 'rules');
  if (!mustBe(rdir, 'dir', 'rules/')) return [];
  const out = [];
  for (const f of fs.readdirSync(rdir).sort()) {
    if (f === 'README.md' || f.startsWith('.')) continue;
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
    mustBe(cur, i < parts.length - 1 ? 'dir' : 'file', where);
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
    const box2 = rulesFor(rules, key).map(r => r.sections.universal).join('\n\n');
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

/* Marker positions as byte ranges of whole lines. Markers count only as standalone lines. */
function markerRe(tok) { return new RegExp('^[ \\t]*' + tok.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '[ \\t]*\\r?$', 'gm'); }
function markerState(text) {
  const b = [...text.matchAll(markerRe(BEGIN))], e = [...text.matchAll(markerRe(END))];
  if (!b.length && !e.length) return { kind: 'none' };
  if (b.length === 1 && e.length === 1 && b[0].index < e[0].index)
    return { kind: 'one', bStart: b[0].index, bEnd: b[0].index + b[0][0].length, eStart: e[0].index, eEnd: e[0].index + e[0][0].length };
  return { kind: 'malformed', begins: b.length, ends: e.length };
}

function splice(existing, block, file) {
  const body = `${BEGIN}\n${block}\n${END}`;
  if (existing == null) return body + '\n';
  const st = markerState(existing);
  if (st.kind === 'malformed') die(`${file}: malformed marker block (${st.begins} begin, ${st.ends} end). Fix it by hand; nothing was written`);
  if (st.kind === 'none') return existing + (existing.endsWith('\n') ? '' : '\n') + '\n' + body + '\n';
  return existing.slice(0, st.bStart) + body + existing.slice(st.eEnd);
}

function between(existing, file) {
  const st = markerState(existing);
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
  else if (mustBe(cfgPath, 'file', '.agent-personalizer.json')) targets = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).targets || ['claude', 'agents'];
  else targets = ['claude', 'agents'];
  if (!targets.length) die('no targets');

  // Preflight everything: paths, existing content, marker state, final bytes. Then write.
  const plan = targets.map(key => {
    const target = TARGETS[key];
    if (!target) die(`unknown target "${key}" (known: ${KNOWN.join(', ')})`);
    const file = safeTargetPath(root, target.file, key);
    const block = renderTarget(key, target, profile, rules);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
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
  for (const p of plan) { fs.writeFileSync(p.file, p.output); console.log(`wrote  ${p.target.file}`); }
}

main();
