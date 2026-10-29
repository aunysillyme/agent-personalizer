'use strict';
const path = require('path');
const { Refusal } = require('../render/render.cjs');

function resolveHome(home = process.env.HOME) {
  if (process.platform === 'win32' && (home === undefined || home === '')) home = process.env.USERPROFILE;
  if (typeof home !== 'string' || !home || !path.isAbsolute(home)) {
    throw new Refusal('HOME (or USERPROFILE on Windows) must be set to a non-empty absolute path; nothing was written');
  }
  return home;
}

module.exports = { resolveHome };
