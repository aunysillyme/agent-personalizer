'use strict';
const path = require('path');
const { Refusal } = require('../render/render.cjs');

function resolveHome(home = process.env.HOME) {
  if (process.platform === 'win32' && (home === undefined || home === '')) home = process.env.USERPROFILE;
  // On Windows a root-relative path such as \foo is "absolute" but lands on the current drive; require a drive or UNC root.
  const rooted = path.sep !== '\\' || /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/?.]+[\\/][^\\/]+)/.test(home || '');
  if (typeof home !== 'string' || !home || !path.isAbsolute(home) || !rooted) {
    throw new Refusal('HOME (or USERPROFILE on Windows) must be set to a non-empty absolute path; nothing was written');
  }
  return home;
}

module.exports = { resolveHome };
