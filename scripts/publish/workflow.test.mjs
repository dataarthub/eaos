import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=name=>JSON.parse(execFileSync('bun',['-e','console.log(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))'],{input:readFileSync(new URL('../../.github/workflows/'+name,import.meta.url)),encoding:'utf8'}));
test('canonical writer separates unprivileged verification, staged writer and original-run completion',()=>{
 const w=read('publish.yml'),verify=JSON.stringify(w.jobs.verify),stage=JSON.stringify(w.jobs.stage),complete=JSON.stringify(w.jobs.complete);
 assert.deepEqual(w.on.release.types,['published']);assert(!w.on.push&&!w.on.pull_request);assert.equal(w.concurrency.group,'eaos-npm-release');assert.equal(w.concurrency['cancel-in-progress'],false);
 assert.doesNotMatch(verify,/id-token.*write|NPM_TOKEN|NODE_AUTH_TOKEN/);
 for(const gate of ['bun run secrets:check -- --history','scripts/publish/source-candidate.mjs','quality.mjs require-source'])assert(verify.includes(gate),gate);
 const upload=w.jobs.verify.steps.find(s=>s.id==='upload');assert.equal(upload.with['include-hidden-files'],true);assert.equal(upload.with['retention-days'],14);
 assert.equal(w.jobs.verify.steps.find(s=>s.run==='node scripts/publish/source-candidate.mjs').env.GITHUB_TOKEN,'${{ github.token }}','Source archive reuse requires authenticated artifact retrieval');
 assert.doesNotMatch(verify,/bun run check|prepare --final|bun run test:consumer|bunx playwright/,'Publication reuses the tested Source archive');
 assert.deepEqual(upload.with.path.trim().split('\n'),['.verification/handoff/release.json','.verification/handoff/*.tgz','.verification/handoff/*.notes.md']);
 assert.equal(w.jobs.stage.needs,'verify');assert.equal(w.jobs.stage.permissions['id-token'],'write');
 for(const key of ['stage','complete'])assert.equal(w.jobs[key].steps.find(s=>s.uses?.startsWith('actions/download-artifact@')).with['digest-mismatch'],'error');
 assert.equal(w.jobs.complete.steps.find(s=>s.uses?.startsWith('actions/download-artifact@')).with['run-id'],'${{ needs.resolve.outputs.run }}');assert.doesNotMatch(stage+complete,/bun run|npm publish|npm stage publish/);assert.match(JSON.stringify(w),/npm@11.21.0/);
});
test('approval never occupies an observer runner; explicit completion retains the original writer',()=>{
 assert.equal(existsSync(new URL('../../.github/workflows/complete-approved.yml',import.meta.url)),false);
 const w=read('publish.yml');assert(w.on.workflow_dispatch.inputs.staged_run);assert.equal(w.jobs.complete.needs,'resolve');
});
test('source quality owns documentation once; generated docs no longer call the full source gate again',()=>{
 assert.equal(existsSync(new URL('../../.github/workflows/docs-generated.yml',import.meta.url)),false);const w=read('ci.yml');assert.deepEqual(Object.keys(w.on),['push','pull_request','merge_group','workflow_dispatch']);assert.equal(w.jobs.verify.uses,'./.github/workflows/package-quality.yml');
 const contract=JSON.parse(readFileSync(new URL('../workflow-project/roles.json',import.meta.url)));assert.equal(contract.quality.tasks.find(t=>t.id==='source').command.join(' '),'bun run check:selected');assert.deepEqual(contract.quality.tasks.find(t=>t.id==='documentation').scopes,['docs']);
});
test('catalogued pre-stage recovery verifies clean original source without giving the verifier OIDC',()=>{
 const w=read('publish.yml'),resolve=w.jobs.resolve,writer=w.jobs.complete;
 assert.doesNotMatch(JSON.stringify(resolve.permissions),/write/);
 assert(resolve.steps.some(s=>s.id==='recovery'&&s.run==='node scripts/publish/recovery.mjs resolve'));
 const checkout=resolve.steps.find(s=>s.uses?.startsWith('actions/checkout@')&&s.with.path==='.verification/source');
 assert.equal(checkout.with.ref,'${{ steps.recovery.outputs.commit }}');assert.equal(checkout.with['persist-credentials'],false);
 assert(resolve.steps.some(s=>s.run==='node scripts/publish/recovery.mjs verify'&&s.env.GITHUB_TOKEN==='${{ github.token }}'));
 assert(resolve.steps.some(s=>s.id==='upload'&&s.with['retention-days']===14));
 assert.equal(writer.env.PUBLISH_SOURCE_SHA,'${{ needs.resolve.outputs.commit }}');
 assert.match(JSON.stringify(writer.steps),/run.mjs recover-stage/);
 assert.match(w['run-name'],/Recover npm pre-stage candidate/);

});

test('selected docs and publication scopes build declarations before API freshness checks',()=>{
 const tasks=JSON.parse(readFileSync(new URL('../workflow-project/roles.json',import.meta.url))).quality.tasks;
 for(const scope of ['docs','publication']){
  const selected=tasks.filter(t=>t.scopes.includes(scope));
  const build=selected.findIndex(t=>t.command.join(' ')==='bun run build');
  const docs=selected.findIndex(t=>t.command.join(' ')==='bun run docs:check');
  assert(build>=0&&docs>build,'A fresh runner needs declarations before '+scope+' API generation');
  assert.deepEqual(selected[build].outputs,['packages/core/dist','packages/server/dist','packages/react/dist','packages/cli/dist','plugins/dist']);
 }
});
