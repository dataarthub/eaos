import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('requirements.json',import.meta.url),'utf8'));
test('mandatory outcomes have shared implementations, automated checks and explicit owners; hook choice is advisory',()=>{
 const seen=new Set();for(const r of catalog.requirements){assert(!seen.has(r.id));seen.add(r.id);assert(r.result&&r.owner&&r.implementation&&r.behaviorTest);if(r.level==='required')assert(r.staticCheck&&r.staticCheck!=='none');}
 assert.equal(catalog.requirements.find(r=>r.id==='hooks.manager').level,'recommended');
});
import {writeFileSync,mkdirSync,symlinkSync,existsSync} from 'node:fs';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {fixture} from './fixtures.mjs';import {install,generate} from './supply.mjs';import {checkProject,verifyProject} from './conformance.mjs';
const source=new URL('../',import.meta.url).pathname;
function configured(work){return fixture((root,project)=>{
 execFileSync('git',['init','-q'],{cwd:root});writeFileSync(join(root,'.gitignore'),'.cache/\n.verification/\nnode_modules\n');if(existsSync(join(process.env.PUBLIC_POLICY_TEST_TOOLS??process.cwd(),'node_modules')))symlinkSync(join(process.env.PUBLIC_POLICY_TEST_TOOLS??process.cwd(),'node_modules'),join(root,'node_modules'));
 const packagePath=join(root,'package.json'),p=JSON.parse(readFileSync(packagePath));
 Object.assign(p.scripts??={}, { 'quality:commit':'node staged.mjs','quality:push':'node scripts/workflow-supply/public/quality.mjs push','quality:ci':'node scripts/workflow-supply/public/quality.mjs ci','workflow:generate':'node scripts/workflow-supply/public/supply.mjs generate','workflow:check':'node scripts/workflow-supply/public/supply.mjs check','test:workflow':'node --test scripts/workflow-supply/public/*.test.mjs','conformance:check':'node scripts/workflow-supply/public/conformance.mjs check','conformance:verify':'node scripts/workflow-supply/public/conformance.mjs verify','test:gate':'node gate.test.mjs'});
 writeFileSync(packagePath,JSON.stringify(p));project.conformance={behaviorCommands:[['bun','run','test:gate']]};for(const name of ['verify','stage','complete'])project.publish.jobs[name].steps.push({run:'node scripts/workflow-supply/public/quality.mjs require-source'});
 writeFileSync(join(root,'scripts/workflow-project/roles.json'),JSON.stringify(project));mkdirSync(join(root,'docs'));writeFileSync(join(root,'docs/workflow-supply.md'),'Shared workflow contract\nProject-specific verification');
 install(root,{source,reviewedRevision:'a'.repeat(40)});return work(root,project,p);
});}
test('project conformance detects disconnected entrypoints even when generated YAML is fresh',()=>configured((root,project,p)=>{
 assert.equal(checkProject(root).configuration,'verified');delete p.scripts['quality:commit'];writeFileSync(join(root,'package.json'),JSON.stringify(p));assert(checkProject(root).failures.some(f=>f.id==='quality.entrypoints'));
}));
test('conformance rejects changed runtime and missing source-evidence wiring after explicit generation',()=>configured((root,project)=>{
 project.source.jobs.verify.strategy.matrix.node=[24];project.publish.jobs.stage.steps=project.publish.jobs.stage.steps.filter(s=>s.run!=='node scripts/workflow-supply/public/quality.mjs require-source');writeFileSync(join(root,'scripts/workflow-project/roles.json'),JSON.stringify(project));generate(root);
 const report=checkProject(root);assert(report.failures.some(f=>f.id==='actions.runtime'));assert(report.failures.some(f=>f.id==='release.source'));
}));
test('behavior verification propagates a required probe failure and never claims remote success',()=>configured(async root=>{
 let calls=0;await assert.rejects(verifyProject(root,{changedPaths:null,run:()=>({status:++calls===2?17:0})}),/probe failed/);assert.equal(calls,2);
 const report=await verifyProject(root,{changedPaths:null,run:()=>({status:0})});assert.equal(report.github,'unverified');assert.equal(report.behavior,'verified-local-fixtures');
}));
test('project conformance detects drift without repairing the generated file',()=>configured(root=>{
 const file=join(root,'.github/workflows/ci.yml');writeFileSync(file,'changed');assert(checkProject(root).failures.some(f=>f.id==='actions.drift'));assert.equal(readFileSync(file,'utf8'),'changed');
}));

test('ordinary guide edits perform structural conformance without running unrelated behavioral suites',()=>configured(async root=>{let calls=0;const report=await verifyProject(root,{changedPaths:['docs/guide.md'],run:()=>{calls++;return {status:0};}});assert.equal(calls,0);assert.equal(report.behavior,'not-required-for-selected-inputs');assert.deepEqual(report.omitted,['bun run test:gate']);}));

test('source artifact readers must have explicit Actions read permission',()=>configured((root,project)=>{delete project.publish.jobs.stage.permissions.actions;writeFileSync(join(root,'scripts/workflow-project/roles.json'),JSON.stringify(project));generate(root);assert(checkProject(root).failures.some(f=>f.id==='release.source'&&/permission/.test(JSON.stringify(f))));}));
