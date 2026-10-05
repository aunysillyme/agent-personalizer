/* Exercises the exact event-only workflow script, and keeps its agreement text in sync.
   usage: node test/cla.test.js [repo-root]   exit 0 = all assertions pass */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const root = process.argv[2] || path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const agreement = 'I agree to the Contributor License Agreement in CLA.md';
const workflow = read('.github/workflows/cla.yml');
const template = read('.github/pull_request_template.md');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log(`ok: ${label}`); }

check('template and workflow use the exact agreement line', () => {
  assert(template.split('\n').includes(`- [ ] ${agreement}`), 'template agreement line drifted');
  assert(workflow.includes(`- [x] ${agreement}`), 'workflow agreement line drifted');
});
check('workflow uses only the requested pull_request events and no token scopes', () => {
  assert.match(workflow, /^name: cla$/m);
  assert.match(workflow, /^on:\n  pull_request:\n    types: \[opened, edited, reopened, synchronize\]\n/m);
  assert(!workflow.includes('pull_request_target'));
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.strictEqual((workflow.match(/permissions:/g) || []).length, 1);
  assert.strictEqual((workflow.match(/^  \w+:$/gm) || []).length, 2); // event and job
  assert.match(workflow, /^    runs-on: ubuntu-latest$/m);
  assert(!workflow.includes('uses:'));
});
const block = workflow.match(/^        run: \|\n((?:          .*\n)+)$/m);
assert(block, 'workflow must have one final literal run block');
const script = block[1].replace(/^          /gm, '');
check('PR body reaches the script only through env', () => {
  assert.match(workflow, /^        env:\n          PR_BODY: \$\{\{ github.event.pull_request.body \}\}$/m);
  assert(!script.includes('${{'), 'event expressions must never enter run');
  assert(script.includes('process.env.PR_BODY'));
  assert.strictEqual((workflow.match(/run:/g) || []).length, 1);
});

const condition = workflow.match(/^    if: "(.+)"$/m);
assert(condition, 'job must have a skip condition');
const expression = JSON.parse(`"${condition[1]}"`);
const expected = "!contains(fromJSON('[\"OWNER\", \"MEMBER\", \"COLLABORATOR\"]'), github.event.pull_request.author_association) && github.event.pull_request.user.type != 'Bot'";
assert.strictEqual(expression, expected, 'skip policy drifted');
function needsAgreement(association, type) {
  return vm.runInNewContext(expression, {
    contains: (values, value) => values.includes(value), fromJSON: JSON.parse,
    github: { event: { pull_request: { author_association: association, user: { type } } } }
  });
}
for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
  check(`${association} skips with an empty body`, () => assert.strictEqual(needsAgreement(association, 'User'), false));
}
check('Bot skips with an empty body', () => assert.strictEqual(needsAgreement('NONE', 'Bot'), false));
for (const association of ['NONE', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'CONTRIBUTOR']) {
  check(`${association} requires agreement`, () => assert.strictEqual(needsAgreement(association, 'User'), true));
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cla-test-'));
try {
  function run(body) {
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: tmp, env: { ...process.env, PR_BODY: body }, encoding: 'utf8'
    });
    assert.ifError(result.error);
    return result;
  }
  const red = [
    ['unticked', `- [ ] ${agreement}`],
    ['empty', ''],
    ['text only', agreement],
    ['wrong text', '- [x] I agree to the Contributor License Agreement'],
    ['suffix', `- [x] ${agreement} extra`],
    ['embedded line', `quoted - [x] ${agreement}`],
    ['hidden comment', `<!--\n- [x] ${agreement}\n-->`],
    ['unclosed comment', `<!--\n- [x] ${agreement}`]
  ];
  for (const [label, body] of red) {
    check(`RED ${label}: workflow exit 1`, () => {
      const result = run(body);
      assert.strictEqual(result.status, 1, result.stderr);
      assert(result.stderr.includes('::error::Tick the Contributor License Agreement box in the PR description'));
      assert(result.stderr.includes('[CLA.md](CLA.md)'));
    });
  }
  for (const body of [`- [x] ${agreement}`, `- [X] ${agreement}`, `* [x] ${agreement}`, `intro\n- [x] ${agreement}\n`, `- [x] ${agreement}\r\n`, `  - [x] ${agreement}  `, `<!-- note -->\n- [x] ${agreement}`]) {
    check(`checked line ${JSON.stringify(body)}: workflow exit 0`, () => assert.strictEqual(run(body).status, 0));
  }
  check('shell payload stays data: workflow exit 0 and no file created', () => {
    const sentinel = path.join(tmp, 'pwned');
    const fixedSentinel = '/tmp/pwned';
    const before = fs.existsSync(fixedSentinel) ? fs.statSync(fixedSentinel).mtimeMs : null;
    assert.strictEqual(run(`$(touch /tmp/pwned)\n$(touch ${sentinel})\n- [x] ${agreement}`).status, 0);
    assert(!fs.existsSync(sentinel));
    const after = fs.existsSync(fixedSentinel) ? fs.statSync(fixedSentinel).mtimeMs : null;
    assert.strictEqual(after, before, 'fixed shell payload executed');
    assert(script.includes("node <<'NODE'"));
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`CLA tests: ${passed} passed, 0 failed, 0 skipped`);
