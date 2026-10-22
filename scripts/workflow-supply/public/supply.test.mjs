import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
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
 assert.equal(ci.name,'Source quality');assert.deepEqual(Object.keys(ci.on),['push','pull_request','workflow_dispatch']);assert.deepEqual(ci.permissions,{contents:'read',actions:'read'});
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
