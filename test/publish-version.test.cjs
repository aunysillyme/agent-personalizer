'use strict';
// Exercise the workflow's actual trusted-publishing version gate without fetching npm.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/publish.yml'), 'utf8');
const script = workflow.match(/npm --version \| node -e '\n([\s\S]*?)\n\s*'/);
assert(script, 'workflow must check its bundled npm version');
for (const [version, expected] of [['10.9.9', 1], ['11.4.9', 1], ['11.5.0', 1], ['11.5.1', 0], ['11.6.0', 0], ['12.0.0', 0], ['invalid', 1], ['11.5.1-beta.1', 1]]) {
  const result = spawnSync(process.execPath, ['-e', script[1]], { input: version + '\n', encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, expected, version + ': ' + result.stdout + result.stderr);
}
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const fallback = JSON.parse(fs.readFileSync(path.join(__dirname, '../website/release-fallback.json'), 'utf8'));
assert.equal(fallback.version, pkg.version, 'website/release-fallback.json must match package.json version');
console.log('PASS publishing: workflow rejects npm below 11.5.1, accepts supported releases, and pins release-fallback.json');
