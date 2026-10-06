#!/usr/bin/env node
'use strict';

// Installer journeys from the Codex audit of 2026-10-04. The public entry points
// are the test interface; no fixture reads or changes private identifier lists.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const finding = argv.shift() || 'all';
let ROOT = path.resolve(__dirname, '..');
let HISTORY = ROOT;
for (let i = 0; i < argv.length; i += 2) {
  if (!['--repo', '--history'].includes(argv[i]) || !argv[i + 1]) throw new Error('usage: ap-regressions.cjs F1|F2|F3|F4|F5|RERUN|core|all [--repo path] [--history path]');
  if (argv[i] === '--repo') ROOT = path.resolve(argv[i + 1]);
  else HISTORY = path.resolve(argv[i + 1]);
}
const CLI = path.join(ROOT, 'bin', 'agent-personalizer.js');
const TMP = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'ap-regressions-'));
const CONFIG = '.agent-personalizer.json';
const ALL = 'claude,agents,gemini,chatgpt,prompt';
let failed = 0;
let assertions = 0;

function verify(ok, label, detail = '') {
  assertions++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${current}  ${label}${!ok && detail ? ` -> ${detail}` : ''}`);
}
function exec(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (r.error) throw r.error;
  return { code: r.status, output: (r.stdout || '') + (r.stderr || '') };
}
function requireCode(r, wanted, label) {
  if (r.code !== wanted) throw new Error(`${label}: expected exit ${wanted}, got ${r.code}\n${r.output}`);
  return r;
}
function install(dir, answers = {}, cli = CLI, ais = ALL, level = 3) {
  return requireCode(exec(process.execPath, [cli, '--dir', dir, '--ai', ais, '--level', String(level), '--answers', '-', '--yes'], { input: JSON.stringify(answers) }), 0, 'install');
}
function render(dir, ...flags) { return exec(process.execPath, [path.join(dir, 'render', 'render.cjs'), '--dir', dir, ...flags]); }
function uninstall(dir, ...flags) { return requireCode(exec(process.execPath, [CLI, '--uninstall', '--dir', dir, ...flags]), 0, 'uninstall'); }
function dir(name) { const d = path.join(TMP, name); fs.mkdirSync(d); return d; }
function read(d, rel) { return fs.readFileSync(path.join(d, rel)); }
function text(d, rel) { return read(d, rel).toString('utf8'); }
function write(d, rel, bytes) { fs.writeFileSync(path.join(d, rel), bytes); }
function exists(d, rel) { return fs.existsSync(path.join(d, rel)); }
function files(d, rel = '') {
  const out = new Map();
  for (const name of fs.readdirSync(path.join(d, rel)).sort()) {
    const p = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(d, p));
    if (st.isDirectory()) for (const entry of files(d, p)) out.set(...entry);
    else if (st.isFile()) out.set(p, read(d, p));
    else throw new Error(`unexpected fixture entry: ${p}`);
  }
  return out;
}
function sameFiles(a, b) {
  return a.size === b.size && [...a].every(([name, bytes]) => b.has(name) && bytes.equals(b.get(name)));
}
function convergence(rerun, fresh, ignored = []) {
  const a = files(rerun), b = files(fresh);
  a.delete(CONFIG); b.delete(CONFIG);
  for (const name of a.keys()) if (ignored.some(prefix => name.startsWith(prefix))) a.delete(name);
  const differences = [];
  for (const [name, bytes] of a) {
    if (!b.has(name)) differences.push(`rerun-only ${name}`);
    else if (!bytes.equals(b.get(name))) differences.push(`differs ${name}`);
  }
  for (const name of b.keys()) if (!a.has(name)) differences.push(`fresh-only ${name}`);
  return differences.join(', ');
}
function owned(d) { return JSON.parse(text(d, CONFIG)).installed || {}; }
function outsideMarkers(t) {
  const begin = t.indexOf('<!-- agent-personalizer:begin -->');
  const end = t.indexOf('<!-- agent-personalizer:end -->');
  if (begin < 0 || end < begin) throw new Error('fixture has no generated block');
  return t.slice(0, begin) + '<generated block>' + t.slice(end + '<!-- agent-personalizer:end -->'.length);
}
function keptLine(output, rel) { return output.split(/\r?\n/).find(line => line.includes(rel) && /kept|edited|manual review/i.test(line)) || ''; }

function scriptArgs(args) {
  if (process.platform === 'darwin') return ['-q', '/dev/null', process.execPath, ...args];
  const quote = s => `'${s.replace(/'/g, "'\\''")}'`;
  return ['-qec', [process.execPath, ...args].map(quote).join(' '), '/dev/null'];
}
const INTERVIEW_TIMEOUT = 15000;
const PTY_TIMEOUT = 5000;
const KILL_GRACE = 250;
function terminalText(output) {
  return output
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[ -\/]*[@-~]/g, '')
    .replace(/\r/g, '');
}
function pty(args, label, timeout, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    // On macOS Node's stdin pipe is a socket, which BSD script cannot inspect with tcgetattr.
    // cat supplies a real pipe to script; arguments still pass through quoted positional values.
    const child = spawn('sh', ['-c', 'cat | script "$@"', label, ...scriptArgs(args)], { cwd: ROOT, detached: true });
    let output = '', stderr = '', settled = false;
    const killGroup = signal => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (e) { if (e.code !== 'ESRCH') throw e; }
    };
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { killGroup('SIGTERM'); } catch (e) { error = error || e; }
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
      // Keep this timer referenced: cleanup must finish even if inherited pipes never close.
      setTimeout(() => {
        try { killGroup('SIGKILL'); } catch (e) { error = error || e; }
        if (error) reject(error);
        else resolve({ code, output, stderr });
      }, KILL_GRACE);
    };
    const timer = setTimeout(() => finish(new Error(`${label} timed out\n${output}`)), timeout);
    child.on('error', e => finish(e));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', e => finish(e));
    child.stdout.on('data', data => {
      if (settled) return;
      output += data.toString();
      try { onOutput(output, child); } catch (e) { finish(e); }
    });
    child.stderr.on('data', data => { output += data.toString(); stderr += data.toString(); });
    child.on('close', code => finish(null, code));
  });
}
// Reply only after each prompt arrives. Sending every newline at once can lose answers when
// the installer closes and reopens readline between questions.
async function interview(d, questions, replies = {}, flags = [], onPrompt = () => {}) {
  let handled = 0;
  const asked = [];
  const result = await pty([CLI, '--dir', d, '--ai', 'claude', '--level', '1', ...flags], 'interview', INTERVIEW_TIMEOUT, (output, child) => {
    const plain = terminalText(output);
    if (plain.includes('Installing level ') || plain.includes('agent-personalizer:')) child.stdin.end();
    if (!plain.endsWith(': ') || plain.length <= handled) return;
    const line = plain.slice(plain.lastIndexOf('\n') + 1);
    const q = questions.find(q => line.startsWith(q.ask));
    if (!q) return;
    handled = plain.length;
    asked.push(q.id);
    onPrompt(q);
    child.stdin.write((replies[q.id] || '') + '\n');
  });
  return { ...result, asked };
}

