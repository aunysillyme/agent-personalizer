'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const version = require('../render/onboarding.cjs').VERSION;
const onboarding = require('../render/onboarding.cjs');
const renderer = require('../render/render.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-compact-'));
const read = p => fs.readFileSync(p, 'utf8');
function run(script, args, expected = 0) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], { encoding: 'utf8' });
  assert.strictEqual(result.status, expected, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}
try {
  for (const level of [1, 3]) {
    const dir = path.join(temp, String(level));
    run('bin/agent-personalizer.js', ['--dir', dir, '--ai', 'claude,agents,gemini,chatgpt,prompt', '--level', String(level), '--yes', '--compact']);
    assert.strictEqual(JSON.parse(read(path.join(dir, '.agent-personalizer.json'))).compact, true);
    run('render/render.cjs', ['--dir', dir, '--check']);
    run('bin/agent-personalizer.js', ['--dir', dir, '--yes']);
    run('render/render.cjs', ['--dir', dir, '--check']);
    run('render/render.cjs', ['--dir', dir, '--targets', 'hermes']);
    const rulesDir = level === 3 ? path.join(dir, 'rules') : path.join(root, 'rules');
    for (const file of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'SOUL.md']) {
      const text = read(path.join(dir, file));
      const surface = { 'CLAUDE.md': 'claude', 'AGENTS.md': 'agents', 'GEMINI.md': 'gemini', 'SOUL.md': 'agents' }[file];
      for (const name of fs.readdirSync(rulesDir).filter(name => /^\d\d-.*\.md$/.test(name))) {
        if (level === 1 && !renderer.CORE_RULE_FILES.has(name)) continue;
        const parsed = renderer.parseFrontmatter(read(path.join(rulesDir, name)), name);
        if (parsed.meta.inject || (parsed.meta.surfaces && !parsed.meta.surfaces.includes(surface))) continue;
        if (parsed.meta.requires && onboarding.defaults()[parsed.meta.requires.answer] !== parsed.meta.requires.value) continue;
        const practice = renderer.parseSections(parsed.body, name).universal.split('\n').find(line => line.startsWith('In practice:'));
        const link = level === 1 ? `https://github.com/aunysillyme/agent-personalizer/blob/v${version}/rules/${name}` : `rules/${name}`;
        const matches = text.split('\n').filter(line => line.includes(`[Full rule](${link})`));
        assert.strictEqual(matches.length, 1, `${file}: ${name}`);
        assert(matches[0].includes(practice) && matches[0].includes(parsed.meta.title), `${file}: ${name}`);
      }
      const rule = '10-evidence-before-assertion.md';
      const source = read(path.join(rulesDir, rule));
      const practice = source.split('\n').find(line => line.startsWith('In practice:'));
      const link = level === 1 ? `https://github.com/aunysillyme/agent-personalizer/blob/v${version}/rules/${rule}` : `rules/${rule}`;
      const lines = text.split('\n').filter(line => line.includes(`[Full rule](${link})`));
      assert.strictEqual(lines.length, 1, file);
      assert(lines[0].includes(practice), file);
      assert(text.includes('### Read the profile first'), file);
      assert(text.includes(read(path.join(rulesDir, '00-read-the-profile-first.md')).split('## universal\n')[1].split('\n\n## ')[0]), file);
    }
    const before = read(path.join(dir, 'chatgpt-custom-instructions.md'));
    const prompt = read(path.join(dir, 'system-prompt.md'));
    const config = JSON.parse(read(path.join(dir, '.agent-personalizer.json')));
    config.compact = false;
    fs.writeFileSync(path.join(dir, '.agent-personalizer.json'), JSON.stringify(config));
    run('render/render.cjs', ['--dir', dir, '--targets', 'chatgpt,prompt']);
    assert.strictEqual(read(path.join(dir, 'chatgpt-custom-instructions.md')), before);
    assert.strictEqual(read(path.join(dir, 'system-prompt.md')), prompt);
    run('render/render.cjs', ['--dir', dir, '--targets', 'claude', '--compact']);
    assert.strictEqual(JSON.parse(read(path.join(dir, '.agent-personalizer.json'))).compact, true);
    run('render/render.cjs', ['--dir', dir, '--targets', 'claude', '--check']);
  }
  const dir = path.join(temp, 'large');
  run('bin/agent-personalizer.js', ['--dir', dir, '--ai', 'claude', '--level', '3', '--yes']);
  fs.writeFileSync(path.join(dir, 'USER.md'), '# USER.md\n\n' + 'x'.repeat(21000) + '\n');
  const output = run('render/render.cjs', ['--dir', dir, '--targets', 'claude']);
  const text = read(path.join(dir, 'CLAUDE.md'));
  assert(output.includes(`OVER BUDGET  CLAUDE.md (${text.length} characters, budget 20000; --compact shortens rules)`));
  assert(text.includes('x'.repeat(21000)));
  run('render/render.cjs', ['--dir', dir, '--targets', 'claude', '--check']);
  const prior = read(path.join(dir, 'CLAUDE.md'));
  run('render/render.cjs', ['--dir', dir, '--targets', 'claude', '--strict'], 1);
  assert.strictEqual(read(path.join(dir, 'CLAUDE.md')), prior);
  run('render/render.cjs', ['--dir', path.join(root, 'examples/freelance-illustrator'), '--check']);
  const home = path.join(temp, 'home');
  fs.mkdirSync(home);
  const global = spawnSync(process.execPath, [path.join(root, 'bin/agent-personalizer.js'), '--global', '--ai', 'hermes', '--yes', '--compact'], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, HERMES_HOME: '' } });
  assert.strictEqual(global.status, 0, global.stdout + global.stderr);
  assert.strictEqual(JSON.parse(read(path.join(home, '.agent-personalizer/.agent-personalizer.json'))).compact, true);
  assert(read(path.join(home, '.hermes/SOUL.md')).includes(`blob/v${version}/rules/10-evidence-before-assertion.md`));
  console.log('compact rendering and file budget passed');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
