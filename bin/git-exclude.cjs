'use strict';
// Keep personal outputs out of `git status` when the install folder sits inside a git repo.
// Lines go in .git/info/exclude (local to this clone, never committed) inside a block marked
// with the install folder, so re-runs replace the block and uninstall removes exactly it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Profile, entries, answers and ChatGPT paste copies are personal. Home files (CLAUDE.md,
// AGENTS.md, GEMINI.md) and AGENT_ONBOARDING.md are often committed on purpose, so they get a
// warning instead; tooling (rules/, render/, check/, hooks/, .claude/commands/) is shareable.
const PRIVATE = ['USER.md', 'LEARNED.md', '.agent-personalizer.json', '.agent-personalizer/digest.md', 'chatgpt-custom-instructions.md', 'chatgpt-box1.txt', 'chatgpt-box2.txt'];
const SHARED_PERSONAL = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'AGENT_ONBOARDING.md'];

function git(cwd, args) {
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[name];
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  return r.error ? { missing: r.error.code === 'ENOENT', code: null, out: '' } : { code: r.status, out: r.stdout || '' };
}
function hasDotGit(root) {
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}
// { exclude, top, prefix } when root is a committable folder in a work tree; { warn } when
// that cannot be decided; null when there is no repo or the whole folder is already ignored.
function locate(root) {
  const r = git(root, ['rev-parse', '--show-toplevel', '--git-path', 'info/exclude']);
  if (r.code === null) return r.missing && hasDotGit(root) ? { warn: 'git is not on PATH, so .git/info/exclude was not updated' } : null;
  if (r.code !== 0) return null;
  const [top, gitPath] = r.out.split('\n');
  if (!top || !gitPath) return null;
  const prefix = path.relative(fs.realpathSync(top), root).split(path.sep).join('/');
  if (prefix.startsWith('..')) return null;
  if (prefix && git(top, ['check-ignore', '-q', '--', `${prefix}/`]).code === 0) return null;
  return { exclude: path.resolve(root, gitPath), top: fs.realpathSync(top), prefix };
}
const pattern = (prefix, rel) => '/' + (prefix ? `${prefix}/${rel}` : rel).replace(/[\\*?[]/g, '\\$&').replace(/ $/, '\\ ');
const markers = prefix => [`# agent-personalizer begin: ${prefix || '.'} (private outputs; uninstall removes this block)`, `# agent-personalizer end: ${prefix || '.'}`];

function readExclude(file) {
  let info;
  try { info = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
  if (!info.isFile()) throw new Error(`${file} is not a regular file`);
  return fs.readFileSync(file, 'utf8');
}
// Remove this folder's block, the separator line before it and its terminator.
function without(text, prefix) {
  const [begin, end] = markers(prefix);
  const lines = text.split('\n');
  const b = lines.indexOf(begin), e = lines.indexOf(end, b + 1);
  if (b === -1 || e === -1) return { text, found: false };
  const from = b > 0 && lines[b - 1] === '' ? b - 1 : b;
  lines.splice(from, e - from + 1);
  return { text: lines.join('\n'), found: true };
}
function writeExclude(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.exclude.${crypto.randomBytes(8).toString('hex')}.agent-personalizer.tmp`);
  try { fs.writeFileSync(tmp, text, { flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

// Never fails the install: any problem is printed as a warning naming the files to protect.
function protect(root, log = console.log) {
  let where;
  try { where = locate(root); } catch (e) { where = { warn: e.message }; }
  if (!where) return;
  const present = PRIVATE.filter(rel => fs.existsSync(path.join(root, rel)));
  if (where.warn) { log(`WARNING: this folder is inside a git repo and ${where.warn}. Keep ${present.join(', ')} out of commits.`); return; }
  const rel = path.relative(where.top, where.exclude).split(path.sep).join('/');
  try {
    const current = readExclude(where.exclude);
    const base = without(current, where.prefix).text;
    const [begin, end] = markers(where.prefix);
    const block = [begin, ...present.map(p => pattern(where.prefix, p)), end].join('\n') + '\n';
    const next = base + (base && !base.endsWith('\n') ? '\n' : '') + (base ? '\n' : '') + block;
    if (next !== current) writeExclude(where.exclude, next);
    log(`${next === current ? 'ok    ' : 'update'} ${rel} (git ignores ${present.join(', ')} in this clone)`);
  } catch (e) {
    log(`WARNING: could not update ${rel} (${e.message}). Keep ${present.join(', ')} out of commits.`);
  }
  const tracked = git(where.top, ['ls-files', '--', ...PRIVATE.map(p => where.prefix ? `${where.prefix}/${p}` : p)]).out.split('\n').filter(Boolean);
  if (tracked.length) log(`WARNING: git already tracks ${tracked.join(', ')}; an exclude cannot hide a tracked file. Run git rm --cached on it if it should stay private.`);
  const shared = SHARED_PERSONAL.filter(p => fs.existsSync(path.join(root, p)));
  if (shared.length) log(`NOTE: ${shared.join(', ')} carry your profile, entries and answers, including names under off-limits. CLAUDE.md, AGENTS.md and GEMINI.md may be committed. Review them before committing.`);
}

function unprotect(root, { dry = false, log = console.log } = {}) {
  let where;
  try { where = locate(root); } catch (_) { return; }
  if (!where || where.warn) return;
  const rel = path.relative(where.top, where.exclude).split(path.sep).join('/');
  try {
    const current = readExclude(where.exclude);
    const { text, found } = without(current, where.prefix);
    if (!found) return;
    if (!dry) writeExclude(where.exclude, text);
    log(`${dry ? 'would ' : ''}update ${rel} (removed the agent-personalizer lines for this folder)`);
  } catch (e) {
    log(`WARNING: could not update ${rel} (${e.message}); remove the agent-personalizer block by hand`);
  }
}

module.exports = { protect, unprotect, PRIVATE, SHARED_PERSONAL, locate };
