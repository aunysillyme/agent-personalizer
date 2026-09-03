#!/usr/bin/env node
'use strict';
/*
  render.js: USER.md + rules/*.md  ->  per-AI instruction files.

  usage:
    node render/render.js [--dir <project>] [--targets claude,agents,gemini,chatgpt,prompt] [--check]
    node render/render.js [--dir <project>] --contract [--contract-target claude] [--no-personal]

  --dir               project folder holding USER.md and rules/ (default: cwd)
  --targets           which renders to write; default: <dir>/.agent-personalizer.json, else "claude,agents"
  --check             render to memory, compare with disk; exit 1 on drift, 0 clean
  --contract          print the inject:true rules for one target to stdout (session-start hooks)
  --contract-target   which target's surface filter and binding to use (default claude)
  --no-personal       leave the personal blocks out of the contract

  Rendered text lives between two marker lines inside each target file. Text outside the
  markers is yours and is preserved. The renderer refuses to write when the marker state is
  anything other than "no block yet" or "exactly one BEGIN followed by exactly one END".

  Safety: target files must resolve inside the project folder; no path component may be a
  symlink; marker tokens are rejected inside USER.md and rule files. No network. No
  environment variables read. No secrets written.

  exit codes: 0 ok · 1 drift (--check) · 2 refused or invalid input
*/
const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- agent-personalizer:begin -->';
const END = '<!-- agent-personalizer:end -->';
const TARGETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));
const KNOWN = Object.keys(TARGETS);
const SECTION_RE = /^(universal|personal|origin|binding:[a-z]+)$/;

function die(msg) { console.error(`render: ${msg}`); process.exit(2); }

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) die(`${name} needs a value`);
  return v;
}

function parseFrontmatter(text, where) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) die(`${where}: unreadable frontmatter line "${line}"`);
    let v = kv[2].trim();
    if (v.startsWith('[')) {
      if (!v.endsWith(']')) die(`${where}: frontmatter list "${kv[1]}" is not closed`);
      v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    meta[kv[1]] = v;
  }
  if ('surfaces' in meta) {
    if (!Array.isArray(meta.surfaces) || !meta.surfaces.length) die(`${where}: "surfaces" must be a non-empty list`);
    const bad = meta.surfaces.filter(s => !KNOWN.includes(s));
    if (bad.length) die(`${where}: unknown surface(s) ${bad.join(', ')} (known: ${KNOWN.join(', ')})`);
  }
  if ('inject' in meta && typeof meta.inject !== 'boolean') die(`${where}: "inject" must be true or false`);
  return { meta, body: text.slice(m[0].length) };
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

function loadRules(dir) {
  const rdir = path.join(dir, 'rules');
  if (!fs.existsSync(rdir)) return [];
  return fs.readdirSync(rdir)
    .filter(f => /^\d{2}-.*\.md$/.test(f))
    .sort()
    .map(f => {
      const where = `rules/${f}`;
      const text = fs.readFileSync(path.join(rdir, f), 'utf8');
      rejectMarkers(text, where);
      const { meta, body } = parseFrontmatter(text, where);
      const sections = parseSections(body, where);
      if (!sections.universal) die(`${where}: missing "## universal" block`);
      return { file: f, meta, sections };
    });
}

function loadProfile(dir) {
  const p = path.join(dir, 'USER.md');
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  rejectMarkers(text, 'USER.md');
  return text.replace(/^#\s+USER\.md\s*\n/, '').replace(/\n---\n\*Template from agent-personalizer[^\n]*\n?$/, '').trim();
}

/* Resolve a target's relative filename to a path that is provably inside the real project
   root, with no symlink anywhere on the way. Refuses otherwise. */
function safeTargetPath(dir, rel, key) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /[\\]/.test(rel) || rel.split('/').some(p => p === '..' || p === ''))
    die(`target "${key}": file name "${rel}" is not a plain relative path`);
  const root = fs.realpathSync(dir);
  const parts = rel.split('/');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st = null;
    try { st = fs.lstatSync(cur); } catch (_) { st = null; }
    if (st && st.isSymbolicLink()) die(`target "${key}": ${path.relative(root, cur)} is a symlink; refusing to write through it`);
    if (i < parts.length - 1) {
      if (st && !st.isDirectory()) die(`target "${key}": ${path.relative(root, cur)} is not a directory`);
    } else if (st && !st.isFile()) die(`target "${key}": ${path.relative(root, cur)} exists and is not a regular file`);
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

