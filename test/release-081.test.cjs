'use strict';

// 0.8.1 regressions. Pass F1..F7 to isolate a finding, or run every case.
// Exercises bin/uninstall.cjs and bin/learn.cjs through the CLI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin/agent-personalizer.js');
const RENDER = path.join(ROOT, 'render/render.cjs');
const CONFIG = '.agent-personalizer.json';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'personalizer-081-'));
const home = path.join(scratch, 'home');
fs.mkdirSync(home);

function run(script, args, options = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home }, ...options });
  assert.ifError(r.error);
  return { code: r.status, output: r.stdout + r.stderr };
}
function code(result, expected) { assert.equal(result.code, expected, result.output); }
function read(dir, rel) { return fs.readFileSync(path.join(dir, rel)); }
function install(dir, ai = 'agents', level = 1) { code(run(CLI, ['--dir', dir, '--ai', ai, '--level', String(level), '--yes']), 0); }
function render(dir, ...args) { return run(RENDER, ['--dir', dir, ...args]); }
function uninstall(dir, ...args) { return run(CLI, ['--uninstall', '--dir', dir, ...args]); }

const cases = {
  'F1-rerender-user-bytes'(dir) {
    install(dir, 'claude', 3);
    const file = path.join(dir, 'CLAUDE.md');
    const prefix = '# My own instruction\r\n', suffix = '\nKeep my café project note.\r\n';
    fs.writeFileSync(file, prefix + read(dir, 'CLAUDE.md') + suffix);
    // Both a no-op render and a changed source must leave outer user bytes unowned.
    code(render(dir), 0);
    fs.appendFileSync(path.join(dir, 'USER.md'), '\nA changed profile.\n');
    code(render(dir), 0);
    code(render(dir, '--check'), 0);
    const before = read(dir, 'CLAUDE.md');
    code(uninstall(dir, '--dry'), 0);
    assert.deepEqual(read(dir, 'CLAUDE.md'), before);
    code(uninstall(dir), 0);
    const after = read(dir, 'CLAUDE.md').toString();
    assert(after.startsWith(prefix) && after.endsWith(suffix), 'uninstall must retain every user byte after re-render');
  },
  'F2-notes-paths'(dir) {
    for (const notes_path of ['.agent-personalizer', '.agent-personalizer/notes', '.AGENT-PERSONALIZER/Notes', 'render/notes', 'rules', 'check/notes', 'hooks', '.claude/notes', 'CLAUDE.md/notes']) {
      const r = run(CLI, ['--dir', dir, '--ai', 'agents', '--level', '2', '--answers', '-', '--yes'], { input: JSON.stringify({ notes_path }) });
      code(r, 2);
      assert.match(r.output, /notes_path.*tool-owned/);
      assert.deepEqual(fs.readdirSync(dir), [], 'refused notes paths must write nothing');
    }
    const onboarding = require('../render/onboarding.cjs');
    assert.equal(onboarding.validate({ notes_path: 'docs/vault' }).notes_path, 'docs/vault');
    assert.equal(onboarding.validate({ notes_tool: 'notion', notes_path: '.agent-personalizer' }).notes_path, '.agent-personalizer');
  },
  'F2-unrecorded-digest-files'(dir) {
    install(dir);
    code(run(CLI, ['learn', '--dir', dir, '--yes']), 0);
    const folder = path.join(dir, '.agent-personalizer');
    fs.mkdirSync(path.join(folder, 'mine/empty'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'mine/note.md'), 'Keep this user note.\r\n');
    // A user edit to a formerly generated digest is retained too.
    fs.appendFileSync(path.join(folder, 'digest.md'), '\nMy added evidence.\n');
    const before = read(dir, '.agent-personalizer/digest.md');
    code(uninstall(dir, '--dry'), 0);
    assert(fs.existsSync(path.join(folder, '.gitignore')), 'preview leaves recorded output alone');
    code(uninstall(dir), 0);
    assert.deepEqual(read(dir, '.agent-personalizer/mine/note.md'), Buffer.from('Keep this user note.\r\n'));
    assert.deepEqual(read(dir, '.agent-personalizer/digest.md'), before);
    assert(fs.statSync(path.join(folder, 'mine/empty')).isDirectory(), 'unrecorded empty folders stay');
    assert(!fs.existsSync(path.join(folder, '.gitignore')), 'unchanged recorded output is removed');
  },
  'F3-config-transaction'(dir) {
    install(dir, 'claude,agents');
    fs.appendFileSync(path.join(dir, 'USER.md'), '\nChanged profile for rollback.\n');
    const names = ['CLAUDE.md', 'AGENTS.md', 'AGENT_ONBOARDING.md', CONFIG];
    const before = names.map(name => read(dir, name));
    fs.chmodSync(path.join(dir, CONFIG), 0o640);
    for (const fault of ['stage', 'commit']) {
      const injection = `
        const fs = require('fs'), path = require('path');
        const write = fs.writeFileSync, rename = fs.renameSync;
        fs.writeFileSync = (p, ...args) => {
          if (${JSON.stringify(fault)} === 'stage' && path.basename(p).startsWith('..agent-personalizer.json.') && p.endsWith('.tmp')) throw new Error('injected config staging failure');
          return write(p, ...args);
        };
        fs.renameSync = (a, b) => {
          if (${JSON.stringify(fault)} === 'commit' && path.basename(b) === ${JSON.stringify(CONFIG)} && a.endsWith('.tmp')) throw new Error('injected config commit failure');
          return rename(a, b);
        };
        process.argv = ['node', ${JSON.stringify(RENDER)}, '--dir', ${JSON.stringify(dir)}];
        require(${JSON.stringify(RENDER)}).main();`;
      const r = run('-e', [injection]);
      code(r, 2);
      assert.match(r.output, /render:.*could not (stage|commit) output/);
      assert.match(r.output, /Every target was restored/);
      assert.doesNotMatch(r.output, /\n\s+at /, 'failure must have a clean diagnostic');
      names.forEach((name, i) => assert.deepEqual(read(dir, name), before[i], name + ' must roll back'));
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, CONFIG)).mode & 0o777, 0o640);
      assert(!fs.readdirSync(dir).some(name => /\.agent-personalizer\.(tmp|bak)$/.test(name)));
    }
    code(render(dir), 0);
    code(render(dir, '--check'), 0);
    assert.notDeepEqual(read(dir, 'CLAUDE.md'), before[0], 'a successful transaction still updates targets');
  },
  'F4-final-private-filter'() {
    const context = { require, module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'bin/sessions.cjs'), 'utf8') + '\nmodule.exports.probe = typedText;', context);
    const typedText = context.module.exports.probe;
    for (const items of [
      ['Ask Secret<system-reminder>x</system-reminder>FixturePerson.'],
      ['Ask Secret<pasted_content>x</pasted_content>FixturePerson.'],
      ['Ask SeCrEt<system-reminder><pasted_content>x</pasted_content></system-reminder>FixturePerson.'],
      ['Ask Secre\u0301t<system-reminder>x</system-reminder>FixturePerson.'],
      ['Ask Secret', '# AGENTS.md instructions hidden context', 'FixturePerson.'],
      ['Ask Secret<system-reminder>x</system-reminder>', 'FixturePerson.']
    ]) {
      const state = { privateTerms: ['secretfixtureperson', 'secrétfixtureperson'], skipped: {} };
      assert.equal(typedText(items, state), null, 'private terms created by transformations must drop the whole message');
      assert.equal(state.skipped.private_match, 1);
    }
    assert.equal(typedText(['Keep <system-reminder>x</system-reminder>this.'], { privateTerms: [], skipped: {} }), 'Keep this.');
  },
  'F5-declined-budget'(dir) {
    install(dir, 'chatgpt');
    fs.appendFileSync(path.join(dir, 'LEARNED.md'), '\n## Learned\n- [said, confirmed] CONFIRMED_EXAMPLE Keep this.\n- [said, declined] DECLINED_EXAMPLE ' + 'x'.repeat(1600) + '\n- [said, declined] DECLINED_SHORT Never retry.\n');
    const names = ['chatgpt-custom-instructions.md', 'chatgpt-box1.txt', 'chatgpt-box2.txt', CONFIG];
    const before = names.map(name => read(dir, name));
    const strict = render(dir, '--strict');
    code(strict, 1);
    assert.match(strict.output, /OVER BUDGET/);
    names.forEach((name, i) => assert.deepEqual(read(dir, name), before[i]));
    const normal = render(dir);
    code(normal, 0);
    assert.match(normal.output, /OVER BUDGET/);
    for (const name of ['chatgpt-custom-instructions.md', 'chatgpt-box1.txt']) {
      const text = read(dir, name).toString();
      for (const entry of ['CONFIRMED_EXAMPLE', 'DECLINED_EXAMPLE ' + 'x'.repeat(1600), 'DECLINED_SHORT']) assert(text.includes(entry));
    }
    code(render(dir, '--check'), 0);
    code(render(dir, '--strict', '--check'), 1);
  },
  'F6-bom-byte-fidelity'(dir) {
    const user = Buffer.from('\ufeff# Keep my café instructions\r\n');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), user);
    install(dir);
    code(render(dir), 0);
    const before = read(dir, 'AGENTS.md');
    assert.deepEqual(before.subarray(0, user.length), user);
    code(render(dir, '--check'), 0);
    assert.deepEqual(read(dir, 'AGENTS.md'), before, '--check must be read only');
    code(uninstall(dir), 0);
    assert.deepEqual(read(dir, 'AGENTS.md'), user);
    const bare = path.join(dir, 'bare');
    // Editable custom rules belong to level 3; levels 1/2 select the Core 5.
    install(bare, 'gemini', 3);
    fs.writeFileSync(path.join(bare, 'GEMINI.md'), Buffer.concat([Buffer.from('\ufeff'), read(bare, 'GEMINI.md')]));
    code(render(bare), 0);
    code(render(bare, '--check'), 0);
    assert.deepEqual(read(bare, 'GEMINI.md').subarray(0, 3), Buffer.from('\ufeff'), 'a BOM immediately before the begin marker stays too');
    fs.writeFileSync(path.join(bare, 'USER.md'), Buffer.concat([Buffer.from('\ufeff'), read(bare, 'USER.md')]));
    fs.mkdirSync(path.join(bare, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(bare, 'rules/00-bom.md'), '\ufeff---\nid: 00-bom\n---\n## universal\nA BOM source still parses.\n');
    code(render(bare), 0);
    code(render(bare, '--check'), 0);
    assert(read(bare, 'GEMINI.md').includes(Buffer.from('A BOM source still parses.')));
    code(uninstall(bare), 0);
    assert.deepEqual(read(bare, 'GEMINI.md').subarray(0, 3), Buffer.from('\ufeff'));
  },
  'F7-demo-current-prompts'() {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/record-demo.sh'), 'utf8');
    const python = source.match(/<<'PY'\n([\s\S]*?)\nPY/)[1];
    // Exercise the recorder's actual prompt patterns offline, including varying AI defaults.
    const prelude = python.slice(0, python.indexOf('print("$ "'));
    const probe = prelude + `
assert len(answers) == 3
assert re.search(answers[0][0], 'Folder to install into [.]: ')
for default in ['claude,agents', 'agents', 'claude,agents,gemini']:
    assert re.search(answers[1][0], 'AIs [' + default + ']: ')
assert re.search(answers[2][0], 'Read your last 20 sessions? (y/N) ')
assert answers[2][1] == ''
assert 're.search(prompt.encode(), pending)' in ${JSON.stringify(python)}
`;
    const r = spawnSync('python3', ['-c', probe, 'offline-package', scratch], { encoding: 'utf8' });
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  },
  'A1a-newline-split-private'() {
    const context = { require, module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'bin/sessions.cjs'), 'utf8') + '\nmodule.exports.probe = typedText;', context);
    const typedText = context.module.exports.probe;
    const state = { privateTerms: ['secretfixtureperson'], skipped: {} };
    assert.equal(typedText(['Ask Secret\n<system-reminder>x</system-reminder>FixturePerson.'], state), null);
    assert.equal(state.skipped.private_match, 1);
  },
  'A1b-spaced-term-private'() {
    const context = { require, module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'bin/sessions.cjs'), 'utf8') + '\nmodule.exports.probe = typedText;', context);
    const typedText = context.module.exports.probe;
    for (const items of [
      ['Ask Secret <system-reminder>x</system-reminder>', 'FixturePerson.'],
      ['Ask Secret', '# AGENTS.md instructions hidden context', 'FixturePerson.']
    ]) {
      const state = { privateTerms: ['secret fixtureperson'], skipped: {} };
      assert.equal(typedText(items, state), null);
      assert.equal(state.skipped.private_match, 1);
    }
    assert.equal(typedText(['Ask Someone Else.'], { privateTerms: ['secret fixtureperson'], skipped: {} }), 'Ask Someone Else.');
  },
  'A2-bom-fence'(dir) {
    const fenced = Buffer.from('\ufeff```\nexample\n```\n');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), fenced);
    install(dir, 'agents', 1);
    code(render(dir), 0);
    code(render(dir, '--check'), 0);
    code(uninstall(dir), 0);
    assert.deepEqual(read(dir, 'AGENTS.md'), fenced);
    const quoted = path.join(dir, 'quoted');
    fs.mkdirSync(quoted);
    const quotedBytes = Buffer.from('\ufeff```\n<!-- agent-personalizer:begin -->\nquoted example\n<!-- agent-personalizer:end -->\n```\n');
    fs.writeFileSync(path.join(quoted, 'AGENTS.md'), quotedBytes);
    install(quoted, 'agents', 1);
    code(render(quoted), 0);
    code(render(quoted, '--check'), 0);
    assert.deepEqual(read(quoted, 'AGENTS.md').subarray(0, quotedBytes.length), quotedBytes);
    code(uninstall(quoted), 0);
    assert.deepEqual(read(quoted, 'AGENTS.md'), quotedBytes);
  },
  'A3-legacy-config-installed'(dir) {
    install(dir, 'agents', 1);
    const cfgPath = path.join(dir, CONFIG);
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    delete raw.installed;
    fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2) + '\n');
    code(render(dir), 0);
    code(render(dir, '--check'), 0);
    assert(!Object.hasOwn(JSON.parse(fs.readFileSync(cfgPath, 'utf8')), 'installed'), 'legacy config without installed must stay on legacy path');
    code(uninstall(dir), 0);
    assert.deepEqual(fs.readdirSync(dir), ['LEARNED.md']);
    const outer = path.join(dir, 'outer');
    install(outer, 'agents', 1);
    const outerCfg = JSON.parse(fs.readFileSync(path.join(outer, CONFIG), 'utf8'));
    delete outerCfg.installed;
    fs.writeFileSync(path.join(outer, CONFIG), JSON.stringify(outerCfg, null, 2) + '\n');
    fs.appendFileSync(path.join(outer, 'AGENTS.md'), '\nKEEP_LEGACY_OUTER\n');
    code(render(outer), 0);
    code(uninstall(outer), 0);
    assert(read(outer, 'AGENTS.md').toString().includes('KEEP_LEGACY_OUTER'));
  },
  'A4-bom-learned'(dir) {
    install(dir, 'agents', 1);
    fs.writeFileSync(path.join(dir, 'LEARNED.md'), '\ufeff## Learned\n- [said, confirmed] KEEP_REPLIES_SHORT_BOM\n- [said, declined] NEVER_ASK_TABS_BOM\n');
    code(render(dir), 0);
    code(render(dir, '--check'), 0);
    const text = read(dir, 'AGENTS.md').toString();
    assert(text.includes('KEEP_REPLIES_SHORT_BOM'));
    assert(text.includes('NEVER_ASK_TABS_BOM'));
  },
  'A5-learn-preserves-edited'(dir) {
    install(dir, 'agents', 1);
    code(run(CLI, ['learn', '--dir', dir, '--yes']), 0);
    const ignorePath = path.join(dir, '.agent-personalizer/.gitignore');
    const digestPath = path.join(dir, '.agent-personalizer/digest.md');
    fs.appendFileSync(ignorePath, '!/mine/\n');
    fs.appendFileSync(digestPath, '\nMy digest note.\n');
    const ignoreBefore = fs.readFileSync(ignorePath);
    const digestBefore = fs.readFileSync(digestPath);
    code(run(CLI, ['learn', '--dir', dir, '--yes']), 0);
    assert.deepEqual(fs.readFileSync(ignorePath), ignoreBefore);
    assert.deepEqual(fs.readFileSync(digestPath), digestBefore);
    code(uninstall(dir), 0);
    assert.deepEqual(fs.readFileSync(ignorePath), ignoreBefore);
    assert.deepEqual(fs.readFileSync(digestPath), digestBefore);
    const pre = path.join(dir, 'pre');
    install(pre, 'agents', 1);
    fs.mkdirSync(path.join(pre, '.agent-personalizer'));
    fs.writeFileSync(path.join(pre, '.agent-personalizer/.gitignore'), '# custom ignore\n');
    fs.writeFileSync(path.join(pre, '.agent-personalizer/digest.md'), '# custom digest\n');
    code(run(CLI, ['learn', '--dir', pre, '--yes']), 0);
    const preCfg = JSON.parse(read(pre, CONFIG).toString());
    assert(!Object.hasOwn(preCfg.installed, '.agent-personalizer/.gitignore'));
    assert(!Object.hasOwn(preCfg.installed, '.agent-personalizer/digest.md'));
    code(uninstall(pre), 0);
    assert.equal(read(pre, '.agent-personalizer/.gitignore').toString(), '# custom ignore\n');
    assert.equal(read(pre, '.agent-personalizer/digest.md').toString(), '# custom digest\n');
  },
  'A6-control-char-private'(dir) {
    const context = { require, module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'bin/sessions.cjs'), 'utf8') + '\nmodule.exports.probe = typedText;', context);
    const typedText = context.module.exports.probe;
    const state = { privateTerms: ['secretfixtureperson'], skipped: {} };
    assert.equal(typedText(['Ask Secret\u007fFixturePerson.'], state), null);
    assert.equal(state.skipped.private_match, 1);
    install(dir, 'claude,agents', 3);
    fs.writeFileSync(path.join(dir, 'check/forbidden.local.txt'), 'SecretFixturePerson\n');
    const realDir = fs.realpathSync(dir);
    const slug = realDir.replace(/[:\\/]/g, '-');
    const claudeDir = path.join(home, '.claude/projects', slug);
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'ctrl.jsonl'), JSON.stringify({ type: 'user', cwd: realDir, message: { content: 'Ask Secret\u007fFixturePerson.' } }) + '\n');
    const memDir = path.join(home, '.codex/memories');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'ctrl.md'), 'Remember Secret\u007fFixturePerson.\n');
    code(run(CLI, ['learn', '--dir', dir, '--yes']), 0);
    const digest = read(dir, '.agent-personalizer/digest.md').toString();
    assert(!/secretfixtureperson/i.test(digest), 'control-char split private term must not enter digest.md');
  }
};

const matchesId = (name, id) => name === id || name.startsWith(id + '-') || (id === 'A1' && /^A1[ab]-/.test(name));
let failed = 0;
const selected = process.argv.slice(2);
try {
  if (selected.some(id => !Object.keys(cases).some(name => matchesId(name, id)))) throw new Error('Unknown case');
  for (const [name, test] of Object.entries(cases)) {
    if (selected.length && !selected.some(id => matchesId(name, id))) continue;
    const dir = path.join(scratch, name);
    fs.mkdirSync(dir);
    try { test(dir); console.log('PASS 0.8.1 ' + name); }
    catch (error) { failed++; console.error('FAIL 0.8.1 ' + name + ': ' + error.message); }
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
