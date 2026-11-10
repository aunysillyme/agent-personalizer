'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflowDir = path.join(root, '.github/workflows');
for (const name of fs.readdirSync(workflowDir)) {
  const content = fs.readFileSync(path.join(workflowDir, name), 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('uses: actions/checkout@')) {
      assert.match(lines.slice(i + 1, i + 4).join('\n'), /persist-credentials: false/, name);
    }
  }
}
const publish = fs.readFileSync(path.join(workflowDir, 'publish.yml'), 'utf8');
const [verify, release] = publish.split('\n  publish:\n');
assert(verify && release && /\n  verify:\n/.test(verify));
assert(!/id-token: write/.test(verify));
assert.match(release, /id-token: write/);
assert.match(verify, /npm pack --silent/);
assert.match(verify, /npm install --ignore-scripts --no-audit --no-fund "\$tarball"/);
assert.match(verify, /agent-personalizer" --help/);
assert.match(verify, /actions\/upload-artifact@[0-9a-f]{40}/);
assert.match(release, /actions\/download-artifact@[0-9a-f]{40}/);
assert.match(release, /npm publish "\$1" --provenance --access public/);
console.log('PASS security: checkout credentials and verified release artifact');
