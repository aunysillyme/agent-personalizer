'use strict';
// Red-first regression suite for v0.10.1 (GitHub issues #51, #52, #53 and #54).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/agent-personalizer.js');
const renderCli = path.join(root, 'render/render.cjs');
const { consentScreen } = require(path.join(root, 'bin/learn.cjs'));

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function runCli(args, env = {}, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HERMES_HOME: '', CODEX_HOME: '', ...env },
  });
}

const cases = {
  // #51: Respect CODEX_HOME across global install, re-run, rollback, learning and uninstall; warn on non-empty AGENTS.override.md without touching it.
  async 'issue-51-codex-home-and-override'(tmp) {
    const userHome = path.join(tmp, 'home');
    const customCodex = path.join(tmp, 'custom-codex');
    fs.mkdirSync(userHome, { recursive: true });

    // 1. Custom CODEX_HOME (not yet created on disk): writes to $CODEX_HOME/AGENTS.md, nothing in ~/.codex.
    const installOut = runCli(['--global', '--ai', 'claude,agents', '--yes'], {
      HOME: userHome,
      USERPROFILE: userHome,
      CODEX_HOME: customCodex,
    });
    assert.equal(installOut.status, 0, installOut.stdout + installOut.stderr);
    assert(fs.existsSync(path.join(customCodex, 'AGENTS.md')), 'AGENTS.md written inside custom CODEX_HOME');
    assert(!fs.existsSync(path.join(userHome, '.codex')), 'Default ~/.codex untouched when CODEX_HOME is set');
    assert(!/Warning:.*AGENTS\.override\.md/.test(installOut.stdout + installOut.stderr), 'No override warning when AGENTS.override.md is absent');

    // Empty AGENTS.override.md is ignored by Codex and must not trigger a warning.
    const overridePath = write(customCodex, 'AGENTS.override.md', '   \n');
    const emptyRerun = runCli(['--global'], {
      HOME: userHome,
      USERPROFILE: userHome,
      CODEX_HOME: customCodex,
    });
    assert.equal(emptyRerun.status, 0, emptyRerun.stdout + emptyRerun.stderr);
    assert(!/Warning:.*AGENTS\.override\.md/.test(emptyRerun.stdout + emptyRerun.stderr), 'Whitespace-only AGENTS.override.md does not warn');
    assert.equal(fs.readFileSync(overridePath, 'utf8'), '   \n', 'Whitespace override preserved byte for byte');

    // Non-empty AGENTS.override.md warns clearly and stays untouched byte for byte.
    const overrideContent = '# Temporary global override\nUse strict mode.\n';
    fs.writeFileSync(overridePath, overrideContent);
    const overrideHash = sha256(fs.readFileSync(overridePath));
    const warnRerun = runCli(['--global'], {
      HOME: userHome,
      USERPROFILE: userHome,
      CODEX_HOME: customCodex,
    });
    assert.equal(warnRerun.status, 0, warnRerun.stdout + warnRerun.stderr);
    assert.match(warnRerun.stderr, /Warning:.*AGENTS\.override\.md.*AGENTS\.md/i, 'Non-empty override warns on stderr');
    assert.equal(sha256(fs.readFileSync(overridePath)), overrideHash, 'Non-empty AGENTS.override.md is never modified');

    // Global learning with custom CODEX_HOME reads sessions and memories from CODEX_HOME.
    write(
      customCodex,
      'sessions/2026/11/18/rollout-custom.jsonl',
      JSON.stringify({ type: 'session_meta', payload: { id: 'c1', cwd: tmp, source: 'cli' } }) + '\n' +
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'CUSTOM_CODEX_HOME_SESSION_TYPED' }] } }) + '\n'
    );
    write(customCodex, 'memories_v2/MEMORY.md', 'CUSTOM_CODEX_HOME_MEMORY_NOTE\n');
    const learnOut = runCli(['learn', '--global', '--yes'], {
      HOME: userHome,
      USERPROFILE: userHome,
      CODEX_HOME: customCodex,
    });
    assert.equal(learnOut.status, 0, learnOut.stdout + learnOut.stderr);
    const digest = fs.readFileSync(path.join(userHome, '.agent-personalizer/.agent-personalizer/digest.md'), 'utf8');
    assert(digest.includes('CUSTOM_CODEX_HOME_SESSION_TYPED'), 'learn --global reads sessions from CODEX_HOME');
    assert(digest.includes('CUSTOM_CODEX_HOME_MEMORY_NOTE'), 'learn --global reads memories from CODEX_HOME');
    runCli(['learn', '--global', '--forget'], { HOME: userHome, USERPROFILE: userHome });

    // Uninstall removes $CODEX_HOME/AGENTS.md even if CODEX_HOME is unset at uninstall time, while keeping AGENTS.override.md.
    const uninst = runCli(['--global', '--uninstall'], { HOME: userHome, USERPROFILE: userHome, CODEX_HOME: '' });
    assert.equal(uninst.status, 0, uninst.stdout + uninst.stderr);
    assert(!fs.existsSync(path.join(customCodex, 'AGENTS.md')), 'Uninstall removes custom CODEX_HOME/AGENTS.md from stored ownership');
    assert.equal(sha256(fs.readFileSync(overridePath)), overrideHash, 'Uninstall leaves AGENTS.override.md untouched');

    // Relative and symlinked CODEX_HOME values fail closed before writing.
    const badHome = path.join(tmp, 'bad-home');
    fs.mkdirSync(badHome, { recursive: true });
    const relOut = runCli(['--global', '--ai', 'agents', '--yes'], {
      HOME: badHome,
      USERPROFILE: badHome,
      CODEX_HOME: 'relative-codex',
    });
    assert.equal(relOut.status, 2, relOut.stdout + relOut.stderr);
    assert.deepEqual(fs.readdirSync(badHome), [], 'Relative CODEX_HOME writes nothing');

    const realTarget = path.join(tmp, 'real-codex');
    fs.mkdirSync(realTarget, { recursive: true });
    const symCodex = path.join(tmp, 'sym-codex');
    fs.symlinkSync(realTarget, symCodex);
    const symOut = runCli(['--global', '--ai', 'agents', '--yes'], {
      HOME: badHome,
      USERPROFILE: badHome,
      CODEX_HOME: symCodex,
    });
    assert.equal(symOut.status, 2, symOut.stdout + symOut.stderr);
    assert.deepEqual(fs.readdirSync(realTarget), [], 'Symlinked CODEX_HOME writes nothing');

    // Ancestor symlink in CODEX_HOME on install fails closed before writing.
    const realParent = path.join(tmp, 'real-parent');
    fs.mkdirSync(path.join(realParent, 'codex'), { recursive: true });
    const symParent = path.join(tmp, 'sym-parent');
    fs.symlinkSync(realParent, symParent);
    const ancSymInstall = runCli(['--global', '--ai', 'agents', '--yes'], {
      HOME: badHome,
      USERPROFILE: badHome,
      CODEX_HOME: path.join(symParent, 'codex'),
    });
    assert.equal(ancSymInstall.status, 2, ancSymInstall.stdout + ancSymInstall.stderr);
    assert.deepEqual(fs.readdirSync(path.join(realParent, 'codex')), [], 'Ancestor symlink CODEX_HOME writes nothing');

    // Substituted ancestor symlink after install fails closed on migration, --uninstall --dry, and --uninstall.
    const subHome = path.join(tmp, 'sub-home');
    const origAnchor = path.join(tmp, 'orig-anchor');
    const decoyAnchor = path.join(tmp, 'decoy-anchor');
    fs.mkdirSync(subHome, { recursive: true });
    fs.mkdirSync(path.join(origAnchor, 'codex'), { recursive: true });
    fs.mkdirSync(path.join(decoyAnchor, 'codex'), { recursive: true });
    const subInstall = runCli(['--global', '--ai', 'agents', '--yes'], {
      HOME: subHome,
      USERPROFILE: subHome,
      CODEX_HOME: path.join(origAnchor, 'codex'),
    });
    assert.equal(subInstall.status, 0, subInstall.stdout + subInstall.stderr);
    const decoyAgents = path.join(decoyAnchor, 'codex/AGENTS.md');
    fs.copyFileSync(path.join(origAnchor, 'codex/AGENTS.md'), decoyAgents);
    const movedAway = path.join(tmp, 'orig-anchor-moved');
    fs.renameSync(origAnchor, movedAway);
    fs.symlinkSync(decoyAnchor, origAnchor);

    const migSym = runCli(['--global', '--ai', 'agents', '--yes'], {
      HOME: subHome,
      USERPROFILE: subHome,
      CODEX_HOME: path.join(tmp, 'another-codex'),
    });
    assert.equal(migSym.status, 2, migSym.stdout + migSym.stderr);
    assert(fs.existsSync(decoyAgents), 'Migration refuses substituted ancestor symlink without touching decoy');

    const drySym = runCli(['--global', '--uninstall', '--dry'], { HOME: subHome, USERPROFILE: subHome });
    assert.equal(drySym.status, 2, drySym.stdout + drySym.stderr);

    const uninstSym = runCli(['--global', '--uninstall'], { HOME: subHome, USERPROFILE: subHome });
    assert.equal(uninstSym.status, 2, uninstSym.stdout + uninstSym.stderr);
    assert(fs.existsSync(decoyAgents), 'Uninstall refuses substituted ancestor symlink and keeps decoy intact');
    assert(fs.existsSync(path.join(movedAway, 'codex/AGENTS.md')), 'Original installed file in moved directory remains untouched');

    // Default case (~/.codex) with non-empty AGENTS.override.md also warns and preserves the override.
    const defHome = path.join(tmp, 'def-home');
    fs.mkdirSync(defHome, { recursive: true });
    const defOverride = write(defHome, '.codex/AGENTS.override.md', 'Override default global instructions.\n');
    const defOut = runCli(['--global', '--ai', 'agents', '--yes'], { HOME: defHome, USERPROFILE: defHome });
    assert.equal(defOut.status, 0, defOut.stdout + defOut.stderr);
    assert(fs.existsSync(path.join(defHome, '.codex/AGENTS.md')), 'Default ~/.codex/AGENTS.md written');
    assert.match(defOut.stderr, /Warning:.*AGENTS\.override\.md/i, 'Default ~/.codex override warns');
    assert.equal(fs.readFileSync(defOverride, 'utf8'), 'Override default global instructions.\n');

    // Migrating from default ~/.codex to a custom CODEX_HOME retires the unedited ~/.codex/AGENTS.md block.
    const movedCodex = path.join(tmp, 'moved-codex');
    const moveOut = runCli(['--global', '--ai', 'agents', '--yes'], {
      HOME: defHome,
      USERPROFILE: defHome,
      CODEX_HOME: movedCodex,
    });
    assert.equal(moveOut.status, 0, moveOut.stdout + moveOut.stderr);
    assert(fs.existsSync(path.join(movedCodex, 'AGENTS.md')), 'Moved CODEX_HOME/AGENTS.md created');
    assert(!fs.existsSync(path.join(defHome, '.codex/AGENTS.md')), 'Unedited default ~/.codex/AGENTS.md removed on CODEX_HOME move');
    assert.equal(fs.readFileSync(defOverride, 'utf8'), 'Override default global instructions.\n', 'Default override preserved');

    // Atomic rollback restores custom CODEX_HOME target and removes newly created CODEX_HOME folder on later target failure.
    const rbHome = path.join(tmp, 'rb-home');
    const rbCodex = path.join(tmp, 'rb-codex');
    fs.mkdirSync(rbHome, { recursive: true });
    const fault = write(
      tmp,
      'fault-gemini.cjs',
      `const fs = require('node:fs'); const path = require('node:path');
const orig = fs.renameSync; let tripped = false;
const home = fs.realpathSync(process.env.HOME);
fs.renameSync = function(from, to) {
  if (!tripped && to === path.join(home, '.gemini', 'GEMINI.md')) {
    tripped = true; throw new Error('injected gemini rename failure');
  }
  return orig.apply(this, arguments);
};
`
    );
    const rbOut = runCli(['--global', '--ai', 'claude,agents,gemini', '--yes'], {
      HOME: rbHome,
      USERPROFILE: rbHome,
      CODEX_HOME: rbCodex,
      NODE_OPTIONS: `--require ${fault}`,
    });
    assert.notEqual(rbOut.status, 0, rbOut.stdout + rbOut.stderr);
    assert(!fs.existsSync(rbCodex), 'Rollback removes newly created custom CODEX_HOME directory and its AGENTS.md');
    assert.deepEqual(fs.readdirSync(rbHome), [], 'Rollback restores rbHome to empty');

    // Project install with non-empty AGENTS.override.md warns without touching the override.
    const projOverrideDir = path.join(tmp, 'proj-override');
    const projOverrideFile = write(projOverrideDir, 'AGENTS.override.md', '# Project override\n');
    const projOut = runCli(['--dir', projOverrideDir, '--ai', 'agents', '--level', '1', '--yes', '--defaults']);
    assert.equal(projOut.status, 0, projOut.stdout + projOut.stderr);
    assert.match(projOut.stderr, /Warning:.*AGENTS\.override\.md/i, 'Project install warns when AGENTS.override.md shadows AGENTS.md');
    assert.equal(fs.readFileSync(projOverrideFile, 'utf8'), '# Project override\n', 'Project AGENTS.override.md preserved');

    // Docs explain CODEX_HOME, AGENTS.override.md warning and how to verify active instruction sources in a fresh Codex session.
    const installDoc = fs.readFileSync(path.join(root, 'docs/install.md'), 'utf8');
    const pasteDoc = fs.readFileSync(path.join(root, 'docs/paste-guide.md'), 'utf8');
    assert(installDoc.includes('CODEX_HOME') && installDoc.includes('AGENTS.override.md'));
    assert(pasteDoc.includes('CODEX_HOME') && pasteDoc.includes('AGENTS.override.md'));
    assert(/Summarize the current instructions|instruction sources/i.test(pasteDoc), 'Paste guide documents fresh-session verification for Codex');
  },

  // #52: Surface-specific ChatGPT file-access wording and local Codex memory-store wording.
  async 'issue-52-chatgpt-and-codex-memory-wording'(tmp) {
    const proj = path.join(tmp, 'chatgpt-proj');
    fs.mkdirSync(proj, { recursive: true });
    const out = runCli(['--dir', proj, '--ai', 'chatgpt', '--level', '1', '--yes', '--defaults']);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const preview = fs.readFileSync(path.join(proj, 'chatgpt-custom-instructions.md'), 'utf8');
    assert(!preview.includes('ChatGPT has no file access'), 'Blanket "ChatGPT has no file access" claim removed');
    assert(/do not read your local project folder|depends on the surface/i.test(preview), 'Surface-specific ChatGPT file-access wording present');
    assert(/1,500/.test(preview) && /5,000/.test(preview), 'Current Free/Go and paid plan limits stated');

    for (const allProjects of [false, true]) {
      const screen = consentScreen({ allProjects });
      assert(!/global to your Codex account/i.test(screen), 'Consent screen does not claim Codex memories are account-global');
      assert(/local Codex memory/i.test(screen) && /machine|host/i.test(screen), 'Consent screen describes local Codex memory scope');
    }
    const learningDoc = fs.readFileSync(path.join(root, 'docs/learning.md'), 'utf8');
    assert(!/global to your Codex account/i.test(learningDoc), 'learning.md does not claim Codex memories are account-global');
    assert.equal(learningDoc.match(/```text\n([\s\S]*?)\n```/)[1], consentScreen(), 'learning.md consent block matches consentScreen()');
  },

  // #53: README documents the Git info/exclude (and level-3 --precommit) exception to the project write boundary.
  async 'issue-53-readme-git-write-boundary'() {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const guarantees = fs.readFileSync(path.join(root, 'docs/guarantees.md'), 'utf8');
    assert(!readme.includes('Project writes stay inside the folder you name; global writes'), 'Unqualified README write-boundary sentence replaced');
    assert(readme.includes('info/exclude') && readme.includes('docs/guarantees.md#preflight-and-writes'), 'README qualifies Git metadata exception and links guarantees');
    assert(!guarantees.includes('the one write outside the installed files'), 'guarantees.md no longer claims Git exclude is the sole write outside');
    assert(guarantees.includes('info/exclude') && guarantees.includes('--precommit'), 'guarantees.md covers both Git info/exclude and opt-in --precommit');
  },

  // #54: Declined-entry overflow docs match full export behavior; companion docs scope enforcement to calls through the configured companion.
  async 'issue-54-declined-overflow-and-companion-scope'() {
    const learningDoc = fs.readFileSync(path.join(root, 'docs/learning.md'), 'utf8');
    const pasteDoc = fs.readFileSync(path.join(root, 'docs/paste-guide.md'), 'utf8');
    const companionsDoc = fs.readFileSync(path.join(root, 'docs/companions.md'), 'utf8');
    assert(!/may be shortened to fit/i.test(learningDoc), 'learning.md no longer claims declined ChatGPT entries are shortened');
    assert(!/may be shortened to fit/i.test(pasteDoc), 'paste-guide.md no longer claims declined ChatGPT entries are shortened');
    assert(/OVER BUDGET/.test(learningDoc) && /--strict/.test(learningDoc), 'learning.md describes full export, OVER BUDGET flag and --strict');
    assert(!companionsDoc.includes('both make the onboarding answers enforceable instead of advisory'), 'companions.md removes blanket enforcement claim');
    assert(/through that companion|routed through/i.test(companionsDoc) && /filesystem|sandbox|permissions/i.test(companionsDoc), 'companions.md scopes enforcement to companion calls and notes direct tool/sandbox permissions');
  },
};

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ap0101-'));
  let failures = 0;
  try {
    for (const [name, fn] of Object.entries(cases)) {
      const sub = path.join(base, name);
      fs.mkdirSync(sub, { recursive: true });
      try {
        await fn(sub);
        console.log(`PASS ${name}`);
      } catch (err) {
        failures += 1;
        console.error(`FAIL ${name}: ${err.message}`);
      }
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  if (failures) process.exit(1);
}

main();
