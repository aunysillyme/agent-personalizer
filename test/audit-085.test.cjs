'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSessions } = require('../bin/sessions.cjs');
const onboarding = require('../render/onboarding.cjs');
const { consentScreen } = require('../bin/learn.cjs');
const root = path.resolve(__dirname, '..');
// Claude's encoded project path is one filename, so keep it below the filename limit.
const temp = fs.realpathSync(fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'ap85-')));
const cli = path.join(root, 'bin/agent-personalizer.js');
function write(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
function run(args, cwd, expected = 0) {
  const out = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: cwd, USERPROFILE: cwd } });
  assert.ifError(out.error);
  assert.equal(out.status, expected, out.stdout + out.stderr);
  return out.stdout + out.stderr;
}
function install(dir, answers = {}, level = '3') {
  const file = write(dir, 'answers.json', JSON.stringify(answers));
  return run(['--dir', path.join(dir, 'project'), '--ai', 'claude,agents,gemini', '--level', level, '--answers', file, '--yes'], dir);
}
function user(text, cwd) {
  return JSON.stringify({ type: 'user', cwd, message: { content: text } }) + '\n';
}
// Synthetic token shapes only. Assertions never print the matching content.
function secrets() {
  const body = 'A'.repeat(40);
  // Header lines are assembled so no PEM block marker sits in the source for scanners to flag.
  const pem = ['', 'RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED '].map(kind => '-----BEGIN ' + kind + 'PRIVATE' + ' KEY-----');
  return [...pem, 'sk-' + body,
    ...['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', 'xoxb-', 'xoxa-', 'xoxp-', 'xoxr-', 'xoxs-', 'AIza'].map(prefix => prefix + body),
    'AKIA' + 'A'.repeat(16), 'Bearer ' + body,
    ...['api_key', 'api-key', 'apikey', 'secret', 'token', 'password', 'passwd'].flatMap(key => [key + ': ' + body, key.toUpperCase() + '=' + body])];
}
const cases = {
  async 'claude-project-names'(dir) {
    const project = path.join(dir, 'My Project.v1_under');
    const variants = [project.replace(/[^a-zA-Z0-9]/g, '-'), project.replace(/[^a-zA-Z0-9_]/g, '-'), project.replace(/[\\/]/g, '-'), project.replace(/[:\\/]/g, '-')];
    const names = [...new Set(variants)];
    for (const [i, name] of names.entries()) write(dir, `.claude/projects/${name}/session.jsonl`, user(`Found variant ${i}`, project));
    const data = await readSessions({ home: dir, projectDir: project, sources: ['claude-code'] });
    assert.equal(data.sessions.length, names.length, 'Find spaces, dots, underscores and legacy project names.');
  },
  async 'secret-messages'(dir) {
    const content = secrets().map(text => user([{ type: 'text', text: 'Whole message must go.' }, { type: 'text', text }])).join('');
    const split = user([{ type: 'text', text: 'sk-' }, { type: 'text', text: 'A'.repeat(40) }]);
    write(dir, '.claude/projects/test/session.jsonl', content + split + user('Keep this ordinary correction.'));
    const data = await readSessions({ home: dir, sources: ['claude-code'], allProjects: true });
    assert(data.sessions.flatMap(s => s.messages).join('\n') === 'Keep this ordinary correction.', 'Drop each secret-bearing message whole.');
    assert.equal(data.skipped.secret, secrets().length + 1, 'Report only the secret skip count.');
  },
  async 'secret-memories'(dir) {
    for (const [i, text] of secrets().entries()) {
      const home = path.join(dir, String(i));
      write(home, '.codex/memories/note.md', 'An ordinary note.\n' + text);
      const data = await readSessions({ home, sources: ['codex'] });
      assert(data.memories.length === 0, 'Drop the entire secret-bearing note.');
      assert.equal(data.skipped.secret, 1);
    }
  },
  async 'memory-length-private-cap'(dir) {
    write(dir, '.codex/memories/long.md', 'x'.repeat(2001));
    write(dir, '.codex/memories/private.md', 'Meet PRIVATE_PERSON tomorrow.');
    write(dir, '.codex/memories/kept.md', 'x'.repeat(2000));
    const data = await readSessions({ home: dir, sources: ['codex'], privateTerms: ['private_person'] });
    assert.equal(data.memories.length, 1, 'Apply the message length cap to memory notes too.');
    assert.equal(data.memories[0].text.length, 2000);
    assert.equal(data.skipped.long_message, 1);
    assert.equal(data.skipped.private_match, 1);
    for (let i = 0; i < 25; i++) write(dir, `.codex/memories/extra-${i}.md`, 'A short note.');
    const capped = await readSessions({ home: dir, sources: ['codex'] });
    assert(capped.memories.length <= 20);
    assert.equal(capped.skipped.memory_limit, 8);
  },
  'read-first-literal-underscores'() {
    const answers = onboarding.validate({ read_first: ['AGENT_ONBOARDING.md', 'my_file_name.md', '*emphasis*', '`code`', '<tag>', '[link](x)', '# heading'] });
    for (const text of [onboarding.renderOnboarding(answers), onboarding.contractBlock(answers)]) {
      assert(text.includes('AGENT_ONBOARDING.md') && text.includes('my_file_name.md'), 'Filenames keep intra-word underscores.');
      for (const escaped of ['\\*emphasis\\*', '\\`code\\`', '\\<tag\\>', '\\[link\\](x)', '\\# heading']) assert(text.includes(escaped), 'Hostile Markdown stays escaped.');
    }
    assert.throws(() => onboarding.validate({ read_first: ['file\n# injected'] }), /plain strings/);
  },
  'notes-reserved-segments'(dir) {
    for (const segment of ['.git', '.GiT', '.github', '.GitHub', 'node_modules', 'NODE_MODULES']) {
      for (const notesPath of [segment, `docs/${segment}/notes`]) {
        const file = write(dir, 'answers.json', JSON.stringify({ notes_path: notesPath }));
        const out = run(['--dir', path.join(dir, 'project'), '--ai', 'agents', '--level', '2', '--answers', file, '--yes'], dir, 2);
        assert(out.includes(segment), 'The refusal names the reserved segment.');
        assert(!fs.existsSync(path.join(dir, 'project')), 'Refuse before creating any project files.');
      }
    }
  },
  'installed-homes-no-templates'(dir) {
    install(dir);
    for (const file of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
      assert(!fs.readFileSync(path.join(dir, 'project', file), 'utf8').includes('templates/'), `${file} names only installed paths.`);
    }
  },
  'hook-documented-subfolder'(dir) {
    install(dir);
    const project = path.join(dir, 'project');
    const cwd = path.join(project, 'nested');
    fs.mkdirSync(cwd);
    const doc = fs.readFileSync(path.join(root, 'hooks/README.md'), 'utf8');
    const json = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)[1]);
    const command = json.hooks.SessionStart[0].hooks[0].command;
    const out = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
    assert.ifError(out.error);
    assert.equal(out.status, 0, out.stderr);
    const expected = spawnSync(process.execPath, [path.join(project, 'render/render.cjs'), '--dir', project, '--contract', '--contract-target', 'claude'], { encoding: 'utf8' });
    assert.equal(expected.status, 0, expected.stderr);
    assert.equal(out.stdout, expected.stdout);
    assert(out.stdout.includes('Read first:'));
    assert(doc.includes('absolute path'), 'User-level settings explain the absolute project path.');
  },
  'git-note-off-limits'(dir) {
    const git = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
    assert.ifError(git.error);
    assert.equal(git.status, 0, git.stderr);
    const out = install(dir, { off_limits: ['private-topic'] }, '1');
    const note = out.split('\n').find(line => line.startsWith('NOTE:'));
    assert(note && /off.limits/i.test(note) && /profile/.test(note) && /may be committed/.test(note), 'Warn that profile and off-limits names may be committed.');
    for (const name of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) assert(note.includes(name));
    assert(!note.includes('private-topic'), 'The warning lists file names, not private answers.');
  },
  'consent-and-docs'() {
    const doc = fs.readFileSync(path.join(root, 'docs/learning.md'), 'utf8');
    assert.equal(doc.match(/```text\n([\s\S]*?)\n```/)[1], consentScreen());
    for (const allProjects of [false, true]) {
      const screen = consentScreen({ allProjects });
      assert(/global to your Codex account/.test(screen) && /not limited to this folder/.test(screen));
      assert(/messages that look like secrets are skipped/i.test(screen));
    }
    assert(doc.includes('~/.agent-personalizer/check/forbidden.local.txt'));
    assert(doc.includes('`secret`'));
  },
  'cli-guidance'(dir) {
    assert.match(run(['--help'], dir), /learn --global/);
    const error = run(['--dir', path.join(dir, 'project'), '--ai', 'claude', '--level', '5', '--yes'], dir, 2);
    assert.match(error, /1, 2 or 3.*4.*accepted as 3/);
    assert(!fs.readFileSync(path.join(root, 'docs/tiers.md'), 'utf8').includes('superseded'));
  },
  'contributor-target-lists'() {
    const doc = fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8');
    for (const name of ['render/targets.json', 'bin/agent-personalizer.js', 'bin/global.cjs', 'render/render.cjs', 'bin/learn.cjs', 'AI_LABEL', 'SOURCE']) {
      assert(doc.includes('`' + name + '`'), `AI target guidance names ${name}.`);
    }
  },
  'global-symlink-guidance'() {
    const doc = fs.readFileSync(path.join(root, 'docs/install.md'), 'utf8');
    assert(doc.includes('symlinked `HOME`') && doc.includes('symlinked `~/.claude/CLAUDE.md`'));
    assert(doc.includes('dotfile manager') && doc.includes('Use a project install with `--dir` instead.'));
  },
  'version-and-changelog'() {
    assert.equal(require('../package.json').version, '0.8.5');
    assert.equal(onboarding.VERSION, '0.8.5');
    assert(fs.readFileSync(path.join(root, 'hooks/README.md'), 'utf8').includes('/v0.8.5/docs/tiers.md'));
    const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert(log.includes('## [0.8.5] - 2026-10-29'));
    assert(log.includes('/compare/v0.8.4...v0.8.5'));
    assert.match(log, /\[Unreleased\]: .*\/compare\/v0\.8\.5\.\.\.HEAD/);
    assert(!log.split('## [Unreleased]')[0].includes('`AUDIT_BRIEF.md`'));
  }
};
async function main() {
  let failed = 0;
  for (const [name, test] of Object.entries(cases)) {
    if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
    const dir = path.join(temp, name);
    fs.mkdirSync(dir);
    try { await test(dir); console.log(`PASS audit 0.8.5 ${name}`); }
    catch (error) { failed++; console.error(`FAIL audit 0.8.5 ${name}: ${error.message}`); }
  }
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
