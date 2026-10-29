'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSessions } = require('../bin/sessions.cjs');
const root = path.resolve(__dirname, '..');
// The CLI prints realpaths, and on macOS os.tmpdir() sits behind the /var -> /private/var link.
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-audit-084-')));
const cli = path.join(root, 'bin/agent-personalizer.js');
const renderer = path.join(root, 'render/render.cjs');
const begin = '<!-- agent-personalizer:begin -->';
const end = '<!-- agent-personalizer:end -->';
function write(dir, rel, text, mtime) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (mtime) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}
function run(script, args, home, expected = 0, extra = {}) {
  const out = spawnSync(process.execPath, [script, ...args], { cwd: home, encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home }, ...extra });
  assert.ifError(out.error);
  assert.equal(out.status, expected, out.stdout + out.stderr);
  return out.stdout + out.stderr;
}
function snapshot(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort().map(rel => {
    const file = path.join(dir, rel), stat = fs.lstatSync(file);
    return [rel, stat.mode, stat.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null];
  });
}
function record(id, timestamp) {
  return JSON.stringify({ type: 'user', sessionId: id, timestamp, message: { content: id } }) + '\n';
}
const cases = {
  async 'sessions-bounded-full-scan'(dir) {
    const expected = [];
    for (let i = 0; i < 25; i++) {
      const mtime = Date.UTC(2026, 9, 28) - i * 60000;
      const timestamp = mtime - (i % 4) * 1000;
      const file = write(dir, `.claude/projects/test/${i}.jsonl`, record(`session-${i}`, timestamp), mtime);
      expected.push({ file, sessionId: `session-${i}`, timestampMs: timestamp });
    }
    expected.sort((a, b) => b.timestampMs - a.timestampMs || a.file.localeCompare(b.file));
    const result = await readSessions({ home: dir, sources: ['claude-code'], allProjects: true });
    assert.deepEqual(result.sessions.map(s => s.sessionId), expected.slice(0, 20).map(s => s.sessionId), 'Selection equals the full-scan reference.');
    assert(result.filesRead.length <= 21, `Only contenders are read, got ${result.filesRead.length}.`);
  },
  async 'sessions-timestamp-validation'(dir) {
    const mtime = Date.UTC(2026, 9, 20);
    for (const [id, stamp] of [['future', '2999-01-01T00:00:00Z'], ['short', '1'], ['loose', 'Oct 5'], ['seconds', 1792000000], ['invalid', 'bad'], ['calendar', '2026-02-30T00:00:00Z'], ['millis', mtime - 1000], ['iso', '2026-10-19T00:00:00+00:00']]) {
      write(dir, `.claude/projects/test/${id}.jsonl`, record(id, stamp), mtime);
    }
    write(dir, '.claude/projects/test/recent.jsonl', record('recent', '2026-10-27T00:00:00Z'), Date.UTC(2026, 9, 28));
    const result = await readSessions({ home: dir, sources: ['claude-code'], allProjects: true });
    assert.equal(result.sessions[0].sessionId, 'recent', 'A future timestamp in an old file cannot rank first.');
    for (const session of result.sessions) {
      assert(Date.parse(session.date) <= session.mtimeMs, session.sessionId);
      if (['short', 'loose', 'seconds', 'invalid', 'calendar'].includes(session.sessionId)) {
        assert.equal(session.timestampMs, null, session.sessionId + ' falls back to mtime');
        assert.equal(Date.parse(session.date), mtime);
      }
      if (session.sessionId === 'millis') assert.equal(session.timestampMs, mtime - 1000);
      if (session.sessionId === 'iso') assert.equal(session.timestampMs, Date.UTC(2026, 9, 19));
    }
  },
  async 'gemini-full-scan-equivalence'(dir) {
    const chat = [{ sessionId: 'shared' }, { $set: { messages: [{ type: 'user', content: [{ text: 'Current Gemini message.' }] }] } }];
    write(dir, '.gemini/tmp/test/chats/session-shared.jsonl', chat.map(JSON.stringify).join('\n') + '\n', Date.UTC(2026, 9, 28));
    for (let i = 0; i < 20; i++) {
      write(dir, `.claude/projects/test/${i}.jsonl`, record(`claude-${i}`, Date.UTC(2026, 9, 20) - i * 60000), Date.UTC(2026, 9, 27) - i * 60000);
    }
    write(dir, '.gemini/tmp/test/logs.json', JSON.stringify([{ sessionId: 'shared', type: 'user', message: 'Older unique message.', timestamp: '2026-10-01T00:00:00Z' }]), Date.UTC(2026, 9, 25));
    const options = { home: dir, sources: ['claude-code', 'gemini-cli'], allProjects: true };
    const all = await readSessions(options);
    assert.deepEqual(all.sessions.map(s => s.sessionId), Array.from({ length: 20 }, (_, i) => `claude-${i}`), 'Later Gemini merges cannot displace an already discarded contender.');
    const one = await readSessions({ ...options, limit: 1 });
    assert.deepEqual(one.sessions, all.sessions.slice(0, 1), 'Limit does not change the full-scan ordering.');
    const gemini = await readSessions({ ...options, sources: ['gemini-cli'] });
    assert.deepEqual(gemini.sessions[0].messages, ['Current Gemini message.', 'Older unique message.'], 'Older files still contribute messages to a selected Gemini session.');
  },
  'global-foreign-block'(dir) {
    const original = `\ufeff# User\r\n${begin}\r\nForeign block\r\n${end}\r\nTail`;
    write(dir, '.claude/CLAUDE.md', original);
    const before = snapshot(dir);
    const message = run(cli, ['--global', '--ai', 'claude,agents', '--yes'], dir, 2);
    assert.match(message, /\.claude[/\\]CLAUDE\.md.*foreign agent-personalizer block/);
    assert.match(message, /remove/i);
    assert.deepEqual(snapshot(dir), before, 'Foreign block refusal leaves every byte and directory unchanged.');
    fs.unlinkSync(path.join(dir, '.claude/CLAUDE.md'));
    run(cli, ['--global', '--ai', 'claude', '--yes'], dir);
    run(cli, ['--global'], dir);
    write(dir, '.codex/AGENTS.md', original);
    const saved = snapshot(dir);
    run(cli, ['--global', '--ai', 'claude,agents', '--yes'], dir, 2);
    assert.deepEqual(snapshot(dir), saved, 'An unowned target also refuses on a saved install.');
  },
  'home-fail-closed'(dir) {
    const project = path.join(dir, 'project');
    run(cli, ['--dir', project, '--ai', 'claude', '--level', '1', '--yes'], dir);
    // Tripwire proves a missing HOME can never reach the passwd fallback or any write.
    const guard = write(dir, 'home-guard.cjs', `const fs = require('node:fs');
require('node:os').homedir = () => { throw new Error('HOME fallback reached'); };
for (const key of ['writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync']) fs[key] = () => { throw new Error('write reached'); };
`);
    const before = snapshot(dir);
    for (const value of [undefined, '', 'relative/path']) {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'HOME'));
      Object.assign(env, { USERPROFILE: dir, NODE_OPTIONS: `--require ${guard}` });
      if (value !== undefined) env.HOME = value;
      for (const args of [['--global', '--ai', 'claude', '--yes'], ['--global', '--uninstall'], ['learn', '--global', '--yes'], ['learn', '--dir', project, '--yes']]) {
        assert.match(run(cli, args, dir, 2, { env }), /HOME.*absolute/);
      }
      const source = `require(${JSON.stringify(path.join(root, 'bin/sessions.cjs'))}).readSessions().catch(e => { console.error(e.message); process.exit(e instanceof require(${JSON.stringify(renderer)}).Refusal ? 2 : 1); });`;
      assert.match(run('-e', [source], dir, 2, { env }), /HOME.*absolute/);
    }
    assert.deepEqual(snapshot(dir), before, 'Invalid HOME cannot create files in the fake directory.');
  },
  'upgrade-rerender-adoption'(dir) {
    for (const preserved of [false, true]) {
      const project = path.join(dir, preserved ? 'preserved' : 'project');
      for (const [rel, text] of Object.entries(require('./fixtures/level1-083.json'))) write(project, rel, text);
      if (preserved) {
        const cfgFile = path.join(project, '.agent-personalizer.json');
        const cfg = JSON.parse(fs.readFileSync(cfgFile));
        cfg.preservedTargets = ['claude'];
        fs.writeFileSync(cfgFile, JSON.stringify(cfg));
      }
      const file = path.join(project, 'CLAUDE.md');
      fs.writeFileSync(file, '\ufeff# Personal instructions\r\n' + fs.readFileSync(file, 'utf8') + '\r\nMy own tail');
      const install = ['--dir', project, '--ai', 'claude', '--level', '1', '--yes'];
      const kept = run(cli, install, dir);
      assert.match(kept, /kept\s+CLAUDE\.md/);
      assert(kept.includes(`node '${renderer}' --dir '${project}' --targets claude`), 'Kept notice includes the exact usable re-render command.');
      run(renderer, ['--dir', project, '--targets', 'claude'], dir);
      const rendered = fs.readFileSync(file);
      const message = run(cli, install, dir);
      assert(!/kept\s+CLAUDE\.md/.test(message), 'Explicit re-render clears the kept notice.');
      assert(fs.readFileSync(file).equals(rendered), 'Adoption preserves outside bytes.');
      const cfg = JSON.parse(fs.readFileSync(path.join(project, '.agent-personalizer.json')));
      assert(!cfg.keptRuleTargets.includes('claude'));
      assert.equal(cfg.installed['CLAUDE.md'], crypto.createHash('sha256').update(rendered).digest('hex'));
      run(cli, ['--uninstall', '--dir', project], dir);
      const outside = fs.readFileSync(file, 'utf8');
      assert(outside.startsWith('\ufeff# Personal instructions\r\n') && outside.endsWith('\r\nMy own tail'), 'Uninstall preserves the adopted outer user text.');
      assert(!outside.includes(begin));
    }
  },
  'package-links-inline-comment'(dir) {
    write(dir, 'package.json', JSON.stringify({ name: 'audit-links-fixture', version: '1.0.0' }));
    write(dir, 'README.md', 'Inline `<!--` example.\n\n[Broken](missing.md)\n');
    const message = run(path.join(root, 'test/package-links.cjs'), ['--repo', dir], dir, 1);
    assert.match(message, /README\.md: missing\.md/);
  }
};
async function main() {
  let failed = 0;
  for (const [name, test] of Object.entries(cases)) {
    if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
    const dir = path.join(temp, name);
    fs.mkdirSync(dir);
    try { await test(dir); console.log(`PASS audit 0.8.4 ${name}`); }
    catch (error) { failed++; console.error(`FAIL audit 0.8.4 ${name}: ${error.message}`); }
  }
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
