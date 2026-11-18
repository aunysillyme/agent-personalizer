'use strict';

const crypto = require('node:crypto');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function parseCliArgs(argv, { valueOpts = [], flagOpts = [], commands = [], onError }) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i === 0 && commands.includes(a)) { out.command = a; continue; }
    if (valueOpts.includes(a)) {
      if (a in out) onError(`${a} given more than once`);
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) onError(`${a} needs a non-empty value`);
      out[a] = v;
      i++;
    } else if (flagOpts.includes(a)) {
      if (a in out) onError(`${a} given more than once`);
      out[a] = true;
    } else {
      onError(`unknown option "${a}" (known: ${[...valueOpts, ...flagOpts].join(', ')})`);
    }
  }
  return out;
}

module.exports = { sha256, parseCliArgs };
