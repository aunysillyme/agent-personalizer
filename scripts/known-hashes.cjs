#!/usr/bin/env node
'use strict';
// One-time legacy compatibility data. Hashes recorded at install time cover v0.6.0 onward;
// releases do not regenerate this table or inspect git at install time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const tags = ['v0.1.0', 'v0.2.0', 'v0.3.0', 'v0.4.0', 'v0.4.1', 'v0.4.2', 'v0.4.3', 'v0.5.0', 'v0.5.1', 'v0.5.2', 'v0.6.0', 'v0.6.1', 'v0.6.2', 'v0.6.3', 'v0.6.4', 'v0.6.5'];
const files = ['render/render.cjs', 'render/targets.json', 'render/onboarding.cjs', 'hooks/README.md', 'hooks/claude-code/session-start.sh', 'check/gate.cjs', 'check/forbidden.example.txt', ...fs.readdirSync(path.join(ROOT, 'rules')).filter(name => name.endsWith('.md')).map(name => `rules/${name}`)].sort();
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stripSignature = text => text.split('\n').filter(line => !line.includes('40-sign-every-edit.md') && !/^`?Last edited by:/.test(line)).join('\n');
const table = { schemaVersion: 1, files: {} };
for (const rel of files) {
  const versions = {};
  for (const tag of tags) {
    let bytes;
    try { bytes = execFileSync('git', ['show', `${tag}:${rel}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) {
      // A source not introduced in this release has no legacy hash. Refuse other failures.
      if (e.status === 128 && /does not exist in|exists on disk, but not in/.test(String(e.stderr))) continue;
      throw e;
    }
    versions[tag] = { original: sha256(bytes) };
    if (rel.endsWith('.md')) versions[tag].withoutSignature = sha256(Buffer.from(stripSignature(bytes.toString('utf8'))));
  }
  table.files[rel] = versions;
}
const destination = path.join(ROOT, 'bin', 'known-hashes.json');
fs.writeFileSync(destination, JSON.stringify(table, null, 2) + '\n');
console.log(`wrote bin/known-hashes.json (${Object.keys(table.files).length} copied paths, ${tags.length} releases)`);
