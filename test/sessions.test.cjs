'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSessions } = require('../bin/sessions.cjs');

const fixtureDir = path.join(__dirname, 'fixtures', 'sessions');
const homes = [];
function home() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'personalizer-sessions-'));
  homes.push(folder);
  return folder;
}
function write(folder, relative, body, mtime = '2026-10-01T12:00:00.000Z') {
  const file = path.join(folder, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}
function fixture(folder, relative, name, mtime) {
  return write(folder, relative, fs.readFileSync(path.join(fixtureDir, name)), mtime);
}
function user(text, extra = {}) {
  return JSON.stringify({ type: 'user', sessionId: text, entrypoint: 'cli', message: { content: text }, ...extra }) + '\n';
}
function claudeProject(project) { return project.replace(/[:\\/]/g, '-'); }
function codexRecords(cwd, text) {
  return JSON.stringify({ type: 'session_meta', payload: { id: path.basename(cwd), source: 'cli', cwd } }) + '\n' +
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }) + '\n';
}
function geminiRecords(text) {
  return JSON.stringify({ sessionId: text, projectHash: 'fixture', kind: 'main' }) + '\n' +
    JSON.stringify({ $set: { messages: [{ id: text, type: 'user', content: [{ text }] }] } }) + '\n';
}

async function main() {
  const first = home();
  fixture(first, '.claude/projects/invented-project/human.jsonl', 'claude.jsonl');
  fixture(first, '.claude/projects/invented-project/automation.jsonl', 'claude-sdk.jsonl');
  write(first, '.claude/projects/invented-project/human/subagents/child.jsonl', user('NESTED_EXCLUDED'));
  fixture(first, '.codex/sessions/2026/10/01/rollout-human.jsonl', 'codex.jsonl');
  fixture(first, '.codex/sessions/2026/10/01/rollout-exec.jsonl', 'codex-exec.jsonl');
  fixture(first, '.codex/sessions/2026/10/01/rollout-subagent.jsonl', 'codex-subagent.jsonl');
  fixture(first, '.codex/memories/design.md', 'codex-memory.md');
  fixture(first, '.gemini/tmp/invented-project/chats/session-human.jsonl', 'gemini.jsonl');
  fixture(first, '.gemini/tmp/invented-project/logs.json', 'logs.json');
  const originalRead = fs.readFileSync;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let result;
  try {
    fs.readFileSync = () => { throw new Error('Session readers must stream.'); };
    console.log = console.warn = console.error = () => { throw new Error('Session readers return data without printing.'); };
    result = await readSessions({ home: first, sources: ['claude-code', 'codex', 'gemini-cli'], privateTerms: ['PRIVATE_PERSON_FIXTURE'], allProjects: true });
  } finally {
    fs.readFileSync = originalRead;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.equal(result.sessions.length, 4, 'Three current sessions and one older Gemini log session.');
  const messages = result.sessions.flatMap(session => session.messages);
  const text = messages.join('\n');
  assert(!text.includes('EXCLUDED'), 'Only typed text survives all format fixtures.');
  assert(!text.toLowerCase().includes('private_person_fixture'), 'Case-insensitive private matches are dropped.');
  assert(text.includes('<!-- reply --> That is still too long.'), 'Typed reply comment is kept.');
  assert(text.includes('Use plain words. Keep the example.'), 'Embedded context is cut while typed text survives.');
  assert(text.includes('<!-- reply --> Use a table for this comparison.'), 'Codex reply comment is kept.');
  assert.equal(messages.filter(message => message === 'Ask before changing the scope.').length, 1, 'Gemini final state and logs duplicate only once.');
  assert.equal(result.memories.length, 1);
  assert(result.memories[0].text.includes('The user asked for a table'));
  assert.equal(result.skipped.automation_session, 3);
  assert.equal(result.skipped.private_match, 2);
  assert.equal(result.skipped.malformed_line, 1);
  assert.equal(result.skipped.duplicate_message, 1);
  assert.equal(result.filesRead.length, 8);
  assert.equal(result.filesChecked, 8);
  assert(result.filesRead.every(file => file.startsWith(first + path.sep)));
  console.log('ok: sessions typed formats, final Gemini state, private list, automation, memories and silent streaming');

  const bounded = home();
  const oversized = 'x'.repeat(8 * 1024 * 1024 + 1) + '\n' + user('After the oversized line.');
  write(bounded, '.claude/projects/bounded/large-line.jsonl', oversized);
  write(bounded, '.claude/projects/bounded/long-message.jsonl', user('z'.repeat(2001)));
  write(bounded, '.claude/projects/bounded/unknown.jsonl', JSON.stringify({ new_format: true }) + '\n');
  const boundedResult = await readSessions({ home: bounded, sources: ['claude-code'], allProjects: true });
  assert.deepEqual(boundedResult.sessions.flatMap(session => session.messages), ['After the oversized line.']);
  assert.equal(boundedResult.skipped.oversize_line, 1);
  assert.equal(boundedResult.skipped.long_message, 1);
  assert.equal(boundedResult.skipped.unknown_format, 1);
  console.log('ok: sessions oversized lines and likely pastes are skipped, unknown formats are counted');

  const capped = home();
  const cappedFile = write(capped, '.codex/sessions/rollout-capped.jsonl', JSON.stringify({ type: 'session_meta', payload: { id: 'capped', source: 'cli' } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Before the file cap.' }] } }) + '\n');
  fs.truncateSync(cappedFile, 65 * 1024 * 1024);
  const descriptor = fs.openSync(cappedFile, 'r+');
  const outside = Buffer.from('\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AFTER_CAP_EXCLUDED' }] } }) + '\n');
  fs.writeSync(descriptor, outside, 0, outside.length, 64 * 1024 * 1024 + 1);
  fs.closeSync(descriptor);
  const cappedResult = await readSessions({ home: capped, sources: ['codex'], allProjects: true });
  assert.deepEqual(cappedResult.sessions[0].messages, ['Before the file cap.']);
  assert.equal(cappedResult.skipped.file_limit, 1);
  assert.equal(cappedResult.skipped.oversize_line, 1);
  console.log('ok: sessions stop at the 64 MB file cap');

  const links = home();
  const outsideHome = home();
  const outsideFile = write(outsideHome, 'outside.jsonl', user('SYMLINK_EXCLUDED'));
  const insideFile = write(links, '.claude/projects/actual/human.jsonl', user('The real file stays readable.'));
  fs.symlinkSync(outsideFile, path.join(path.dirname(insideFile), 'linked.jsonl'));
  fs.symlinkSync(path.dirname(outsideFile), path.join(links, '.claude/projects/linked-project'));
  fs.mkdirSync(path.join(links, '.codex'), { recursive: true });
  fs.symlinkSync(outsideHome, path.join(links, '.codex/sessions'));
  fs.mkdirSync(path.join(links, '.gemini/tmp/linked-project'), { recursive: true });
  fs.symlinkSync(outsideHome, path.join(links, '.gemini/tmp/linked-project/chats'));
  fs.symlinkSync(outsideFile, path.join(links, '.gemini/tmp/linked-project/logs.json'));
  const linkedResult = await readSessions({ home: links, sources: ['claude-code', 'codex', 'gemini-cli'], allProjects: true });
  assert.deepEqual(linkedResult.sessions.flatMap(session => session.messages), ['The real file stays readable.']);
  assert.equal(linkedResult.skipped.symlink, 5);
  assert.deepEqual(linkedResult.filesRead, [insideFile]);
  fs.symlinkSync(links, path.join(outsideHome, 'linked-home'));
  const linkedHome = await readSessions({ home: path.join(outsideHome, 'linked-home'), sources: ['claude-code'], allProjects: true });
  assert.equal(linkedHome.filesRead.length, 0);
  assert.equal(linkedHome.skipped.symlink, 1);
  console.log('ok: sessions refuse file, source-directory, project-directory and HOME symlinks');

  const recent = home();
  for (let index = 0; index < 24; index += 1) {
    const when = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString();
    write(recent, `.claude/projects/recent/session-${index}.jsonl`, user(`Recent typed message ${index}.`), when);
  }
  write(recent, '.claude/projects/recent/sdk.jsonl', user('SDK_EXCLUDED', { entrypoint: 'sdk-cli' }), '2026-10-02T00:00:00.000Z');
  write(recent, '.claude/projects/recent/empty.jsonl', user('META_EXCLUDED', { isMeta: true }), '2026-10-03T00:00:00.000Z');
  const recentResult = await readSessions({ home: recent, sources: ['claude-code'], allProjects: true });
  assert.equal(recentResult.sessions.length, 20);
  assert.equal(recentResult.filesRead.length, 26, 'All candidate sessions are read before selecting by message recency.');
  assert.equal(recentResult.sessions[0].messages[0], 'Recent typed message 23.');
  assert.equal(recentResult.sessions[19].messages[0], 'Recent typed message 4.');
  const fewer = await readSessions({ home: recent, sources: ['claude-code'], limit: 2, allProjects: true });
  assert.deepEqual(fewer.sessions.map(session => session.messages[0]), ['Recent typed message 23.', 'Recent typed message 22.']);
  const ceiling = await readSessions({ home: recent, sources: ['claude-code'], limit: 25, allProjects: true });
  assert.equal(ceiling.sessions.length, 20);
  const noCodex = await readSessions({ home: first, sources: ['claude-code'], allProjects: true });
  assert.equal(noCodex.memories.length, 0);
  assert(noCodex.filesRead.every(file => file.includes('.claude')));
  fixture(recent, '.codex/sessions/rollout-newest.jsonl', 'codex.jsonl', '2026-10-04T00:00:00.000Z');
  const across = await readSessions({ home: recent, sources: ['claude-code', 'codex'], limit: 2, allProjects: true });
  assert.deepEqual(across.sessions.map(session => session.source), ['codex', 'claude-code'], 'Recent selection is across chosen sources.');
  assert.equal(across.sessions[1].messages[0], 'Recent typed message 23.');
  console.log('ok: sessions use newest yielding sessions across sources, the 20 ceiling and smaller limits');

  const privateHome = home();
  write(privateHome, '.claude/projects/private/message.jsonl', JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'PRIVATE_PERSON_FIXTURE is here.' }, { type: 'text', text: 'SIBLING_EXCLUDED' }] } }) + '\n' + user('Unrelated text still survives.'));
  write(privateHome, '.codex/memories/private.md', 'private_person_fixture is mentioned here.');
  const privateResult = await readSessions({ home: privateHome, sources: ['claude-code', 'codex'], privateTerms: ['PRIVATE_PERSON_FIXTURE'], allProjects: true });
  assert.deepEqual(privateResult.sessions[0].messages, ['Unrelated text still survives.']);
  assert.equal(privateResult.memories.length, 0);
  assert.equal(privateResult.skipped.private_match, 2);
  const open = fs.promises.open;
  try {
    fs.promises.open = async () => { throw Object.assign(new Error('Synthetic unreadable file'), { code: 'EACCES' }); };
    const unreadable = await readSessions({ home: privateHome, sources: ['claude-code'], allProjects: true });
    assert.equal(unreadable.sessions.length, 0);
    assert.equal(unreadable.skipped.unreadable, 1);
  } finally { fs.promises.open = open; }
  console.log('ok: sessions drop private messages whole and unreadable files without crashing');

  // Audit 0.8.0 F1 and F2: a private term split across content items, or typed in another
  // Unicode form (macOS often produces decomposed accents), still drops the whole message.
  const splitHome = home();
  write(splitHome, '.claude/projects/split/message.jsonl', JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'tell PRIVATE_SPL' }, { type: 'text', text: 'IT_TERM about it' }] } }) + '\n' + user('meet cafe\u0301 owner tomorrow') + user('Kept after the private checks.'));
  const splitResult = await readSessions({ home: splitHome, sources: ['claude-code'], privateTerms: ['PRIVATE_SPLIT_TERM', 'caf\u00e9 owner'], allProjects: true });
  assert.deepEqual(splitResult.sessions[0].messages, ['Kept after the private checks.']);
  assert.equal(splitResult.skipped.private_match, 2);
  // Audit 0.8.0 F3: a Codex user message whose content is a plain string is typed text.
  const stringHome = home();
  write(stringHome, '.codex/sessions/2026/10/01/rollout-string.jsonl', JSON.stringify({ type: 'session_meta', payload: { id: 'string', source: 'cli' } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'CODEX_STRING_KEPT shorter please' } }) + '\n');
  const stringResult = await readSessions({ home: stringHome, sources: ['codex'], allProjects: true });
  assert.deepEqual(stringResult.sessions.flatMap(session => session.messages), ['CODEX_STRING_KEPT shorter please']);
  console.log('ok: sessions catch split and decomposed private terms and keep Codex string content');

  const scopeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'personalizer-project-scope-'));
  homes.push(scopeBase);
  const projectDir = path.join(scopeBase, 'a-b');
  const nestedDir = path.join(projectDir, 'nested');
  const collidingDir = path.join(scopeBase, 'a', 'b');
  const otherDir = path.join(scopeBase, 'other');
  const scopedHome = path.join(scopeBase, 'home');
  for (const dir of [nestedDir, collidingDir, otherDir, scopedHome]) fs.mkdirSync(dir, { recursive: true });
  const claudeRoot = path.join(scopedHome, '.claude', 'projects', claudeProject(projectDir));
  write(scopedHome, path.join('.claude', 'projects', claudeProject(projectDir), 'target.jsonl'), JSON.stringify({ type: 'user', cwd: projectDir, message: { content: 'CLAUDE_TARGET_KEPT' } }) + '\n');
  write(scopedHome, path.join('.claude', 'projects', claudeProject(projectDir), 'nested.jsonl'), JSON.stringify({ type: 'user', cwd: nestedDir, message: { content: 'CLAUDE_NESTED_KEPT' } }) + '\n');
  write(scopedHome, path.join('.claude', 'projects', claudeProject(projectDir), 'inherited-cwd.jsonl'), JSON.stringify({ type: 'assistant', cwd: projectDir }) + '\n' + JSON.stringify({ type: 'user', message: { content: 'CLAUDE_SESSION_CWD_KEPT' } }) + '\n');
  write(scopedHome, path.join('.claude', 'projects', claudeProject(projectDir), 'collision.jsonl'), JSON.stringify({ type: 'user', cwd: collidingDir, message: { content: 'CLAUDE_COLLISION_EXCLUDED' } }) + '\n');
  write(scopedHome, path.join('.claude', 'projects', claudeProject(projectDir), 'unknown.jsonl'), JSON.stringify({ type: 'user', message: { content: 'CLAUDE_UNKNOWN_EXCLUDED' } }) + '\n');
  write(scopedHome, path.join('.claude', 'projects', claudeProject(otherDir), 'other.jsonl'), JSON.stringify({ type: 'user', cwd: otherDir, message: { content: 'CLAUDE_OTHER_EXCLUDED' } }) + '\n');
  write(scopedHome, '.codex/sessions/2026/10/01/rollout-target.jsonl', codexRecords(projectDir, 'CODEX_TARGET_KEPT'));
  write(scopedHome, '.codex/sessions/2026/10/01/rollout-nested.jsonl', codexRecords(nestedDir, 'CODEX_NESTED_KEPT'));
  write(scopedHome, '.codex/sessions/2026/10/01/rollout-collision.jsonl', codexRecords(collidingDir, 'CODEX_COLLISION_EXCLUDED'));
  write(scopedHome, '.codex/sessions/2026/10/01/rollout-unknown.jsonl', JSON.stringify({ type: 'session_meta', payload: { id: 'unknown', source: 'cli' } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'CODEX_UNKNOWN_EXCLUDED' }] } }) + '\n');
  write(scopedHome, '.gemini/tmp/' + crypto.createHash('sha256').update(projectDir).digest('hex') + '/chats/session-target.jsonl', geminiRecords('GEMINI_TARGET_KEPT'));
  write(scopedHome, '.gemini/tmp/' + crypto.createHash('sha256').update(otherDir).digest('hex') + '/chats/session-other.jsonl', geminiRecords('GEMINI_OTHER_EXCLUDED'));
  for (let index = 0; index < 25; index += 1) {
    const when = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString();
    write(scopedHome, `.codex/memories/memory-${index}.md`, `MEMORY_${index}`, when);
  }
  const scoped = await readSessions({ home: scopedHome, projectDir, sources: ['claude-code', 'codex', 'gemini-cli'] });
  const scopedText = scoped.sessions.flatMap(session => session.messages).join('\n');
  for (const kept of ['CLAUDE_TARGET_KEPT', 'CLAUDE_NESTED_KEPT', 'CLAUDE_SESSION_CWD_KEPT', 'CODEX_TARGET_KEPT', 'CODEX_NESTED_KEPT', 'GEMINI_TARGET_KEPT']) assert(scopedText.includes(kept), `${kept} belongs to --dir`);
  for (const excluded of ['CLAUDE_COLLISION_EXCLUDED', 'CLAUDE_UNKNOWN_EXCLUDED', 'CLAUDE_OTHER_EXCLUDED', 'CODEX_COLLISION_EXCLUDED', 'CODEX_UNKNOWN_EXCLUDED', 'GEMINI_OTHER_EXCLUDED']) assert(!scopedText.includes(excluded), `${excluded} is outside --dir or cannot be verified`);
  assert.equal(scoped.memories.length, 20);
  assert(scoped.memories.some(memory => memory.text === 'MEMORY_24'));
  assert(!scoped.memories.some(memory => memory.text === 'MEMORY_4'));
  assert.equal(scoped.skipped.memory_limit, 5);
  const everyProject = await readSessions({ home: scopedHome, projectDir, sources: ['claude-code', 'codex', 'gemini-cli'], allProjects: true });
  const everyProjectText = everyProject.sessions.flatMap(session => session.messages).join('\n');
  for (const included of ['CLAUDE_COLLISION_EXCLUDED', 'CLAUDE_UNKNOWN_EXCLUDED', 'CLAUDE_OTHER_EXCLUDED', 'CODEX_COLLISION_EXCLUDED', 'CODEX_UNKNOWN_EXCLUDED', 'GEMINI_OTHER_EXCLUDED']) assert(everyProjectText.includes(included), `${included} is available in all-projects mode`);
  assert.equal(everyProject.memories.length, 20, 'all-projects mode keeps the memory file cap');
  assert(fs.existsSync(claudeRoot));
  console.log('ok: sessions default to exact project paths, skip ambiguous/unbound data, cap memories and allow all-projects mode');
}

main().then(() => { for (const folder of homes) fs.rmSync(folder, { recursive: true, force: true }); })
  .catch(error => {
    for (const folder of homes) fs.rmSync(folder, { recursive: true, force: true });
    console.error(error);
    process.exitCode = 1;
  });