/* Marker state of an existing file: markers count only as standalone lines. */
function markerState(text) {
  const lines = text.split('\n');
  const begins = [], ends = [];
  lines.forEach((l, i) => { const t = l.trim(); if (t === BEGIN) begins.push(i); else if (t === END) ends.push(i); });
  if (begins.length === 0 && ends.length === 0) return { kind: 'none', lines };
  if (begins.length === 1 && ends.length === 1 && begins[0] < ends[0]) return { kind: 'one', lines, b: begins[0], e: ends[0] };
  return { kind: 'malformed', begins: begins.length, ends: ends.length };
}

function splice(existing, block, file) {
  const body = [BEGIN, block, END];
  if (existing == null) return body.join('\n') + '\n';
  const st = markerState(existing);
  if (st.kind === 'malformed') die(`${file}: malformed marker block (${st.begins} begin, ${st.ends} end). Fix it by hand; nothing was written`);
  if (st.kind === 'none') return existing.replace(/\s*$/, '') + '\n\n' + body.join('\n') + '\n';
  return [...st.lines.slice(0, st.b), ...body, ...st.lines.slice(st.e + 1)].join('\n');
}

function between(existing, file) {
  const st = markerState(existing);
  if (st.kind === 'malformed') die(`${file}: malformed marker block (${st.begins} begin, ${st.ends} end)`);
  if (st.kind === 'none') return null;
  return st.lines.slice(st.b + 1, st.e).join('\n');
}

function main() {
  const dir = path.resolve(arg('--dir', process.cwd()));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`--dir ${dir} is not a directory`);
  const check = process.argv.includes('--check');
  const contract = process.argv.includes('--contract');
  const rules = loadRules(dir);
  const profile = loadProfile(dir);

  if (contract) {
    const key = arg('--contract-target', 'claude');
    if (!KNOWN.includes(key)) die(`unknown contract target "${key}"`);
    const withPersonal = !process.argv.includes('--no-personal');
    const inject = rulesFor(rules, key).filter(r => r.meta.inject === true);
    const out = [`[agent-personalizer] Session-start contract for ${key}. These rules win at the moment of decision; they are injected in full, every session.`, ''];
    for (const r of inject) {
      out.push(`## ${r.meta.title || r.meta.id}`, '', r.sections.universal);
      if (withPersonal && r.sections.personal) out.push('', r.sections.personal);
      out.push('');
    }
    process.stdout.write(out.join('\n'));
    return;
  }

  let targets;
  const cfgPath = path.join(dir, '.agent-personalizer.json');
  const explicit = arg('--targets', null);
  if (explicit) targets = explicit.split(',').map(s => s.trim()).filter(Boolean);
  else if (fs.existsSync(cfgPath)) targets = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).targets || ['claude', 'agents'];
  else targets = ['claude', 'agents'];
  if (!targets.length) die('no targets');

  // Validate every target path BEFORE writing any, so a refused target leaves nothing half-done.
  const plan = targets.map(key => {
    const target = TARGETS[key];
    if (!target) die(`unknown target "${key}" (known: ${KNOWN.join(', ')})`);
    const file = safeTargetPath(dir, target.file, key);
    return { key, target, file, block: renderTarget(key, target, profile, rules) };
  });

  let drift = 0;
  for (const { key, target, file, block } of plan) {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (check) {
      const current = existing == null ? null : between(existing, target.file);
      if (current === null) { console.log(`DRIFT  ${target.file}: missing or no marker block`); drift++; }
      else if (current !== block) { console.log(`DRIFT  ${target.file}: rendered block differs from source`); drift++; }
      else console.log(`ok     ${target.file}`);
      continue;
    }
    fs.writeFileSync(file, splice(existing, block, target.file));
    console.log(`wrote  ${target.file}`);
  }
  if (check) {
    console.log(drift ? `\n${drift} file(s) drifted. Re-render with: node render/render.js --dir ${dir}` : '\nclean: every rendered file matches its source');
    process.exit(drift ? 1 : 0);
  }
}

main();
