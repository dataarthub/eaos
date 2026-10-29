import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,cpSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,generate,check} from './supply.mjs';
import {fixture} from './fixtures.mjs';
const source=new URL('../',import.meta.url).pathname;

const parse=file=>{const p=spawnSync('bun',['-e','console.log(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))'],{input:readFileSync(file),encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);};
test('source triggers, reusable quality, npm phases and least privilege are shared',()=>fixture(root=>{
 install(root,{source,reviewedRevision:'a'.repeat(40)});
 const ci=parse(join(root,'.github/workflows/ci.yml')),quality=parse(join(root,'.github/workflows/package-quality.yml')),publish=parse(join(root,'.github/workflows/publish.yml'));
 assert.equal(ci.name,'Source quality');assert.deepEqual(Object.keys(ci.on),['push','pull_request','merge_group','workflow_dispatch']);assert.deepEqual(ci.permissions,{contents:'read',actions:'read'});
 assert.equal(ci.jobs.verify.uses,'./.github/workflows/package-quality.yml');assert.equal(quality.name,'Shared package quality');assert.deepEqual(Object.keys(quality.on),['workflow_call']);
 assert.equal(publish.name,'Publish npm packages');assert.deepEqual(publish.on.release.types,['published']);assert.ok(publish.on.workflow_dispatch.inputs.staged_run.required);
 assert.match(publish.jobs.verify.if,/example\/public/);assert.match(publish.jobs.verify.if,/prerelease == false/);assert.match(publish.jobs.verify.if,/fixture-v/);
 assert.equal(publish.concurrency['cancel-in-progress'],false);
 const steps=quality.jobs.verify.steps;assert.ok(steps.some(s=>s.name==='Shared: Verify generated workflow supply'));
 assert.match(steps.find(s=>s.uses==='actions/cache/save@v4').if,/success\(\).*event_name == 'push'.*refs\/heads\/main/);
 assert.ok(steps.every(s=>/^(Shared|Project):/.test(s.name)));
}));
test('freshness is deterministic and detects edits and missing outputs without repairing',()=>fixture(root=>{
 install(root,{source,reviewedRevision:'a'.repeat(40)});assert.deepEqual(check(root),[]);
 const path=join(root,'.github/workflows/ci.yml'),bytes=readFileSync(path);generate(root);assert.deepEqual(readFileSync(path),bytes);
 writeFileSync(path,'drift');assert.ok(check(root).includes('.github/workflows/ci.yml'));assert.equal(readFileSync(path,'utf8'),'drift');
 generate(root);rmSync(path);assert.ok(check(root).includes('.github/workflows/ci.yml'));assert.equal(existsSync(path),false);
}));
test('adoption is explicit and a bundle or project symlink cannot bypass containment',()=>fixture(root=>{
 mkdirSync(join(root,'.github/workflows'));writeFileSync(join(root,'.github/workflows/ci.yml'),'old');
 assert.throws(()=>install(root,{source,reviewedRevision:'a'.repeat(40)}),/adopt/i);assert.equal(readFileSync(join(root,'.github/workflows/ci.yml'),'utf8'),'old');
 install(root,{source,reviewedRevision:'a'.repeat(40),adoptExisting:true});writeFileSync(join(root,'scripts/workflow-supply/public/render.mjs'),'tampered');assert.throws(()=>check(root),/digest/i);
}));
test('project fragments cannot authorize direct publish, PR writers or unverifiable archives',()=>fixture((root,project)=>{
 const file=join(root,'scripts/workflow-project/roles.json');
 for(const mutate of [p=>p.publish.jobs.stage.steps.push({run:'npm publish package.tgz'}),p=>p.publish.jobs.verify.permissions={'id-token':'write'},p=>delete p.publish.jobs.complete.steps[0].with['digest-mismatch']]){
  const p=structuredClone(project);mutate(p);writeFileSync(file,JSON.stringify(p));assert.throws(()=>install(root,{source,reviewedRevision:'a'.repeat(40)}));
 }
}));

test('external supplier code cannot generate or certify a different pinned bundle',()=>fixture(root=>{
 install(root,{source,reviewedRevision:'a'.repeat(40)});
 const foreign=realpathSync(mkdtempSync(join(tmpdir(),'foreign-supply-')));
 try{
  cpSync(source,foreign,{recursive:true});
  const renderer=join(foreign,'public/render.mjs');writeFileSync(renderer,readFileSync(renderer,'utf8').replace("name:'Source quality'","name:'Different source quality'"));
  const manifest=join(root,'.github/workflow-supply.json'),workflow=join(root,'.github/workflows/ci.yml'),before=[readFileSync(manifest),readFileSync(workflow)];
  for(const command of ['generate','check']){const result=spawnSync(process.execPath,[join(foreign,'public/supply.mjs'),command,'--project-root',root],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/pinned|selected reviewed/i);assert.deepEqual([readFileSync(manifest),readFileSync(workflow)],before);}
  assert.throws(()=>install(root,{source:foreign,reviewedRevision:'b'.repeat(40)}),/pinned|selected reviewed/i);
 }finally{rmSync(foreign,{recursive:true,force:true});}
}));

test('required source runtimes cannot be excluded or allowed to fail',()=>fixture((root,project)=>{
 const file=join(root,'scripts/workflow-project/roles.json');
 for(const mutate of [p=>p.source.jobs.verify.strategy.matrix.exclude=[{node:26}],p=>p.source.jobs.verify.strategy.matrix.include=[{node:28}],p=>p.source.jobs.verify['continue-on-error']=true,p=>p.source.jobs.verify.steps.find(s=>s.run)['continue-on-error']=true]){
  const value=structuredClone(project);mutate(value);writeFileSync(file,JSON.stringify(value));assert.throws(()=>install(root,{source,reviewedRevision:'a'.repeat(40)}),/runtime|failure/i);
 }
}));

import {createHash as policyHash} from 'node:crypto';
test('explicit upgrade accepts the intact previous inventory but ordinary checks reject missing policy contracts',()=>fixture(root=>{
 install(root,{source,reviewedRevision:'a'.repeat(40)});const file=join(root,'.github/workflow-supply.json'),m=JSON.parse(readFileSync(file));m.files=Object.fromEntries(Object.entries(m.files).slice(0,16));m.bundleSha256=policyHash('sha256').update(JSON.stringify(m.files)).digest('hex');writeFileSync(file,JSON.stringify(m));assert.throws(()=>check(root));install(root,{source,reviewedRevision:'b'.repeat(40)});assert.deepEqual(check(root),[]);
}));
test('manual conformance mode covers Node 24/26 without bypassing normal PR gates or issuing authoritative evidence',()=>fixture(root=>{install(root,{source,reviewedRevision:'a'.repeat(40)});const ci=parse(join(root,'.github/workflows/ci.yml'));assert.deepEqual(ci.on.workflow_dispatch.inputs.verification_mode.options,['full','conformance','negative']);assert.equal(ci.on.workflow_dispatch.inputs.verification_mode.default,'full');assert.match(ci.concurrency.group,/policy-diagnostics-/);assert.match(ci.concurrency.group,/inputs.verification_mode/);assert.match(ci.jobs.verify.if,/github.event_name != 'workflow_dispatch'/);const job=ci.jobs.conformance;assert.deepEqual(job.strategy.matrix.node,[24,26]);assert.match(job.if,/github.event_name == 'workflow_dispatch'/);assert(!JSON.stringify(job).includes('quality.mjs record'));assert(!JSON.stringify(job).includes('playwright install'));assert(!JSON.stringify(job).includes('cache/save'));assert(job.steps.some(s=>s.id==='required-policy-gate'));assert(job.steps.some(s=>s.id==='downstream-sentinel'&&!s.if));}));

test('catalogued pre-stage recovery is main-only and exclusive with approved completion',()=>fixture((root,project)=>{
 project.publish.recovery={candidates:['core-0.2.1']};
 writeFileSync(join(root,'scripts/workflow-project/roles.json'),JSON.stringify(project));
 install(root,{source,reviewedRevision:'a'.repeat(40)});
 const w=parse(join(root,'.github/workflows/publish.yml'));
 assert.equal(w.on.workflow_dispatch.inputs.staged_run.required,false);
 assert.deepEqual(w.on.workflow_dispatch.inputs.recover_release.options,['','core-0.2.1']);
 assert.match(w.jobs.verify.if,/refs\/heads\/main.*inputs.recover_release != ''/);
 assert.match(w.jobs.verify.if,/inputs.staged_run == ''/);
 assert.match(w.jobs.resolve.if,/inputs.recover_release == ''/);
 assert.match(w.jobs.resolve.if,/inputs.staged_run != ''/);
 for(const candidates of [[],['arbitrary ref'],['x','x']]){
  project.publish.recovery={candidates};writeFileSync(join(root,'scripts/workflow-project/roles.json'),JSON.stringify(project));
  assert.throws(()=>install(root,{source,reviewedRevision:'a'.repeat(40)}),/recovery candidates/);
 }
}));


test('Ready PR and merge queue wiring preserves no-draft gates and main-only cache writers',()=>fixture(root=>{
 install(root,{source,reviewedRevision:'a'.repeat(40)});
 const ci=parse(join(root,'.github/workflows/ci.yml')),quality=parse(join(root,'.github/workflows/package-quality.yml'));
 assert.deepEqual(ci.on.pull_request.types,['opened','synchronize','reopened','ready_for_review']);
 assert.deepEqual(ci.on.merge_group.types,['checks_requested']);assert.match(ci.jobs.verify.if,/pull_request.draft == false/);
 for(const step of quality.jobs.verify.steps.filter(s=>s.run?.endsWith('quality.mjs record')||s.uses?.startsWith('actions/upload-artifact@'))){assert.match(step.if,/pull_request.draft == false/);assert.match(step.if,/head.repo.full_name == github.repository/);assert.match(step.if,/base.ref == 'main'/);}
 for(const step of quality.jobs.verify.steps.filter(s=>s.uses?.startsWith('actions/cache/save@'))){assert.match(step.if,/event_name == 'push'/);assert(!step.if.includes('pull_request'));}
 assert(!existsSync(join(root,'.github/workflows/complete-approved.yml')),'Default supply must not create an approval observer');
}));


test('projects cannot collide with the managed per-runtime source receipt upload',()=>fixture((root,project)=>{
 project.source.jobs.verify.steps.push({uses:'actions/upload-artifact@v7',with:{name:'source-evidence-node${{ matrix.node }}-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',path:'proof.json'}});
 writeFileSync(join(root,'scripts/workflow-project/roles.json'),JSON.stringify(project));
 assert.throws(()=>install(root,{source,reviewedRevision:'a'.repeat(40)}),/managed source evidence/);
}));
