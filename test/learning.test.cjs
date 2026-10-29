'use strict';
// Black-box journeys use invented history in a fake HOME; the real app stores stay closed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'apl-'));
const home = path.join(temp, 'home');
const project = path.join(temp, 'project');
fs.mkdirSync(home); fs.mkdirSync(project);
function run(args, expected = 0, options = {}) {
  const out = spawnSync(process.execPath, [path.join(root, 'bin/agent-personalizer.js'), ...args], { cwd: root, env: {...process.env, HOME: home, USERPROFILE: home}, encoding:'utf8', ...options });
  assert.equal(out.status, expected, out.stdout + out.stderr);
  return out.stdout + out.stderr;
}
const file = rel => path.join(project, rel);
const text = rel => fs.readFileSync(file(rel), 'utf8');
function writeHome(rel, body) {
  const target = path.join(home, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return target;
}
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
  run(['--all-projects','--dir',project,'--ai','claude','--level','1','--yes'],2);
  run(['learn','--dir',project,'--all-projects','--forget'],2);
  run(['--dir',project,'--ai','claude,agents,gemini,chatgpt,prompt','--level','3','--yes']);
  assert(fs.existsSync(file('LEARNED.md')));
  assert(fs.existsSync(file('.claude/commands/personalize.md')));
  assert(!fs.existsSync(file('.agent-personalizer/digest.md')));
  const unchanged = text('LEARNED.md');
  run(['--dir',project]);
  assert.equal(text('LEARNED.md'), unchanged);
  const projectPath=fs.realpathSync(project);
  const otherProject=path.join(temp,'other-project');fs.mkdirSync(otherProject);
  const projectSlug=projectPath.replace(/[:\\/]/g,'-');
  const otherSlug=otherProject.replace(/[:\\/]/g,'-');
  const sessions=path.join(home,'.claude/projects',projectSlug);fs.mkdirSync(sessions,{recursive:true});
  fs.writeFileSync(path.join(sessions,'typed.jsonl'),[
    {type:'user',cwd:projectPath,message:{content:'VISIBLE_TYPED_EXAMPLE Keep it short.'}},
    {type:'user',cwd:projectPath,message:{content:'SecretFixturePerson details stay private.'}},
    {type:'user',cwd:projectPath,message:{content:'<environment_context>CONTEXT_EXCLUDED</environment_context>'}},
    {type:'user',cwd:projectPath,message:{content:'<!-- reply --> Keep the quoted reply.'}},
    {type:'user',cwd:projectPath,message:{content:'A reserved <!-- agent-personalizer:begin --> marker.'}},
    {type:'assistant',message:{content:'ASSISTANT_EXCLUDED'}}
  ].map(JSON.stringify).join('\n')+'\n');
  writeHome(path.join('.claude','projects',otherSlug,'other.jsonl'),JSON.stringify({type:'user',cwd:otherProject,message:{content:'CLAUDE_OTHER_PROJECT_EXCLUDED'}})+'\n');
  const codex=(cwd,message)=>JSON.stringify({type:'session_meta',payload:{id:path.basename(cwd),source:'cli',cwd}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:message}]}})+'\n';
  writeHome(path.join('.codex','sessions','2026','10','01','rollout-target.jsonl'),codex(projectPath,'CODEX_TARGET_INCLUDED'));
  writeHome(path.join('.codex','sessions','2026','10','01','rollout-other.jsonl'),codex(otherProject,'CODEX_OTHER_PROJECT_EXCLUDED'));
  const geminiHash=crypto.createHash('sha256').update(projectPath).digest('hex');
  const otherGeminiHash=crypto.createHash('sha256').update(otherProject).digest('hex');
  const gemini=message=>JSON.stringify({sessionId:message,projectHash:'fixture',kind:'main'})+'\n'+JSON.stringify({$set:{messages:[{id:message,type:'user',content:[{text:message}]}]}})+'\n';
  writeHome(path.join('.gemini','tmp',geminiHash,'chats','session-target.jsonl'),gemini('GEMINI_TARGET_INCLUDED'));
  writeHome(path.join('.gemini','tmp',otherGeminiHash,'chats','session-other.jsonl'),gemini('GEMINI_OTHER_PROJECT_EXCLUDED'));
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
  assert(out.includes('typed.jsonl') && out.includes('.claude'), out);
  assert(!out.includes('VISIBLE_TYPED_EXAMPLE'));
  assert(!out.includes('SecretFixturePerson'));
  assert.equal(text('.agent-personalizer/.gitignore'),'*\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file('.agent-personalizer/digest.md')).mode & 0o777,0o600);
  const digest=text('.agent-personalizer/digest.md');
  assert(digest.includes('VISIBLE_TYPED_EXAMPLE'));
  assert(digest.includes('<!-- reply -->'));
  assert(!digest.includes('ASSISTANT_EXCLUDED'));
  assert(digest.includes('CODEX_TARGET_INCLUDED'));
  assert(digest.includes('GEMINI_TARGET_INCLUDED'));
  assert(!digest.includes('CLAUDE_OTHER_PROJECT_EXCLUDED'));
  assert(!digest.includes('CODEX_OTHER_PROJECT_EXCLUDED'));
  assert(!digest.includes('GEMINI_OTHER_PROJECT_EXCLUDED'));
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
  const allProjectsOut=run(['learn','--dir',project,'--all-projects','--yes']);
  assert(allProjectsOut.includes('from all projects'));
  assert(!allProjectsOut.includes('GEMINI_OTHER_PROJECT_EXCLUDED'),'session text is not printed to the terminal');
  const allProjectsDigest=text('.agent-personalizer/digest.md');
  assert(allProjectsDigest.includes('CLAUDE_OTHER_PROJECT_EXCLUDED'));
  assert(allProjectsDigest.includes('CODEX_OTHER_PROJECT_EXCLUDED'));
  assert(allProjectsDigest.includes('GEMINI_OTHER_PROJECT_EXCLUDED'));
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
