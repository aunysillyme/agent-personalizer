'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_LINE = 8 * 1024 * 1024;
const MAX_FILE = 64 * 1024 * 1024;
const SOURCES = new Set(['claude-code', 'codex', 'gemini-cli']);
const CONTEXT_HEADERS = ['# AGENTS.md instructions', '# Files mentioned by the user', '# Response annotations', '# Browser comments'];

function bump(state, reason) {
  state.skipped[reason] = (state.skipped[reason] || 0) + 1;
}

function privateMatch(text, terms) {
  const lower = text.toLowerCase();
  return terms.some(term => lower.includes(term));
}

function cutContextBlocks(text) {
  const tags = /<(\/?)(system-reminder|pasted_content)\b[^>]*>/gi;
  const stack = [];
  let output = '', position = 0, match;
  while ((match = tags.exec(text))) {
    if (!stack.length) output += text.slice(position, match.index);
    const name = match[2].toLowerCase();
    if (match[1]) {
      if (stack[stack.length - 1] === name) stack.pop();
    } else if (!/\/\s*>$/.test(match[0])) stack.push(name);
    position = tags.lastIndex;
  }
  // An unfinished block stays excluded rather than exposing a partial paste.
  if (!stack.length) output += text.slice(position);
  return output;
}

function typedText(items, state) {
  if (!items.length) { bump(state, 'non_typed'); return null; }
  // A private match drops the whole message, including its other text items.
  if (privateMatch(items.join('\n'), state.privateTerms)) { bump(state, 'private_match'); return null; }
  const kept = [];
  for (const item of items) {
    let text = item.trim();
    if (/^<[A-Za-z][A-Za-z0-9_:-]*/.test(text) || CONTEXT_HEADERS.some(prefix => text.startsWith(prefix))) {
      bump(state, 'automation_text');
      continue;
    }
    text = cutContextBlocks(text).trim();
    if (text) kept.push(text);
  }
  const text = kept.join('\n');
  if (!text) { bump(state, 'empty_message'); return null; }
  if (text.length > 2000) { bump(state, 'long_message'); return null; }
  return text;
}

function textItems(content, type) {
  if (typeof content === 'string') return type === 'text' ? [content] : [];
  if (!Array.isArray(content)) return [];
  return content.filter(item => item && typeof item === 'object' && item.type === type && typeof item.text === 'string').map(item => item.text);
}

async function statPath(file, kind, state, count = false) {
  if (count) state.filesChecked += 1;
  try {
    const stat = await fs.promises.lstat(file);
    if (stat.isSymbolicLink()) { bump(state, 'symlink'); return null; }
    if ((kind === 'directory' && !stat.isDirectory()) || (kind === 'file' && !stat.isFile())) {
      bump(state, 'non_regular');
      return null;
    }
    return stat;
  } catch (error) {
    if (error.code !== 'ENOENT') bump(state, 'unreadable');
    return null;
  }
}

async function children(dir, state) {
  if (!await statPath(dir, 'directory', state)) return [];
  try { return (await fs.promises.readdir(dir)).sort(); }
  catch { bump(state, 'unreadable'); return []; }
}

async function candidate(file, source, project, format, state) {
  const stat = await statPath(file, 'file', state, true);
  if (stat) state.candidates.push({ file, source, project, format, mtimeMs: stat.mtimeMs });
}

async function discover(home, sources, state) {
  if (!await statPath(home, 'directory', state)) return;
  if (sources.has('claude-code')) {
    const app = path.join(home, '.claude');
    if (await statPath(app, 'directory', state)) {
      const projects = path.join(app, 'projects');
      for (const project of await children(projects, state)) {
        const dir = path.join(projects, project);
        for (const name of await children(dir, state)) {
          if (name.endsWith('.jsonl')) await candidate(path.join(dir, name), 'claude-code', project, 'claude', state);
        }
      }
    }
  }
  if (sources.has('codex')) {
    const app = path.join(home, '.codex');
    if (await statPath(app, 'directory', state)) {
      async function walk(dir) {
        for (const name of await children(dir, state)) {
          const file = path.join(dir, name);
          const stat = await statPath(file, null, state);
          if (!stat) continue;
          if (stat.isDirectory()) await walk(file);
          else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) await candidate(file, 'codex', path.basename(dir), 'codex', state);
          else if (!stat.isFile()) bump(state, 'non_regular');
        }
      }
      await walk(path.join(app, 'sessions'));
      const memories = path.join(app, 'memories');
      for (const name of await children(memories, state)) {
        if (!name.endsWith('.md')) continue;
        const file = path.join(memories, name);
        const stat = await statPath(file, 'file', state, true);
        if (stat) state.memoryFiles.push({ file, mtimeMs: stat.mtimeMs });
      }
    }
  }
  if (sources.has('gemini-cli')) {
    const app = path.join(home, '.gemini');
    if (await statPath(app, 'directory', state)) {
      const tmp = path.join(app, 'tmp');
      for (const project of await children(tmp, state)) {
        const dir = path.join(tmp, project);
        if (!await statPath(dir, 'directory', state)) continue;
        for (const name of await children(path.join(dir, 'chats'), state)) {
          if (name.startsWith('session-') && name.endsWith('.jsonl')) await candidate(path.join(dir, 'chats', name), 'gemini-cli', project, 'gemini', state);
        }
        const logs = path.join(dir, 'logs.json');
        try {
          await fs.promises.lstat(logs);
          await candidate(logs, 'gemini-cli', project, 'gemini-logs', state);
        } catch (error) { if (error.code !== 'ENOENT') bump(state, 'unreadable'); }
      }
    }
  }
}

