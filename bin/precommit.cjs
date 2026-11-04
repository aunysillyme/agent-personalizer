'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Refusal } = require('../render/render.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function refuse(message) { throw new Refusal(message); }
function inside(base, file) { const rel = path.relative(base, file); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
function inspect(file, directory = false) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (st.isSymbolicLink()) refuse(`${file} is a symlink; nothing was changed`);
  if (directory ? !st.isDirectory() : !st.isFile()) refuse(`${file} is not a regular ${directory ? 'directory' : 'file'}; nothing was changed`);
  return st;
}
function location(root) {
  const git = args => execFileSync('git', ['-C', root, 'rev-parse', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let hooks, gitdir, common, worktree;
  try {
    worktree = fs.realpathSync(git(['--show-toplevel']));
    gitdir = path.resolve(root, git(['--absolute-git-dir']));
    common = path.resolve(root, git(['--git-common-dir']));
    hooks = path.resolve(root, git(['--git-path', 'hooks']));
  } catch (_) { refuse('--precommit needs a git work tree'); }
  const dotgit = path.join(worktree, '.git');
  const dotgitStat = fs.lstatSync(dotgit);
  if (dotgitStat.isSymbolicLink()) refuse(`${dotgit} is a symlink; nothing was changed`);
  if (![worktree, gitdir, common].some(base => inside(base, hooks))) refuse('pre-commit hook would land in a shared hooks folder; configure a project-local hooks path');
  // Inspect each existing component from a trusted boundary, including the hooks directory.
  const base = [worktree, gitdir, common].filter(b => inside(b, hooks)).sort((a, b) => b.length - a.length)[0];
  let cur = base;
  inspect(cur, true);
  for (const part of path.relative(base, hooks).split(path.sep).filter(Boolean)) { cur = path.join(cur, part); if (!inspect(cur, true)) break; }
  return { hooks, hook: path.join(hooks, 'pre-commit'), original: path.join(hooks, 'pre-commit.agent-personalizer-original') };
}
function quote(s) { return `'${s.replace(/'/g, "'\\''")}'`; }
function plan(root, saved) {
  const loc = location(root), hookStat = inspect(loc.hook), originalStat = inspect(loc.original);
  const current = hookStat && fs.readFileSync(loc.hook);
  const original = originalStat && fs.readFileSync(loc.original);
  if (saved) {
    if (typeof saved.wrapperHash !== 'string' || !(saved.originalHash === null || typeof saved.originalHash === 'string')) refuse('invalid pre-commit ownership record');
    if (!current || !(hookStat.mode & 0o111) || hash(current) !== saved.wrapperHash) refuse(`${loc.hook} was edited or removed; restore it by hand before continuing`);
    if ((saved.originalHash === null && original) || (saved.originalHash !== null && (!original || hash(original) !== saved.originalHash))) refuse(`${loc.original} was edited or removed; restore the original hook by hand`);
    return { ...loc, root, saved, noop: true };
  }
  if (original) refuse(`${loc.original} already exists; nothing was changed`);
  if (current && /agent-personalizer:(?:begin|end)/.test(current.toString('utf8'))) refuse(`${loc.hook} contains an unowned or malformed agent-personalizer marker; nothing was changed`);
  const bytes = Buffer.from(`#!/bin/sh\n# >>> agent-personalizer:begin\nnode ${quote(path.join(root, 'check/gate.cjs'))} --dir ${quote(root)}\nstatus=$?\n[ "$status" -eq 0 ] || exit "$status"\nif [ -f ${quote(loc.original)} ]; then\n  exec ${quote(loc.original)} "$@"\nfi\n# <<< agent-personalizer:end\n`);
  return { ...loc, root, bytes, hookStat, current, saved: { wrapperHash: hash(bytes), originalHash: current ? hash(current) : null } };
}
function install(p) {
  const now = location(p.root);
  if (now.hooks !== p.hooks) refuse('hooks path changed during installation');
  if (p.noop) { plan(p.root, p.saved); return; }
  fs.mkdirSync(p.hooks, { recursive: true });
  if (!!inspect(p.hook) !== !!p.current || (p.current && !fs.readFileSync(p.hook).equals(p.current))) refuse(`${p.hook} changed during installation`);
  if (inspect(p.original)) refuse(`${p.original} appeared during installation`);
  let moved = false, created = false, fd;
  try {
    if (p.current) { fs.renameSync(p.hook, p.original); moved = true; }
    fd = fs.openSync(p.hook, 'wx', 0o755); created = true;
    fs.writeFileSync(fd, p.bytes);
    fs.fchmodSync(fd, 0o755);
    fs.closeSync(fd); fd = undefined;
  } catch (e) {
    if (fd !== undefined) fs.closeSync(fd);
    if (created) fs.unlinkSync(p.hook);
    if (moved) {
      if (fs.existsSync(p.hook)) refuse(`${p.hook} appeared during installation; restore ${p.original} by hand`);
      fs.renameSync(p.original, p.hook);
    }
    throw e;
  }
}
function remove(p, dry) {
  if (dry) { console.log(`would remove ${p.hook} and restore the original hook if present`); return; }
  // Revalidate the snapshot before changing either file.
  const current = plan(path.resolve(p.root), p.saved);
  const wrapper = fs.readFileSync(current.hook), mode = fs.lstatSync(current.hook).mode & 0o777;
  fs.unlinkSync(current.hook);
  try { if (current.saved.originalHash !== null) fs.renameSync(current.original, current.hook); }
  catch (e) { fs.writeFileSync(current.hook, wrapper, { flag: 'wx', mode }); fs.chmodSync(current.hook, mode); throw e; }
  console.log(`removed ${current.hook} wrapper${current.saved.originalHash !== null ? '; restored original hook' : ''}`);
}
module.exports = { plan, install, remove };
