'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSessions } = require('../bin/sessions.cjs');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'personalizer-session-recency-'));
function write(relative, records, mtime) {
  const file = path.join(home, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records);
  fs.utimesSync(file, new Date(mtime), new Date(mtime));
}
function lines(records) { return records.map(record => JSON.stringify(record)).join('\n') + '\n'; }
function claude(id, timestamp) {
  return { type: 'user', sessionId: id, timestamp, message: { content: id } };
}
function codex(id, timestamp) {
  return [{ type: 'session_meta', payload: { id, source: 'cli' } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: id } }];
}
async function main() {
  const records = [];
  for (let index = 0; index < 24; index += 1) {
    records.push({ sessionId: `legacy-${index}`, type: 'user', message: `Legacy message ${index}.`, timestamp: new Date(Date.UTC(2026, 9, 24, 0, index)).toISOString() });
  }
  write('.gemini/tmp/recent/logs.json', JSON.stringify(records), '2026-10-01T00:00:00.000Z');
  write('.claude/projects/older/old.jsonl', lines([claude('older-claude', '2026-09-01T00:00:00.000Z')]), '2026-10-28T00:00:00.000Z');
  write('.codex/sessions/rollout-old.jsonl', lines(codex('older-codex', '2026-09-02T00:00:00.000Z')), '2026-10-27T00:00:00.000Z');
  const options = { home, sources: ['claude-code', 'codex', 'gemini-cli'], allProjects: true };
  const recent = await readSessions(options);
  assert.deepEqual(recent.sessions.map(session => session.sessionId), Array.from({ length: 20 }, (_, index) => `legacy-${23 - index}`), 'Newest 20 message timestamps win over legacy insertion order and newer file mtimes.');
  console.log('ok: session recency selects newest 20 legacy sessions across newer-mtime older sources');

  write('.claude/projects/new/late.jsonl', lines([claude('latest-claude', '2026-10-25T00:00:00.000Z')]), '2026-09-01T00:00:00.000Z');
  write('.codex/sessions/rollout-late.jsonl', lines([...codex('latest-codex', '2026-10-01T00:00:00.000Z'),
    { type: 'response_item', timestamp: '2026-10-26T00:00:00.000Z', payload: { type: 'message', role: 'assistant', content: 'Reply.' } }]), '2026-09-01T00:00:00.000Z');
  write('.gemini/tmp/recent/chats/session-late.jsonl', lines([{ sessionId: 'latest-gemini' },
    { $set: { messages: [{ type: 'user', timestamp: '2026-10-01T00:00:00.000Z', content: [{ text: 'A recent session.' }] },
      { type: 'gemini', timestamp: '2026-10-27T00:00:00.000Z', content: [{ text: 'Reply.' }] }] } }]), '2026-09-01T00:00:00.000Z');
  const mixed = await readSessions({ ...options, limit: 3 });
  assert.deepEqual(mixed.sessions.map(session => session.sessionId), ['latest-gemini', 'latest-codex', 'latest-claude'], 'Latest message timestamps order current Gemini, Codex and Claude sessions.');
  console.log('ok: session recency uses the latest message across current formats');

  write('.claude/projects/new/fallback.jsonl', lines([claude('fallback-claude')]), '2026-10-28T00:00:00.000Z');
  write('.codex/sessions/rollout-invalid.jsonl', lines(codex('fallback-invalid', 'not-a-date')), '2026-10-29T00:00:00.000Z');
  const fallback = await readSessions({ ...options, limit: 3 });
  assert.deepEqual(fallback.sessions.map(session => session.sessionId), ['fallback-invalid', 'fallback-claude', 'latest-gemini'], 'Missing or invalid timestamps fall back to that session file mtime.');
  console.log('ok: session recency falls back to file mtime only without a usable timestamp');
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(home, { recursive: true, force: true }));