async function safeOpen(file, state) {
  // Recheck each path within HOME immediately before opening to catch replaced links.
  const relative = path.relative(state.home, file);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
  let current = state.home;
  if (!await statPath(current, 'directory', state)) return null;
  const parts = relative.split(path.sep);
  for (const name of parts.slice(0, -1)) {
    current = path.join(current, name);
    if (!await statPath(current, 'directory', state)) return null;
  }
  const before = await statPath(file, 'file', state);
  if (!before) return null;
  try {
    const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const after = await handle.stat();
    if (!after.isFile() || before.ino !== after.ino || before.dev !== after.dev) {
      await handle.close();
      bump(state, 'non_regular');
      return null;
    }
    state.filesRead.push(file);
    if (after.size > MAX_FILE) bump(state, 'file_limit');
    return handle;
  } catch { bump(state, 'unreadable'); return null; }
}

async function scanLines(file, state, onLine) {
  const handle = await safeOpen(file, state);
  if (!handle) return false;
  let fragments = [], length = 0, oversize = false;
  function line() {
    if (!oversize && length) onLine(Buffer.concat(fragments, length).toString('utf8'));
    fragments = []; length = 0; oversize = false;
  }
  try {
    const stream = handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024, start: 0, end: MAX_FILE - 1 });
    for await (const chunk of stream) {
      let start = 0;
      for (let end = chunk.indexOf(10); ; end = chunk.indexOf(10, start)) {
        const stop = end === -1 ? chunk.length : end;
        if (!oversize && stop > start) {
          length += stop - start;
          if (length > MAX_LINE) { oversize = true; fragments = []; bump(state, 'oversize_line'); }
          else fragments.push(chunk.subarray(start, stop));
        }
        if (end === -1) break;
        line();
        start = end + 1;
      }
    }
    // A capped file's partial final record is not a complete JSON line.
    const stat = await handle.stat();
    if (stat.size <= MAX_FILE) line();
    return true;
  } catch { bump(state, 'unreadable'); return false; }
  finally { await handle.close(); }
}

function parsedLine(line, state) {
  try {
    const record = JSON.parse(line);
    if (!record || Array.isArray(record) || typeof record !== 'object') { bump(state, 'unknown_format'); return null; }
    return record;
  } catch { bump(state, 'malformed_line'); return null; }
}

function baseSession(file) {
  return { source: file.source, date: new Date(file.mtimeMs).toISOString(), project: file.project, sessionId: path.basename(file.file), file: file.file, mtimeMs: file.mtimeMs, messages: [] };
}

async function readClaude(file, state) {
  const session = baseSession(file);
  let known = false, automation = false;
  const ok = await scanLines(file.file, state, line => {
    const record = parsedLine(line, state);
    if (!record) return;
    if (typeof record.entrypoint === 'string' && record.entrypoint.startsWith('sdk')) automation = true;
    if (record.type !== 'user') return;
    known = true;
    if (record.isMeta || record.isSidechain || record.isCompactSummary || record.isVisibleInTranscriptOnly) { bump(state, 'non_typed'); return; }
    if (typeof record.sessionId === 'string') session.sessionId = record.sessionId;
    const text = typedText(textItems(record.message && record.message.content, 'text'), state);
    if (text) session.messages.push(text);
  });
  if (!ok) return [];
  if (automation) { bump(state, 'automation_session'); return []; }
  if (!known) bump(state, 'unknown_format');
  return session.messages.length ? [session] : [];
}

async function readCodex(file, state) {
  const session = baseSession(file);
  let known = false, automation = false;
  const ok = await scanLines(file.file, state, line => {
    const record = parsedLine(line, state);
    if (!record) return;
    if (record.type === 'session_meta' && record.payload && typeof record.payload === 'object') {
      known = true;
      const meta = record.payload;
      if (meta.source === 'exec' || (meta.source && typeof meta.source === 'object' && Object.prototype.hasOwnProperty.call(meta.source, 'subagent'))) automation = true;
      if (typeof meta.id === 'string') session.sessionId = meta.id;
      if (typeof meta.cwd === 'string') session.project = path.basename(meta.cwd);
      return;
    }
    if (record.type !== 'response_item' || !record.payload || record.payload.type !== 'message' || record.payload.role !== 'user') return;
    known = true;
    const text = typedText(textItems(record.payload.content, 'input_text'), state);
    if (text) session.messages.push(text);
  });
  if (!ok) return [];
  if (automation) { bump(state, 'automation_session'); return []; }
  if (!known) bump(state, 'unknown_format');
  return session.messages.length ? [session] : [];
}

