'use strict';
// Black-box journeys use invented history in a fake HOME; the real app stores stay closed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync('/tmp/ap-learning-');
const home = path.join(temp, 'home');
const project = path.join(temp, 'project');
fs.mkdirSync(home); fs.mkdirSync(project);
function run(args, expected = 0, options = {}) {
  const out = spawnSync(process.execPath, [path.join(root, 'bin/agent-personalizer.js'), ...args], { cwd: root, env: {...process.env, HOME: home}, encoding:'utf8', ...options });
  assert.equal(out.status, expected, out.stdout + out.stderr);
  return out.stdout + out.stderr;
}
const file = rel => path.join(project, rel);
const text = rel => fs.readFileSync(file(rel), 'utf8');
const learned = `# LEARNED.md

## Learned
- [said, confirmed] CONFIRMED_EXAMPLE Keep one idea per line (evidence: twice)
- [inferred, confirmed] INFERRED_EXAMPLE Compare drafts visually
- [said, declined] DECLINED_EXAMPLE Default to tables (evidence: once)
- [inferred, proposed] PROPOSED_EXAMPLE Always choose blue

## Asked
`;
try {
  run(['learn','--dir',project,'--yes'],2);
  run(['--dir',project,'--ai','claude,agents,gemini,chatgpt,prompt','--level','3','--yes']);
  assert(fs.existsSync(file('LEARNED.md')));
  assert(fs.existsSync(file('.claude/commands/personalize.md')));
  assert(!fs.existsSync(file('.agent-personalizer/digest.md')));
  const unchanged = text('LEARNED.md');
  run(['--dir',project]);
  assert.equal(text('LEARNED.md'), unchanged);
  const sessions=path.join(home,'.claude/projects/invented-project');fs.mkdirSync(sessions,{recursive:true});
  fs.writeFileSync(path.join(sessions,'typed.jsonl'),[
    {type:'user',message:{content:'VISIBLE_TYPED_EXAMPLE Keep it short.'}},
    {type:'user',message:{content:'SecretFixturePerson details stay private.'}},
    {type:'user',message:{content:'<environment_context>CONTEXT_EXCLUDED</environment_context>'}},
    {type:'user',message:{content:'<!-- reply --> Keep the quoted reply.'}},
    {type:'user',message:{content:'A reserved <!-- agent-personalizer:begin --> marker.'}},
    {type:'assistant',message:{content:'ASSISTANT_EXCLUDED'}}
  ].map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(file('check/forbidden.local.txt'),'# invented\n\nSecretFixturePerson\nallow:Something else\n');
  const logger=path.join(temp,'preload.cjs'), log=path.join(temp,'reads');
  fs.writeFileSync(logger, `const fs=require('node:fs'); const path=require('node:path'); const home=process.env.HOME;
for (const key of ['readFileSync','readdirSync','openSync']) {const orig=fs[key];fs[key]=function(p,...a){if(typeof p==='string'&&(p===home||p.startsWith(home+path.sep)))fs.appendFileSync(process.env.AP_READ_LOG,key+' '+p+'\\n');return orig.call(this,p,...a);};}
`);
  run(['learn','--dir',project],2,{env:{...process.env,HOME:home,AP_READ_LOG:log,NODE_OPTIONS:'--require '+logger}});
  assert(!fs.existsSync(log),'no HOME files opened or listed without yes');
  assert(!fs.existsSync(file('.agent-personalizer/digest.md')));
  fs.writeFileSync(file('LEARNED.md'),learned);
  run(['--dir',project]);
  for(const rel of ['CLAUDE.md','AGENTS.md','GEMINI.md','chatgpt-custom-instructions.md','chatgpt-box1.txt']) {
    assert(text(rel).includes('CONFIRMED_EXAMPLE'),rel);
    assert(text(rel).includes('INFERRED_EXAMPLE'),rel);
    assert(!text(rel).includes('PROPOSED_EXAMPLE'),rel);
  }
  for(const rel of ['CLAUDE.md','AGENTS.md','GEMINI.md']) {
    assert(text(rel).includes('DECLINED_EXAMPLE'),rel);
    assert(text(rel).includes('Never ask again'),rel);
    assert(text(rel).includes('up to 5 real patterns'),rel);
  }
  assert(!text('system-prompt.md').includes('CONFIRMED_EXAMPLE'));
  assert(text('USER.md').includes('CONFIRMED_EXAMPLE'));
  const out=run(['learn','--dir',project,'--yes']);
  assert(out.includes('read   ~/.claude/projects/invented-project/typed.jsonl'));
  assert(!out.includes('VISIBLE_TYPED_EXAMPLE'));
  assert(!out.includes('SecretFixturePerson'));
  assert.equal(text('.agent-personalizer/.gitignore'),'*\n');
  assert.equal(fs.statSync(file('.agent-personalizer/digest.md')).mode & 0o777,0o600);
  const digest=text('.agent-personalizer/digest.md');
  assert(digest.includes('VISIBLE_TYPED_EXAMPLE'));
  assert(digest.includes('<!-- reply -->'));
  assert(!digest.includes('ASSISTANT_EXCLUDED'));
  assert(!digest.includes('CONTEXT_EXCLUDED'));
  assert(!digest.includes('SecretFixturePerson'));
  assert(!digest.includes('<!-- agent-personalizer:begin -->'));
  assert(digest.includes('DECLINED_EXAMPLE'));
  const renderer=path.join(project,'render/render.cjs');
  function render(...args) {return spawnSync(process.execPath,[renderer,'--dir',project,...args],{encoding:'utf8'});}
  assert.equal(render('--check').status,0);
  assert(render('--contract').stdout.includes('/personalize'));
  const id=digest.split('\n').find(line=>line.startsWith('digest: '));
  fs.appendFileSync(file('LEARNED.md'),'- '+id+'\n');
  assert(!render('--contract').stdout.includes('run /personalize'));
  assert.equal(render('--check').status,1,'any LEARNED edit is drift');
  assert.equal(render().status,0);
  fs.appendFileSync(file('LEARNED.md'),'\n## Learned\nnot an entry\n');
  const warning=render();assert.equal(warning.status,0);assert.match(warning.stderr,/LEARNED.md:\d+: unparsed entry/);
  fs.appendFileSync(file('LEARNED.md'),'<!-- agent-personalizer:begin -->\n');
  assert.equal(render().status,2);
  fs.writeFileSync(file('LEARNED.md'),learned);
  assert.equal(render().status,0);
  const history=fs.readFileSync(path.join(sessions,'typed.jsonl'));
  run(['learn','--forget','--dir',project]);
  assert(!fs.existsSync(file('.agent-personalizer')));
  assert(history.equals(fs.readFileSync(path.join(sessions,'typed.jsonl'))));
  assert(run(['learn','--forget','--dir',project]).includes('No digest to forget.'));
  run(['learn','--dir',project,'--yes']);
  const before=fs.readFileSync(file('LEARNED.md'));
  run(['--uninstall','--dir',project,'--dry']);
  assert(fs.existsSync(file('.agent-personalizer/digest.md')));
  run(['--uninstall','--dir',project]);
  assert(fs.readFileSync(file('LEARNED.md')).equals(before));
  assert(!fs.existsSync(file('.agent-personalizer')));
  assert(history.equals(fs.readFileSync(path.join(sessions,'typed.jsonl'))));
  const override=path.join(temp,'override');
  run(['--dir',override,'--ai','claude,agents','--level','3','--yes']);
  run(['--dir',override,'--ai','claude','--level','1']);
  const cfg=JSON.parse(fs.readFileSync(path.join(override,'.agent-personalizer.json')));
  assert.deepEqual(cfg.targets,['claude','onboarding']);
  assert.equal(cfg.level,1);
  console.log('PASS learning: consent, private filtering, digest data, statuses, every target, drift, command, forget and uninstall');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
