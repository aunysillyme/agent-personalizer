'use strict';
// Shared, read-only install recipe. Uninstall compares against the same templates and copies.
const fs = require('fs');
const path = require('path');
const PKG = path.resolve(__dirname, '..');
const onboarding = require('../render/onboarding.cjs');

function installPlan({ answers, level, targets, notesScaffolded }) {
  const base = onboarding.baseFor(answers);
  const kind = onboarding.kindOf(answers);
  const plan = [];                                        // { rel, src | text }
  // signature=no: the signature rule file is not installed (a `requires:` rule that is absent cannot drift back in),
  // and every copied markdown loses its `Last edited by:` template line and its pointer to the rule.
  const noSig = answers.signature === 'no';
  const stripSig = (t) => noSig ? t.split('\n').filter(l => !l.includes('40-sign-every-edit.md') && !/^`?Last edited by:/.test(l)).join('\n') : t;
  const mdCopy = (rel, src) => plan.push({ rel, text: stripSig(fs.readFileSync(src, 'utf8')) });
  // rules/ is copied at level 3, where it becomes yours to edit; levels 1 and 2 render from the package's rules
  if (level >= 3) for (const f of fs.readdirSync(path.join(PKG, 'rules')).sort()) {
    if (noSig && f === '40-sign-every-edit.md') continue;
    mdCopy(`rules/${f}`, path.join(PKG, 'rules', f));
  }
  // The home templates carry four `notes/...` pointer lines. They collapse to ONE line whenever the
  // folder they name will not be there to read: a cloud notes tool has no local folder at all, and no
  // level below 2 creates one, so a level-1 install used to hand the first session four broken
  // pointers. NOTES_ONE_LINE is also what the level-2 upgrade looks for, byte for byte.
  const NOTES_ONE_LINE = (why) => `- Notes: see \`AGENT_ONBOARDING.md\` § Where you may write (${why})`;
  const NOTES_LATER = `no local notes folder at level 1; level 2 creates \`${base}/\``;
  // Is the folder every notes pointer names going to be there to read? The README is the file the AI
  // is told to read before it writes, and the level-2 scaffold creates it with the folder. The LEVEL
  // alone is a proxy that is wrong in both directions: a level-1 install can land beside a notes
  // folder that already exists, and a re-run at a lower level does not delete what a higher one made
  // (round 1, findings 4 and 5). One boolean drives the home-file collapse and both rendered files,
  // so they can never disagree about the same folder.
  const notesWhy = kind === 'cloud' ? 'reached through its connector, no local files'
    : !notesScaffolded ? NOTES_LATER
    : kind !== 'disk' ? 'local fallback folder `notes/`'
    : null;                                               // disk, scaffold present: the four paths, retargeted at notes_path
  const home = (name) => {
    let t = fs.readFileSync(path.join(PKG, 'templates', name), 'utf8');
    if (level < 3) {
      // no local rules/: the pointers point at the rendered block below, which carries the full text
      t = t.split('\n').filter(l => !/Rules, one file each, the owning copy/.test(l)).join('\n');
      t = t.replace(/`\[owner: rules\/[^\]]+\]`/g, '`[owner: the rendered block below]`');
    }
    if (notesWhy) {
      let done = false;
      t = t.split('\n').filter(l => { if (!/`notes\//.test(l)) return true; if (done) return false; done = true; return true; })
        .map(l => /`notes\//.test(l) ? NOTES_ONE_LINE(notesWhy) : l).join('\n');
    } else if (base !== 'notes') t = t.replace(/\bnotes\//g, `${base}/`);
    return stripSig(t);
  };
  const POINTER = 'pointer file; the renderer fills its block below';
  if (targets.includes('claude')) plan.push({ rel: 'CLAUDE.md', text: home('CLAUDE.md'), note: POINTER });
  if (targets.includes('agents')) plan.push({ rel: 'AGENTS.md', text: home('AGENTS.md'), note: POINTER });
  if (level >= 2 && kind !== 'cloud') {                   // a cloud tool's notes are not local files; no folder named after a workspace
    mdCopy(`${base}/README.md`, path.join(PKG, 'templates', 'FOLDER_README.md'));
    mdCopy(`${base}/sessions/TEMPLATE-week.md`, path.join(PKG, 'templates', 'session-log.md'));
    mdCopy(`${base}/decisions.md`, path.join(PKG, 'templates', 'decisions-log.md'));
    mdCopy(`${base}/inbox/README.md`, path.join(PKG, 'templates', 'INBOX_README.md'));
  }
  if (level >= 3) {
    for (const rel of ['render/render.cjs', 'render/targets.json', 'render/onboarding.cjs', 'hooks/README.md', 'hooks/claude-code/session-start.sh', 'check/gate.cjs', 'check/forbidden.example.txt'])
      plan.push({ rel, src: path.join(PKG, rel) });
  }

  return { plan, stripSig, notesWhy, NOTES_ONE_LINE, NOTES_LATER };
}

module.exports = { installPlan };