async function readGemini(file, state) {
  const session = baseSession(file);
  let known = false, messages = [];
  const ok = await scanLines(file.file, state, line => {
    const record = parsedLine(line, state);
    if (!record) return;
    if (typeof record.sessionId === 'string') { session.sessionId = record.sessionId; known = true; }
    if (record.$set && Object.prototype.hasOwnProperty.call(record.$set, 'messages')) {
      if (Array.isArray(record.$set.messages)) { messages = record.$set.messages; known = true; }
      else bump(state, 'unknown_format');
    }
  });
  if (!ok) return [];
  for (const message of messages) {
    if (!message || message.type !== 'user') continue;
    const items = Array.isArray(message.content) ? message.content.filter(item => item && typeof item.text === 'string' && (!item.type || item.type === 'text')).map(item => item.text) : [];
    const text = typedText(items, state);
    if (text) session.messages.push(text);
  }
  if (!known) bump(state, 'unknown_format');
  return session.messages.length ? [session] : [];
}

async function readGeminiLogs(file, state) {
  const grouped = new Map();
  // Old logs are JSON arrays. Frame one entry at a time instead of buffering the array.
  let entry = '', entryBytes = 0, depth = 0, quoted = false, escaped = false, oversize = false, started = false, finished = false, invalid = false;
  function accept() {
    if (oversize) { bump(state, 'oversize_line'); return; }
    const record = parsedLine(entry, state);
    if (!record || record.type !== 'user') return;
    if (typeof record.sessionId !== 'string' || typeof record.message !== 'string') { bump(state, 'unknown_format'); return; }
    const text = typedText([record.message], state);
    if (!text) return;
    if (!grouped.has(record.sessionId)) {
      const session = baseSession(file);
      session.sessionId = record.sessionId;
      grouped.set(record.sessionId, session);
    }
    grouped.get(record.sessionId).messages.push(text);
  }
  const ok = await scanLines(file.file, state, line => {
    for (const character of `${line}\n`) {
      if (!started) {
        if (/\s/.test(character)) continue;
        if (character !== '[') { invalid = true; return; }
        started = true;
        continue;
      }
      if (invalid) return;
      if (!depth) {
        if (/\s/.test(character) || character === ',') continue;
        if (character === ']') { finished = true; continue; }
        if (finished || character !== '{') { invalid = true; return; }
        depth = 1; entry = '{'; entryBytes = 1; quoted = false; escaped = false; oversize = false;
        continue;
      }
      if (!oversize) {
        entryBytes += Buffer.byteLength(character, 'utf8');
        entry += character;
        if (entryBytes > MAX_LINE) { oversize = true; entry = ''; }
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '{' || character === '[') depth += 1;
      else if (character === '}' || character === ']') {
        depth -= 1;
        if (!depth) accept();
      }
    }
  });
  if (!ok) return [];
  if (!started || invalid) { bump(state, 'unknown_format'); return []; }
  if (!finished || depth) bump(state, 'malformed_line');
  return [...grouped.values()];
}

async function readMemory(file, state) {
  const lines = [];
  if (!await scanLines(file.file, state, line => lines.push(line))) return null;
  const text = lines.join('\n').trim();
  if (!text) return null;
  if (privateMatch(text, state.privateTerms)) { bump(state, 'private_match'); return null; }
  return { file: file.file, text, date: new Date(file.mtimeMs).toISOString() };
}

async function readSessions({ home = os.homedir(), sources = [], limit = 20, privateTerms = [] } = {}) {
  const selectedSources = new Set(Array.isArray(sources) ? sources.filter(source => SOURCES.has(source)) : []);
  const maximum = Number.isInteger(limit) && limit >= 0 ? Math.min(limit, 20) : 20;
  const state = {
    home: path.resolve(home), candidates: [], memoryFiles: [], filesRead: [], filesChecked: 0, skipped: {},
    privateTerms: Array.isArray(privateTerms) ? privateTerms.filter(term => typeof term === 'string' && term).map(term => term.toLowerCase()) : []
  };
  await discover(state.home, selectedSources, state);
  state.candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
  const sessions = [], geminiSessions = new Map();
  const readers = { claude: readClaude, codex: readCodex, gemini: readGemini, 'gemini-logs': readGeminiLogs };
  for (const file of state.candidates) {
    if (sessions.length >= maximum) break;
    const found = await readers[file.format](file, state);
    for (const session of found) {
      if (session.source === 'gemini-cli' && geminiSessions.has(session.sessionId)) {
        const existing = geminiSessions.get(session.sessionId);
        for (const text of session.messages) {
          if (existing.messages.includes(text)) bump(state, 'duplicate_message');
          else existing.messages.push(text);
        }
      } else if (sessions.length < maximum) {
        if (session.source === 'gemini-cli') geminiSessions.set(session.sessionId, session);
        sessions.push(session);
      }
    }
  }
  const memories = [];
  state.memoryFiles.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
  for (const file of state.memoryFiles) {
    const memory = await readMemory(file, state);
    if (memory) memories.push(memory);
  }
  return { sessions, memories, filesRead: state.filesRead, filesChecked: state.filesChecked, skipped: state.skipped };
}

module.exports = { readSessions };
