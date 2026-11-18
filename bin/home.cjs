'use strict';
const fs = require('fs');
const path = require('path');
const { Refusal } = require('../render/render.cjs');

function rootedAbsolute(dir) {
  // On Windows a root-relative path such as \foo is "absolute" but lands on the current drive; require a drive or UNC root.
  const rooted = path.sep !== '\\' || /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/?.]+[\\/][^\\/]+)/.test(dir || '');
  return typeof dir === 'string' && dir.length > 0 && path.isAbsolute(dir) && rooted;
}

function resolveHome(home = process.env.HOME) {
  if (process.platform === 'win32' && (home === undefined || home === '')) home = process.env.USERPROFILE;
  if (!rootedAbsolute(home)) {
    throw new Refusal('HOME (or USERPROFILE on Windows) must be set to a non-empty absolute path; nothing was written');
  }
  return home;
}

function resolveCodexHome(home = resolveHome(), codexHome = process.env.CODEX_HOME) {
  const resolvedHome = resolveHome(home);
  if (codexHome === undefined || codexHome === '') return path.join(resolvedHome, '.codex');
  if (!rootedAbsolute(codexHome)) {
    throw new Refusal('CODEX_HOME must be set to a non-empty absolute path; nothing was written');
  }
  return path.resolve(codexHome);
}

// Walk every path component from the filesystem root without following symlinks.
// On macOS, top-level /tmp, /var and /etc are system symlinks to /private/*; allowDarwinRootLink
// resolves only that depth-0 OS link on user-supplied paths, never on stored canonical paths.
function walkRealChain(absPath, { allowDarwinRootLink = false, action = 'nothing was written' } = {}) {
  const normalized = path.resolve(absPath);
  const { root } = path.parse(normalized);
  const rest = normalized.slice(root.length);
  const parts = rest ? rest.split(path.sep).filter(Boolean) : [];
  let cur = root;
  const missingDirs = [];
  for (let i = 0; i < parts.length; i++) {
    if (missingDirs.length) {
      missingDirs.push(parts[i]);
      continue;
    }
    const next = path.join(cur, parts[i]);
    let st;
    try { st = fs.lstatSync(next); }
    catch (e) {
      if (e.code === 'ENOENT') {
        missingDirs.push(parts[i]);
        continue;
      }
      throw e;
    }
    if (st.isSymbolicLink()) {
      if (allowDarwinRootLink && process.platform === 'darwin' && i === 0 && (next === '/tmp' || next === '/var' || next === '/etc')) {
        cur = fs.realpathSync(next);
        continue;
      }
      throw new Refusal(`${next} is a symlink; ${action}`);
    }
    if (!st.isDirectory()) {
      throw new Refusal(`${next} is not a directory; ${action}`);
    }
    cur = next;
  }
  return { base: cur, missingDirs, dir: path.join(cur, ...missingDirs) };
}

function hasNonEmptyOverride(dir) {
  const file = path.join(dir, 'AGENTS.override.md');
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return false;
    return fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '').trim().length > 0;
  } catch (_) {
    return false;
  }
}

module.exports = { rootedAbsolute, resolveHome, resolveCodexHome, walkRealChain, hasNonEmptyOverride };
