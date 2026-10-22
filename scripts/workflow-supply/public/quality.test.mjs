import './fixtures.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {realpathSync,existsSync,mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {runTask,scopeFor,clearHookGitEnvironment} from './quality.mjs';
async function fixture(work){const root=mkdtempSync(join(tmpdir(),'public-quality-'));try{execFileSync('git',['init','-q'],{cwd:root});writeFileSync(join(root,'.gitignore'),'.cache/\ndist/\n');writeFileSync(join(root,'source.js'),'one');execFileSync('git',['add','.'],{cwd:root});return await work(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('docs omission needs compatible trusted baseline and packaging README stays broad',()=>{assert.equal(scopeFor(['docs/guide.md'],{trusted:true}),'docs');for(const files of [['docs/guide.md'],['README.md'],['packages/core/README.md'],['bun.lock'],['docs/script.ts'],[]])assert.equal(scopeFor(files,{trusted:false}),'full');assert.equal(scopeFor(['packages/core/README.md'],{trusted:true}),'full');});
test('task result reuse requires identical source, command, environment and output bytes',async()=>fixture(async root=>{
 const task={id:'build',command:['node','build.mjs'],outputs:['dist']};let calls=0;const run=()=>{calls++;mkdirSync(join(root,'dist'),{recursive:true});writeFileSync(join(root,'dist/index.js'),'compiled');};
 const options={identity:{node:'24',runner:'one'},run};assert.equal((await runTask(root,task,options)).outcome,'executed');assert.equal((await runTask(root,task,options)).outcome,'reused');assert.equal(calls,1);
 writeFileSync(join(root,'dist/index.js'),'tampered');assert.equal((await runTask(root,task,options)).outcome,'executed');
 assert.equal((await runTask(root,task,{...options,identity:{node:'26',runner:'one'}})).outcome,'executed');
 writeFileSync(join(root,'source.js'),'two');assert.equal((await runTask(root,task,options)).outcome,'executed');assert.equal(calls,4);
}));
test('a failed task clears a previous success and missing output never records success',async()=>fixture(async root=>{
 const task={id:'test',command:['node','test.mjs']};await runTask(root,task,{identity:{},run:()=>{}});
 await assert.rejects(runTask(root,{...task,command:['node','changed.mjs']},{identity:{},run:()=>{throw Error('expected failure');}}),/expected failure/);
 let calls=0;assert.equal((await runTask(root,task,{identity:{},run:()=>{calls++;}})).outcome,'executed');assert.equal(calls,1);
 await assert.rejects(runTask(root,{id:'missing',command:['node','build'],outputs:['absent']},{identity:{},run:()=>{}}),/outputs missing/);
}));
test('executable source and output mode changes invalidate a prior task pass',async()=>fixture(async root=>{
 const {chmodSync}=await import('node:fs');const source=join(root,'source.js');chmodSync(source,0o755);let calls=0;
 const task={id:'mode',command:['node','mode.mjs'],outputs:['dist']};const options={identity:{},run:()=>{calls++;mkdirSync(join(root,'dist'),{recursive:true});writeFileSync(join(root,'dist/cli'),'cli');chmodSync(join(root,'dist/cli'),0o755);}};
 await runTask(root,task,options);chmodSync(source,0o644);assert.equal((await runTask(root,task,options)).outcome,'executed');chmodSync(join(root,'dist/cli'),0o644);assert.equal((await runTask(root,task,options)).outcome,'executed');assert.equal(calls,3);
}));
test('concurrent invocations cannot overwrite one task success while another fails',async()=>fixture(async root=>{
 let finish;const task={id:'concurrent',command:['node','test']};const first=runTask(root,task,{identity:{},run:()=>new Promise(resolve=>{finish=resolve;})});
 await assert.rejects(runTask(root,task,{identity:{},run:()=>{throw Error('must not execute');}}),/already running/);finish();await first;
}));
test('local successful snapshots narrow later guide edits while CI cannot treat them as official evidence',async()=>fixture(async root=>{
 const {recordLocal,select,executionIdentity}=await import('./quality.mjs');const {install}=await import('./supply.mjs');const {fixture:projectFixture}=await import('./fixtures.mjs');
 await projectFixture(async projectRoot=>{
  execFileSync('git',['init','-q'],{cwd:projectRoot});writeFileSync(join(projectRoot,'.gitignore'),'.cache/\n');install(projectRoot,{source:new URL('../',import.meta.url).pathname,reviewedRevision:'a'.repeat(40)});
  execFileSync('git',['add','.'],{cwd:projectRoot});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','fixture'],{cwd:projectRoot});
  const identity=executionIdentity(projectRoot,{});recordLocal(projectRoot,{identity});mkdirSync(join(projectRoot,'docs'),{recursive:true});writeFileSync(join(projectRoot,'docs/guide.md'),'new guide');
  const report=await select(projectRoot,{env:{},api:{request:async()=>{throw Error('no remote evidence');}}});assert.equal(report.scope,'docs');assert.match(report.reason,/local successful/);assert.equal(report.provenance,'local');assert.deepEqual(report.changes,[{file:'docs/guide.md',status:'A'}]);writeFileSync(join(projectRoot,'source.ts'),'verified uncommitted');recordLocal(projectRoot,{identity});writeFileSync(join(projectRoot,'source.ts'),'reverted bytes');const reverted=await select(projectRoot,{env:{}});assert(reverted.changes.some(c=>c.file==='source.ts'&&c.status==='M'));assert.equal(reverted.scope,'full');const official=await select(projectRoot,{env:{GITHUB_ACTIONS:'true'},api:{request:async()=>{throw Error('no remote evidence');}}});assert.equal(official.scope,'full');assert.equal(official.baseline,null);
 });
}));

test('publisher-only changes select publication probes without unrelated package/browser work; unknown changes remain broad',()=>{assert.equal(scopeFor(['scripts/publish/run.mjs','docs/releasing.md'],{trusted:true}),'publication');assert.equal(scopeFor(['scripts/release-publish.mjs'],{trusted:true}),'publication');for(const f of ['scripts/release.mjs','scripts/release-bundle.mjs','packages/react/src/form.tsx','bun.lock'])assert.equal(scopeFor([f],{trusted:true}),'full');});
test('project execution switches invalidate source evidence identity without exposing credential values',async()=>fixture(async root=>{
 const {executionIdentity}=await import('./quality.mjs');mkdirSync(join(root,'.github'));writeFileSync(join(root,'.github/workflow-supply.json'),JSON.stringify({bundleSha256:'fixture'}));
 const one=executionIdentity(root,{EAOS_TEST_MODE:'one'}),two=executionIdentity(root,{EAOS_TEST_MODE:'two'});assert.notEqual(one.environment,two.environment);assert(!JSON.stringify(two).includes('two'));
}));
test('source-suite release reuse needs official evidence and cannot be enabled by local or PR environment flags',async()=>{
 const {releaseProof}=await import('./quality.mjs');let calls=0;const proof={run:{head_sha:'a'.repeat(40)},receipt:{status:'passed'}};
 for(const env of [{},{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'pull_request'},{GITHUB_ACTIONS:'false',GITHUB_EVENT_NAME:'release',REUSE_SOURCE:'true'}])assert.equal(await releaseProof('/unused',{env,verify:async()=>{calls++;return proof;}}),null);
 assert.equal(calls,0);assert.deepEqual(await releaseProof('/unused',{env:{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'release'},verify:async()=>proof}),proof);
 await assert.rejects(releaseProof('/unused',{env:{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'release'},verify:async()=>{throw Error('required job failed');}}),/required job failed/);
});
test('official receipt recording rejects dirty committed inputs and mislabeled matrix runtimes',async()=>{
 const {fixture:projectFixture}=await import('./fixtures.mjs');const {install}=await import('./supply.mjs');const {executionIdentity}=await import('./quality.mjs');const {spawnSync}=await import('node:child_process');
 await projectFixture(async (root,project)=>{
  const adapterFile=join(root,'.github/workflow-adapter.json'),adapter=JSON.parse(readFileSync(adapterFile));adapter.runtime.bunVersion=execFileSync('bun',['--version'],{encoding:'utf8'}).trim();writeFileSync(adapterFile,JSON.stringify(adapter));
  execFileSync('git',['init','-q'],{cwd:root});writeFileSync(join(root,'.gitignore'),'.cache/\n');install(root,{source:new URL('../',import.meta.url).pathname,reviewedRevision:'a'.repeat(40)});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','fixture'],{cwd:root});
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),env={...process.env,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:adapter.repository,GITHUB_WORKFLOW_REF:adapter.repository+'/.github/workflows/ci.yml@refs/heads/main',GITHUB_SHA:sha,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',PUBLIC_SOURCE_NODE:String(process.versions.node.split('.')[0]),ImageOS:'fixture',ImageVersion:'fixture-1'};
  const identity=executionIdentity(root,env);mkdirSync(join(root,'.cache/public-quality'),{recursive:true});writeFileSync(join(root,'.cache/public-quality/plan.json'),JSON.stringify({sha,identity,scope:'full',baseline:null}));
  const invoke=environment=>spawnSync(process.execPath,['scripts/workflow-supply/public/quality.mjs','record'],{cwd:root,env:environment,encoding:'utf8'});
  assert.equal(invoke(env).status,0);assert(readFileSync(join(root,'.cache/public-quality/source.json'),'utf8').includes('passed'));
  assert.equal(invoke({...env,PUBLIC_SOURCE_NODE:'999'}).status,1);assert.throws(()=>readFileSync(join(root,'.cache/public-quality/source.json')));
  writeFileSync(join(root,'package.json'),'{}');assert.equal(invoke(env).status,1);
 });
});
test('operational call IDs do not invalidate deterministic tasks; real execution switches do',async()=>fixture(async root=>{
 const original=process.env.CODEX_TOOL_CALL_ID,custom=process.env.EAOS_CACHE_TEST_MODE;try{const task={id:'environment',command:['node','check']};let calls=0;const options={identity:{},run:()=>{calls++;}};
 process.env.CODEX_TOOL_CALL_ID='one';await runTask(root,task,options);process.env.CODEX_TOOL_CALL_ID='two';assert.equal((await runTask(root,task,options)).outcome,'reused');process.env.EAOS_CACHE_TEST_MODE='changed';assert.equal((await runTask(root,task,options)).outcome,'executed');assert.equal(calls,2);
 }finally{if(original===undefined)delete process.env.CODEX_TOOL_CALL_ID;else process.env.CODEX_TOOL_CALL_ID=original;if(custom===undefined)delete process.env.EAOS_CACHE_TEST_MODE;else process.env.EAOS_CACHE_TEST_MODE=custom;}
}));
test('selected execution binds current fingerprints and runtime and rejects tampered package coverage',async()=>{
 const {fixture:projectFixture}=await import('./fixtures.mjs');const {install}=await import('./supply.mjs');const {recordLocal,select,readSelectedPlan}=await import('./quality.mjs');
 await projectFixture(async(root,project)=>{
  execFileSync('git',['init','-q'],{cwd:root});writeFileSync(join(root,'.gitignore'),'.cache/\n');
  const pkg=JSON.parse(readFileSync(join(root,'package.json')));pkg.workspaces=['packages/a'];writeFileSync(join(root,'package.json'),JSON.stringify(pkg));mkdirSync(join(root,'packages/a/src'),{recursive:true});writeFileSync(join(root,'packages/a/package.json'),JSON.stringify({name:'@fixture/a',scripts:{test:'node test.mjs'}}));writeFileSync(join(root,'packages/a/src/index.ts'),'before');
  project.quality={impact:{packages:['packages/a']}};writeFileSync(join(root,'scripts/workflow-project/roles.json'),JSON.stringify(project));install(root,{source:new URL('../',import.meta.url).pathname,reviewedRevision:'a'.repeat(40)});
  execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','fixture'],{cwd:root});
  recordLocal(root);writeFileSync(join(root,'packages/a/src/index.ts'),'after');const plan=await select(root,{api:{request:async()=>{throw Error('offline');}}});const file=join(root,'.cache/public-quality/plan.json');writeFileSync(file,JSON.stringify(plan));assert.deepEqual(readSelectedPlan(root).packageImpact.test,['packages/a']);
  writeFileSync(file,JSON.stringify({...plan,packageImpact:{...plan.packageImpact,test:[]}}));assert.throws(()=>readSelectedPlan(root),/Package selection changed/);
  writeFileSync(file,JSON.stringify({...plan,identity:{...plan.identity,node:'fake'}}));assert.throws(()=>readSelectedPlan(root),/runtime changed/);
  writeFileSync(file,JSON.stringify(plan));writeFileSync(join(root,'packages/a/src/index.ts'),'edited during selection');assert.throws(()=>readSelectedPlan(root),/Source changed/);
 });
});

test('hook Git context cannot redirect a disposable repository into the caller repository',async()=>fixture(async root=>{
 const foreign=join(root,'foreign'),intended=join(root,'intended');mkdirSync(foreign);mkdirSync(intended);const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));execFileSync('git',['init','-q'],{cwd:foreign,env:clean});
 const env=clearHookGitEnvironment({...clean,GIT_DIR:join(foreign,'.git'),GIT_WORK_TREE:foreign,GIT_INDEX_FILE:join(foreign,'.git/index'),CHECK_MODE:'preserved'});assert.equal(env.CHECK_MODE,'preserved');execFileSync('git',['init','-q'],{cwd:intended,env});assert(existsSync(join(intended,'.git')),'Fixture must create its own Git directory');assert.equal(execFileSync('git',['rev-parse','--show-toplevel'],{cwd:intended,env,encoding:'utf8'}).trim(),realpathSync(intended));
}));