const cases = {
  async RERUN() {
    const o = require(path.join(ROOT, 'render', 'onboarding.cjs'));
    const saved = { name:'Sam', pronouns:'they/them', work:'Illustration', focus:'Drafts', tone:'gentle', off_limits:['client work'], always_ask:['delete','publish'], never:['sales talk'], signature:'no' };
    const d = dir('saved-rerun');
    install(d, saved, CLI, 'claude', 1);
    const before = JSON.parse(text(d, CONFIG)).onboarding;
    requireCode(exec(process.execPath, [CLI, '--dir', d]), 0, 'nonterminal rerun without flags');
    verify(JSON.stringify(JSON.parse(text(d, CONFIG)).onboarding) === JSON.stringify(before), 'nonterminal rerun retains every legacy and current answer');
    verify(text(d,'USER.md').includes('## About me') && text(d,'USER.md').includes('Sam'), 'saved identity lives in About me');
    const fresh = dir('partial-answers');
    install(fresh, {tone:'gentle'}, CLI, 'claude', 1);
    verify(JSON.stringify(JSON.parse(text(fresh,CONFIG)).onboarding) === JSON.stringify(o.sparse(o.validate({tone:'gentle'}))), 'partial answers retain documented defaults semantics');
    const bad=dir('bad-rerun');write(bad,CONFIG,'{');
    requireCode(exec(process.execPath,[CLI,'--dir',bad]),2,'malformed config');
    verify(files(bad).size===1 && text(bad,CONFIG)==='{', 'invalid config refuses without writes');
    if (!['darwin','linux'].includes(process.platform)) {console.log('SKIP RERUN pty platform');return;}
    const probe=await pty(['-e','console.log(process.stdin.isTTY ? "AP_PTY_READY" : "AP_NO_PTY")'],'pty-probe',PTY_TIMEOUT,(output,child)=>child.stdin.end()).catch(error=>({error}));
    if(probe.error || probe.code!==0 || !probe.output.includes('AP_PTY_READY')) { console.log('SKIP RERUN pseudo-terminal unavailable: '+(probe.error ? probe.error.message : probe.stderr));return; }
    const result=requireCode(await pty([CLI,'--dir',d],'rerun',INTERVIEW_TIMEOUT,(output,child)=>child.stdin.end()),0,'terminal rerun');
    verify(!result.output.includes('Read your last 20 sessions?') && !result.output.includes('AIs to use') && !result.output.includes('How direct should'), 'terminal rerun asks nothing');
    verify(JSON.stringify(JSON.parse(text(d,CONFIG)).onboarding)===JSON.stringify(before), 'terminal rerun retains every answer');
    const f=path.join(TMP,'interactive-first');let replies=0;
    const first=requireCode(await pty([CLI,'--dir',f,'--ai','claude','--level','1'],'first',INTERVIEW_TIMEOUT,(output,child)=>{
      const plain=terminalText(output);
      if(replies===0 && /AIs \[claude\]:/.test(plain)) {replies++;child.stdin.write('\n');}
      if(replies===1 && plain.includes('Read your last 20 sessions? (y/N)')) {replies++;child.stdin.write('\n');}
      // Let cat finish after the install, so the terminal wrapper can report its exit.
      if(plain.includes('The installer made no network calls.')) child.stdin.end();
    }),0,'terminal first install default no');
    verify(replies===2 && first.output.includes('Nothing was read.') && !exists(f,'.agent-personalizer/digest.md'), 'Enter on first consent reads nothing');
  },
  F1() {
    const d = dir('profile-edit');
    install(d, { name: 'Original Profile Name' });
    const onboarding = require(path.join(ROOT, 'render', 'onboarding.cjs'));
    const answers = onboarding.validate(JSON.parse(text(d, CONFIG)).onboarding);
    verify(text(d, 'chatgpt-box1.txt').trimEnd() === onboarding.compactProfile(answers).trimEnd(), 'an untouched generated profile keeps the compact box bytes');
    write(d, 'USER.md', text(d, 'USER.md').replaceAll('Original Profile Name', 'Edited Profile Name'));
    requireCode(render(d), 0, 'render edited USER.md');
    verify(text(d, 'chatgpt-box1.txt').includes('Edited Profile Name') && !text(d, 'chatgpt-box1.txt').includes('Original Profile Name'), 'chatgpt-box1.txt carries the edited name');
    for (const home of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) verify(text(d, home).includes('Edited Profile Name'), `${home} carries the same edited profile`);
    requireCode(render(d, '--check'), 0, 'edited profile check');
    for (const box of ['chatgpt-box1.txt', 'chatgpt-box2.txt']) {
      fs.appendFileSync(path.join(d, box), '\nSEEDED BOX DRIFT\n');
      verify(render(d, '--check').code === 1, `--check detects drift in ${box}`);
      requireCode(render(d), 0, 'restore box');
    }
    const p = dir('preexisting-profile');
    const custom = '# My profile\n\nCall me Preexisting Profile Name. I keep my own wording.\n';
    write(p, 'USER.md', custom);
    install(p, { name: 'Stored Answer Name' });
    verify(text(p, 'USER.md') === custom, 'install keeps a pre-existing USER.md byte for byte');
    verify(text(p, 'chatgpt-box1.txt').trimEnd() === custom.trimEnd(), 'a pre-existing USER.md is the profile ChatGPT gets');
    const long = '# My complete profile\n\n' + 'Keep this profile sentence exactly as written. '.repeat(90) + '\n';
    write(p, 'USER.md', long);
    requireCode(render(p), 0, 'render a long custom profile');
    verify(text(p, 'chatgpt-box1.txt').trimEnd() === long.trimEnd(), 'a custom profile over budget keeps its full text');
    verify(text(p, 'chatgpt-custom-instructions.md').includes('OVER BUDGET'), 'an over-budget custom profile is flagged');
  },
  F2() {
    const d = dir('notes-path-rerun'), fresh = dir('notes-path-fresh');
    install(d, { notes_path: 'journal' });
    const old = new Map([...files(d)].filter(([name]) => name.startsWith('journal/')));
    const changed = install(d, { notes_path: 'new-notes' });
    install(fresh, { notes_path: 'new-notes' });
    const diff = convergence(d, fresh, ['journal/']);
    verify(!diff, 'notes path: rerun converges to a fresh install', diff);
    verify([...old].every(([name, bytes]) => exists(d, name) && read(d, name).equals(bytes)), 'the old notes folder keeps every byte');
    verify([...old.keys()].every(name => Object.hasOwn(owned(d), name)), 'old notes paths remain in the recorded uninstall inventory');
    const migration = changed.output.split(/\r?\n/).filter(line => line.includes('journal') && line.includes('new-notes'));
    verify(migration.length === 1, 'the log names the old and new notes folder together once', migration.join('\n'));
    const e = dir('notes-edited-pointer');
    install(e, { notes_path: 'journal' });
    const oldText = text(e, 'CLAUDE.md');
    const oldLine = oldText.split('\n').find(line => /^- Notes /.test(line) && line.includes('journal/README.md'));
    if (!oldLine) throw new Error('notes pointer fixture was not found');
    const editedLine = oldLine + ' Keep my café routing choice.';
    write(e, 'CLAUDE.md', oldText.replace(oldLine + '\n', editedLine + '\r\n') + '\nKeep my own tail exactly.\r\n');
    const beforeOutside = outsideMarkers(text(e, 'CLAUDE.md'));
    const r = install(e, { notes_path: 'new-notes' });
    const afterOutside = outsideMarkers(text(e, 'CLAUDE.md'));
    verify(afterOutside.includes(editedLine + '\r\n'), 'an edited pointer keeps its bytes and CRLF');
    const expected = beforeOutside.replaceAll('`journal/sessions/`', '`new-notes/sessions/`').replaceAll('`journal/decisions.md`', '`new-notes/decisions.md`').replaceAll('`journal/inbox/`', '`new-notes/inbox/`');
    verify(afterOutside === expected, 'only unchanged installer pointer lines outside the markers migrate');
    verify(r.output.includes('CLAUDE.md') && r.output.includes(editedLine) && /manual review/i.test(r.output), 'the log names the edited pointer and its file for manual review');
    requireCode(render(e, '--check'), 0, 'edited pointer remains outside drift ownership');
  },
  F3() {
    const d = dir('signature-rerun'), fresh = dir('signature-fresh');
    install(d, { signature: 'yes' });
    install(d, { signature: 'no' });
    install(fresh, { signature: 'no' });
    const diff = convergence(d, fresh);
    verify(!diff, 'signature: rerun converges to a fresh install', diff);
    verify(!exists(d, 'rules/40-sign-every-edit.md'), 'an untouched disabled signature rule is removed');
    verify(['CLAUDE.md', 'AGENTS.md'].every(home => !text(d, home).includes('Sign every edit') && !text(d, home).includes('40-sign-every-edit.md')), 'unchanged signing pointers are removed');
    verify([...files(d)].filter(([name]) => name.endsWith('.md')).every(([, bytes]) => !bytes.includes(Buffer.from('Last edited by:'))), 'untouched notes and rule templates remove signature lines');
    requireCode(render(d, '--check'), 0, 'signature transition check');
    install(d, { signature: 'yes' });
    const restored = dir('signature-restored-fresh');
    install(restored, { signature: 'yes' });
    const back = convergence(d, restored);
    verify(!back, 'enabling signatures again also converges to a fresh install', back);
    const e = dir('signature-edited');
    install(e, { signature: 'yes' });
    fs.appendFileSync(path.join(e, 'rules/40-sign-every-edit.md'), '\nMy edited origin detail.\n');
    fs.appendFileSync(path.join(e, 'notes/decisions.md'), '\nMy real decision stays.\r\n');
    const edited = ['rules/40-sign-every-edit.md', 'notes/decisions.md'].map(name => [name, read(e, name)]);
    const oldText = text(e, 'AGENTS.md'), oldLine = oldText.split('\n').find(line => /^- Sign every edit\./.test(line));
    const line = oldLine + ' My wording stays.';
    write(e, 'AGENTS.md', oldText.replace(oldLine, line));
    const r = install(e, { signature: 'no' });
    for (const [name, bytes] of edited) verify(read(e, name).equals(bytes) && /edited/i.test(keptLine(r.output, name)), `the edited ${name} is kept and named`);
    verify(text(e, 'AGENTS.md').includes(line) && r.output.includes(line) && /manual review/i.test(r.output), 'an edited signing pointer is kept and named for review');
    requireCode(render(e, '--check'), 0, 'edited signature source check');
  },
  F4() {
    const d = dir('uninstall-notes-history');
    install(d, { notes_path: 'journal' });
    install(d, { notes_path: 'new-notes' });
    const before = files(d), dry = uninstall(d, '--dry');
    verify(sameFiles(before, files(d)), 'uninstall --dry leaves every file byte unchanged');
    const r = uninstall(d);
    const left = [...files(d).keys()];
    verify(left.length === 1 && left[0] === 'LEARNED.md', 'uninstall after a notes-path change keeps only entries', left.join(', '));
    for (const name of ['journal/README.md', 'journal/decisions.md', 'journal/inbox/README.md', 'journal/sessions/TEMPLATE-week.md']) verify(dry.output.includes(name) && r.output.includes(name), `preview and removal both name historical ${name}`);
    const s = dir('uninstall-signature-history');
    install(s, { signature: 'yes' });
    install(s, { signature: 'no' });
    uninstall(s);
    const signatureLeft = [...files(s).keys()];
    verify(signatureLeft.length === 1 && signatureLeft[0] === 'LEARNED.md', 'uninstall after signature changes keeps only entries', signatureLeft.join(', '));
    const e = dir('uninstall-edited-notes');
    fs.mkdirSync(path.join(e, 'journal/sessions'), { recursive: true });
    install(e, { notes_path: 'journal' });
    const note = 'journal/decisions.md', userNote = 'journal/sessions/my-own-note.md';
    fs.appendFileSync(path.join(e, note), '\nA real decision with café and CRLF.\r\n');
    write(e, userNote, 'My own note was never installed.\r\n');
    const original = read(e, note), own = read(e, userNote);
    install(e, { notes_path: 'new-notes' });
    verify(!Object.hasOwn(owned(e), userNote), 'a user-written note is absent from the ownership inventory');
    const kept = uninstall(e);
    verify(read(e, note).equals(original) && /edited/i.test(keptLine(kept.output, note)), 'an edited historical note keeps every byte and is named');
    verify(read(e, userNote).equals(own), 'a note the installer never recorded keeps every byte');
    verify(fs.statSync(path.join(e, 'journal/sessions')).isDirectory(), 'a pre-existing notes directory stays');
    verify(!exists(e, 'journal/README.md') && !exists(e, 'new-notes/README.md'), 'untouched notes scaffolds from both runs are removed');
  },
  F5() {
    const runtime = ['render/render.cjs', 'render/onboarding.cjs', 'render/targets.json', 'check/gate.cjs', 'check/forbidden.example.txt', 'hooks/README.md', 'hooks/claude-code/session-start.sh'];
    const rules = fs.readdirSync(path.join(ROOT, 'rules')).map(name => `rules/${name}`);
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    for (const tag of ['v0.5.1', 'v0.6.4']) {
      const pkg = dir(`release-${tag}`), archive = path.join(TMP, `${tag}.tar`);
      // Only explicit public inputs are archived. No ignored local identifier list
      // can enter a fixture, even if the working copy has one beside gate.cjs.
      requireCode(exec('git', ['archive', '--format=tar', `--output=${archive}`, tag, 'package.json', 'bin', 'render', 'rules', 'templates', 'hooks', 'check/gate.cjs', 'check/forbidden.example.txt'], { cwd: HISTORY }), 0, `archive ${tag} (the CI checkout fetches tags)`);
      requireCode(exec('tar', ['-xf', archive, '-C', pkg]), 0, `extract ${tag}`);
      const d = dir(`upgrade-${tag}`);
      install(d, {}, path.join(pkg, 'bin', 'agent-personalizer.js'));
      install(d);
      const report = requireCode(render(d, '--version'), 0, 'installed renderer version').output.trim();
      verify(report === version, `installed renderer reports ${version} after a ${tag} install`, `got ${JSON.stringify(report)}`);
      for (const name of [...runtime, ...rules]) verify(read(d, name).equals(fs.readFileSync(path.join(ROOT, name))), `${name} refreshes from ${tag} to the running package`);
      const cfg = JSON.parse(text(d, CONFIG));
      verify(cfg.toolingVersion === version, 'the config records the running tooling version');
      verify(render(d, '--check').code === 0, `the installed renderer check is clean after ${tag}`);
      const e = dir(`upgrade-edited-${tag}`);
      install(e, {}, path.join(pkg, 'bin', 'agent-personalizer.js'));
      fs.appendFileSync(path.join(e, 'check/gate.cjs'), '\n// My gate change keeps this exact byte sequence.\n');
      const before = read(e, 'check/gate.cjs');
      const r = install(e), log = keptLine(r.output, 'check/gate.cjs');
      verify(read(e, 'check/gate.cjs').equals(before), `an edited gate from ${tag} keeps every byte`);
      verify(/edited/i.test(log), 'installer says the gate.cjs it kept was edited', log);
      verify(log.includes(tag.slice(1)) && /remove|replace|take/i.test(log) && /re-run/i.test(log), 'the edited-tool notice names its old version and how to take the new one', log);
    }
  },
};
let current = '';
const selected = finding === 'all' ? Object.keys(cases) : finding === 'core' ? ['RERUN', 'F1', 'F2', 'F3', 'F4'] : [finding];
(async () => {
  try {
    for (current of selected) {
      if (!cases[current]) throw new Error(`unknown finding ${current}`);
      try { await cases[current](); }
      catch (e) { failed++; console.error(`ERROR ${current} ${e.message}`); }
    }
  } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
  console.log(`${assertions} assertions, ${failed} failures`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
