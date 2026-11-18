'use strict';

// 0.10.0 regressions (#46-#50): Gemini CLI v0.42+/v0.68+ session discovery and accumulator,
// Codex memories_v2, gate NFC normalization, global qualify scoping, GEMINI.md pointers/command/hook,
// release-fallback version parity, package inventory, dead interview removal and self-seeding rollback.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSessions } = require('../bin/sessions.cjs');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/agent-personalizer.js');
const renderer = path.join(root, 'render/render.cjs');
const gate = path.join(root, 'check/gate.cjs');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'ap0100-')));

function write(dir, rel, text, mtime) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (mtime) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}

function run(script, args, homeDir, expected = 0, extra = {}) {
  const out = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, HERMES_HOME: '', ...extra }
  });
  assert.ifError(out.error);
  assert.equal(out.status, expected, `${path.basename(script)} ${args.join(' ')}\n${out.stdout}${out.stderr}`);
  return out.stdout + out.stderr;
}

const cases = {
  async 'gemini-slug-and-modern-jsonl'(dir) {
    const home = path.join(dir, 'home');
    const project = path.join(dir, 'my-project');
    const nested = path.join(project, 'packages', 'web');
    const other = path.join(dir, 'other-project');
    for (const d of [home, nested, other]) fs.mkdirSync(d, { recursive: true });

    const norm = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    write(home, '.gemini/projects.json', JSON.stringify({
      projects: {
        [norm(project)]: 'my-project',
        [norm(nested)]: 'my-project-web',
        [norm(other)]: 'other-project'
      }
    }, null, 2));

    // Append-only v0.68.0 JSONL with string content, Part[], $set metadata-only, $patch, and $rewindTo
    const modernLines = [
      { sessionId: 'gem-modern-1', projectHash: 'my-project', startTime: '2026-11-10T10:00:00Z', lastUpdated: '2026-11-10T10:00:00Z' },
      { id: 'u1', timestamp: '2026-11-10T10:01:00Z', type: 'user', content: 'DRAFT_MESSAGE_ONE' },
      { $patch: { id: 'u1', content: 'GEMINI_PATCHED_STRING_KEPT' } },
      { id: 'g1', timestamp: '2026-11-10T10:01:05Z', type: 'gemini', content: 'ASSISTANT_EXCLUDED' },
      { id: 'u2', timestamp: '2026-11-10T10:02:00Z', type: 'user', content: [{ text: 'GEMINI_PART_ARRAY_KEPT' }] },
      { id: 'u3', timestamp: '2026-11-10T10:03:00Z', type: 'user', content: 'GEMINI_REMOVED_EXCLUDED' },
      { $patch: { removeIds: ['u3'] } },
      { id: 'u4', timestamp: '2026-11-10T10:04:00Z', type: 'user', content: 'GEMINI_REWOUND_EXCLUDED' },
      { id: 'u5', timestamp: '2026-11-10T10:05:00Z', type: 'user', content: 'GEMINI_AFTER_REWIND_EXCLUDED' },
      { $rewindTo: 'u4' },
      { id: 'u6', timestamp: '2026-11-10T10:06:00Z', type: 'user', content: 'GEMINI_POST_REWIND_KEPT' },
      { $set: { lastUpdated: '2026-11-10T10:06:30Z' } }
    ];
    write(home, '.gemini/tmp/my-project/chats/session-2026-11-10-modern.jsonl', modernLines.map(JSON.stringify).join('\n') + '\n');

    // Subfolder slug session + subagent session (excluded) + legacy .json session + .project_root marker + sandboxed .cache/.gemini
    write(home, '.gemini/tmp/my-project-web/chats/session-2026-11-11-nested.jsonl', [
      { sessionId: 'gem-nested', projectHash: 'my-project-web', startTime: '2026-11-11T10:00:00Z' },
      { id: 'n1', timestamp: '2026-11-11T10:01:00Z', type: 'user', content: 'GEMINI_NESTED_SLUG_KEPT' }
    ].map(JSON.stringify).join('\n') + '\n');
    write(home, '.gemini/tmp/my-project/chats/session-2026-11-11-subagent.jsonl', [
      { sessionId: 'gem-sub', projectHash: 'my-project', kind: 'subagent' },
      { id: 's1', timestamp: '2026-11-11T10:02:00Z', type: 'user', content: 'GEMINI_SUBAGENT_EXCLUDED' }
    ].map(JSON.stringify).join('\n') + '\n');
    write(home, '.gemini/tmp/root-marker-slug/.project_root', project + '\n');
    write(home, '.gemini/tmp/root-marker-slug/chats/session-2026-11-09.json', JSON.stringify({
      sessionId: 'gem-legacy-json',
      projectHash: 'root-marker-slug',
      messages: [
        { id: 'j1', timestamp: '2026-11-09T09:00:00Z', type: 'user', content: 'GEMINI_JSON_SESSION_KEPT' },
        { id: 'j2', timestamp: '2026-11-09T09:01:00Z', type: 'gemini', content: 'GEMINI_JSON_ASSISTANT_EXCLUDED' }
      ]
    }));
    write(home, '.cache/.gemini/tmp/my-project/chats/session-2026-11-12-sandbox.jsonl', [
      { sessionId: 'gem-sandbox', projectHash: 'my-project' },
      { id: 'c1', timestamp: '2026-11-12T08:00:00Z', type: 'user', content: 'GEMINI_CACHE_SANDBOX_KEPT' }
    ].map(JSON.stringify).join('\n') + '\n');
    const legacyHash = crypto.createHash('sha256').update(project).digest('hex');
    write(home, `.gemini/tmp/${legacyHash}/chats/session-legacy-hash.jsonl`, [
      { sessionId: 'gem-hash', projectHash: legacyHash },
      { $set: { messages: [{ id: 'h1', type: 'user', content: [{ text: 'GEMINI_SHA256_FALLBACK_KEPT' }] }] } }
    ].map(JSON.stringify).join('\n') + '\n');
    write(home, '.gemini/tmp/other-project/chats/session-other.jsonl', [
      { sessionId: 'gem-other', projectHash: 'other-project' },
      { id: 'o1', timestamp: '2026-11-12T09:00:00Z', type: 'user', content: 'GEMINI_OTHER_SLUG_EXCLUDED' }
    ].map(JSON.stringify).join('\n') + '\n');

    const scoped = await readSessions({ home, projectDir: project, sources: ['gemini-cli'], allProjects: false });
    const text = scoped.sessions.flatMap(s => s.messages).join('\n');
    for (const kept of [
      'GEMINI_PATCHED_STRING_KEPT',
      'GEMINI_PART_ARRAY_KEPT',
      'GEMINI_POST_REWIND_KEPT',
      'GEMINI_NESTED_SLUG_KEPT',
      'GEMINI_JSON_SESSION_KEPT',
      'GEMINI_CACHE_SANDBOX_KEPT',
      'GEMINI_SHA256_FALLBACK_KEPT'
    ]) assert(text.includes(kept), `missing ${kept}`);
    for (const excluded of [
      'DRAFT_MESSAGE_ONE',
      'ASSISTANT_EXCLUDED',
      'GEMINI_REMOVED_EXCLUDED',
      'GEMINI_REWOUND_EXCLUDED',
      'GEMINI_AFTER_REWIND_EXCLUDED',
      'GEMINI_SUBAGENT_EXCLUDED',
      'GEMINI_JSON_ASSISTANT_EXCLUDED',
      'GEMINI_OTHER_SLUG_EXCLUDED'
    ]) assert(!text.includes(excluded), `unexpected ${excluded}`);
    assert.equal(scoped.skipped.automation_session, 1);
  },

  async 'codex-memories-v2'(dir) {
    const home = path.join(dir, 'home');
    write(home, '.codex/memories/legacy.md', 'CODEX_LEGACY_MEMORY_KEPT', '2026-11-01T00:00:00Z');
    write(home, '.codex/memories_v2/MEMORY.md', 'CODEX_V2_MAIN_MEMORY_KEPT', '2026-11-02T00:00:00Z');
    write(home, '.codex/memories_v2/memory_summary.md', 'CODEX_V2_SUMMARY_KEPT', '2026-11-03T00:00:00Z');
    write(home, '.codex/memories_v2/rollout_summaries/2026-11-04.md', 'CODEX_V2_ROLLOUT_SUMMARY_KEPT', '2026-11-04T00:00:00Z');
    write(home, '.codex/memories_v2/rollout_summaries/private.md', 'SecretFixturePerson note', '2026-11-05T00:00:00Z');
    const result = await readSessions({ home, sources: ['codex'], privateTerms: ['secretfixtureperson'], allProjects: true });
    const memText = result.memories.map(m => m.text).join('\n');
    for (const kept of ['CODEX_LEGACY_MEMORY_KEPT', 'CODEX_V2_MAIN_MEMORY_KEPT', 'CODEX_V2_SUMMARY_KEPT', 'CODEX_V2_ROLLOUT_SUMMARY_KEPT']) {
      assert(memText.includes(kept), `missing ${kept}`);
    }
    assert(!memText.includes('SecretFixturePerson'));
    assert.equal(result.skipped.private_match, 1);
  },

  'gate-nfc-and-learn-label'(dir) {
    const scanDir = path.join(dir, 'scan');
    fs.mkdirSync(scanDir, { recursive: true });
    const listFile = write(dir, 'forbidden.txt', 'Ren\u00e9e\nallow:Copyright Ren\u00e9e Studio\n');
    // NFD decomposed accents in filename, body text, and allowed span
    write(scanDir, 'clean-allow.md', 'Copyright Rene\u0301e Studio is permitted.\n');
    const cleanOut = run(gate, ['--dir', scanDir, '--list', listFile, '--all'], dir, 0);
    assert(cleanOut.includes('gate clean: 0 hits'));

    write(scanDir, 'notes-rene\u0301e.md', 'Safe body text.\n');
    write(scanDir, 'body.md', 'Meeting with Rene\u0301e tomorrow.\n');
    const hitOut = run(gate, ['--dir', scanDir, '--list', listFile, '--all'], dir, 1);
    assert(hitOut.includes('GATE FAILED: 2 hit(s)'), hitOut);
    assert(!hitOut.includes('Rene\u0301e') && !hitOut.includes('Ren\u00e9e'), 'NFD hit path must be redacted in gate output');

    // Multi-code-unit lowercase folding (Turkish capital dotted I -> i + combining dot) is also redacted
    const trScan = path.join(dir, 'tr-scan');
    fs.mkdirSync(trScan, { recursive: true });
    const trList = write(dir, 'tr-forbidden.txt', 'i\u0307stanbul\n');
    write(trScan, '\u0130stanbul.md', 'Safe body.\n');
    const trOut = run(gate, ['--dir', trScan, '--list', trList, '--all'], dir, 1);
    assert(!trOut.includes('\u0130stanbul') && trOut.includes('[redacted].md'), trOut);
  },

  'global-qualify-preserves-user-prose'(dir) {
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);
    run(cli, ['--global', '--ai', 'claude,agents,gemini,hermes', '--yes'], home, 0);
    const userRule = 'Keep project USER.md and LEARNED.md short in repositories.';
    const learnedRule = 'Never overwrite a repo USER.md or AGENT_ONBOARDING.md without asking.';
    write(home, '.agent-personalizer/USER.md', `# USER.md\n\n${userRule}\n`);
    write(home, '.agent-personalizer/LEARNED.md', `# LEARNED.md\n\n## Learned\n- [said, confirmed] ${learnedRule}\n\n## Asked\n`);
    run(cli, ['--global'], home, 0);
    const profileRoot = path.join(fs.realpathSync(home), '.agent-personalizer');
    for (const rel of ['.claude/CLAUDE.md', '.codex/AGENTS.md', '.gemini/GEMINI.md', '.hermes/SOUL.md']) {
      const text = fs.readFileSync(path.join(home, rel), 'utf8');
      assert(text.includes(userRule), `${rel}: USER.md prose was mutated by global qualify()`);
      assert(text.includes(learnedRule), `${rel}: LEARNED.md confirmed entry was mutated by global qualify()`);
      assert(text.includes(path.join(profileRoot, 'USER.md')), `${rel}: installer boilerplate still qualifies global USER.md path`);
      assert(!text.includes('sits next to `GEMINI.md`'), `${rel}: GEMINI binding should be qualified for global installs`);
    }
    const learnOut = run(cli, ['learn', '--global', '--yes'], home, 0);
    assert(!learnOut.includes('open your AI in this folder'), 'global learn must not tell the user to open an AI inside ~/.agent-personalizer');
    assert(learnOut.includes('any project'), learnOut);

    // Custom user-authored rules in ~/.agent-personalizer/rules/ also preserve repo USER.md wording
    const customRuleLine = 'In practice: keep each project USER.md concise.';
    write(home, '.agent-personalizer/rules/00-read-the-profile-first.md', `---\nid: 00-read-the-profile-first\ntitle: Custom profile rule\ninject: true\n---\n\n## universal\nRead project context.\n\n${customRuleLine}\n`);
    run(cli, ['--global'], home, 0);
    assert(fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8').includes(customRuleLine), 'user-authored rule in global profile keeps literal USER.md');
  },

  'gemini-template-command-hook'(dir) {
    const project = path.join(dir, 'project');
    const ans = write(dir, 'ans.json', JSON.stringify({ notes_path: 'vault', signature: 'yes' }));
    run(cli, ['--dir', project, '--ai', 'claude,agents,gemini', '--level', '3', '--answers', ans, '--yes'], dir, 0);
    const geminiMd = fs.readFileSync(path.join(project, 'GEMINI.md'), 'utf8');
    assert(geminiMd.startsWith('# GEMINI.md\n'), 'GEMINI.md gets pointer header template');
    assert(geminiMd.includes('`vault/README.md`'), 'GEMINI.md migrates notes_path pointers');
    assert(geminiMd.includes('`USER.md` sits next to `GEMINI.md`.'), 'GEMINI.md renders binding:gemini');

    const tomlPath = path.join(project, '.gemini/commands/personalize.toml');
    assert(fs.existsSync(tomlPath), '.gemini/commands/personalize.toml installed');
    const toml = fs.readFileSync(tomlPath, 'utf8');
    assert(toml.includes('description = ') && toml.includes("prompt = '''"), 'valid TOML command shape');
    assert(!toml.includes('!{') && !toml.includes('@{'), 'no Gemini CLI shell/file injection triggers');

    const hookPath = path.join(project, 'hooks/gemini-cli/session-start.sh');
    assert(fs.existsSync(hookPath), 'hooks/gemini-cli/session-start.sh installed');
    if (process.platform !== 'win32') assert(fs.statSync(hookPath).mode & 0o111, 'Gemini hook is executable');
    const hookOut = spawnSync('sh', [hookPath], { cwd: project, encoding: 'utf8' });
    assert.equal(hookOut.status, 0, hookOut.stderr);
    const parsed = JSON.parse(hookOut.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    assert(parsed.hookSpecificOutput.additionalContext.includes('Session-start contract for gemini'));
    assert(parsed.hookSpecificOutput.additionalContext.includes('`USER.md` sits next to `GEMINI.md`.'));

    // Reserved .gemini notes_path refused
    const badAns = write(dir, 'bad.json', JSON.stringify({ notes_path: '.gemini/notes' }));
    run(cli, ['--dir', path.join(dir, 'bad-proj'), '--ai', 'gemini', '--level', '2', '--answers', badAns, '--yes'], dir, 2);

    // Pre-0.10.0 bare-marker GEMINI.md upgrades cleanly without false edited-pointer warnings
    const legacyProj = path.join(dir, 'legacy-gemini');
    run(cli, ['--dir', legacyProj, '--ai', 'gemini', '--level', '1', '--yes'], dir, 0);
    const bareContent = fs.readFileSync(path.join(legacyProj, 'GEMINI.md'), 'utf8');
    const markerIdx = bareContent.indexOf('<!-- agent-personalizer:begin -->');
    const bareOnly = bareContent.slice(markerIdx);
    fs.writeFileSync(path.join(legacyProj, 'GEMINI.md'), bareOnly);
    const cfgPath = path.join(legacyProj, '.agent-personalizer.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.installed['GEMINI.md'] = crypto.createHash('sha256').update(Buffer.from(bareOnly)).digest('hex');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    const upOut = run(cli, ['--dir', legacyProj, '--yes'], dir, 0);
    assert(!upOut.includes('edited pointer'), upOut);
    assert(fs.readFileSync(path.join(legacyProj, 'GEMINI.md'), 'utf8').startsWith('# GEMINI.md\n'));
    run(renderer, ['--dir', legacyProj, '--check'], dir, 0);
  },

  'release-fallback-and-docs-parity'() {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const fallback = JSON.parse(fs.readFileSync(path.join(root, 'website/release-fallback.json'), 'utf8'));
    assert.equal(fallback.version, pkg.version, 'website/release-fallback.json version must match package.json');
    assert.equal(pkg.engines.node, '>=22', 'engines.node updated to >=22');
    assert(pkg.keywords.includes('hermes-agent'), 'keywords include hermes-agent');
    const installDoc = fs.readFileSync(path.join(root, 'docs/install.md'), 'utf8');
    assert(!installDoc.includes('Select only `claude`, `agents` and `gemini`.'), 'contradictory global target line fixed');
    const pasteDoc = fs.readFileSync(path.join(root, 'docs/paste-guide.md'), 'utf8');
    assert(pasteDoc.includes('Google Antigravity') && pasteDoc.includes('~/.gemini/config/GEMINI.md'), 'Google Antigravity global path documented');
    assert(pasteDoc.includes('5,000') && pasteDoc.includes('1,500'), 'ChatGPT paid and Free character limits documented');
  },

  'package-files-dead-exports-and-rollback'(dir) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert(pkg.files.includes('skills'), 'skills shipped in npm files');
    assert(pkg.files.includes('examples/answers.json') && !pkg.files.includes('examples'), 'only examples/answers.json packed');

    const onboarding = require('../render/onboarding.cjs');
    for (const removed of ['QUICK', 'interviewDefault', 'interviewAnswers', 'parseAnswer', 'asks', 'NOTES_PENDING_MARK']) {
      assert(!(removed in onboarding), `${removed} should be removed from onboarding exports`);
    }
    for (const q of onboarding.QUESTIONS) {
      assert(!('ask' in q) && !('when' in q), `question ${q.id} retains unused interview field`);
    }
    const r = require('../render/render.cjs');
    for (const kept of ['parseFrontmatter', 'parseSections', 'fenceMap']) assert.equal(typeof r[kept], 'function');
    assert('DIE_THROWS' in r);

    // Standalone rollback.test.js with no arguments and with an empty directory
    run(path.join(root, 'test/rollback.test.js'), [], dir, 0);
    const empty = path.join(dir, 'empty-rollback');
    fs.mkdirSync(empty);
    run(path.join(root, 'test/rollback.test.js'), [empty], dir, 0);
  }
};

async function main() {
  let failed = 0;
  for (const [name, test] of Object.entries(cases)) {
    if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
    const dir = path.join(temp, name);
    fs.mkdirSync(dir, { recursive: true });
    try { await test(dir); console.log(`PASS audit 0.10.0 ${name}`); }
    catch (error) { failed++; console.error(`FAIL audit 0.10.0 ${name}: ${error.message}`); }
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
