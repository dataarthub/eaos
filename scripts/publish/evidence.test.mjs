import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStagingRun,githubRequest } from './evidence.mjs';
const sha = 'a'.repeat(40);
function fixture(change = () => {}) {
  const data = {
    workflow: { id: 7 },
    release: {id:17,tag_name:'eaos-core-v0.2.0',draft:false,prerelease:false},
    ref: {object:{type:'tag',sha:'d'.repeat(40)}},
    tag: {object:{type:'commit',sha}},
    compare: {status:'ahead'},
    run: { id: 123, created_at:'2026-10-21T00:00:00Z', workflow_id: 7, run_attempt: 1, path: '.github/workflows/publish.yml', event: 'release', status: 'completed', conclusion: 'success', head_branch: 'eaos-core-v0.2.0', head_sha: sha, head_repository: { full_name: 'dataarthub/eaos' } },
    jobs: { total_count: 2, jobs: [{ name: 'verify', status: 'completed', conclusion: 'success' }, { name: 'stage', status: 'completed', conclusion: 'success' }] },
    artifacts: { total_count: 1, artifacts: [{ id: 456, name: 'verified-npm-release-123-1', expired: false, expires_at: '2099-01-01T00:00:00Z', digest: 'sha256:' + 'b'.repeat(64), workflow_run: { id: 123, created_at:'2026-10-21T00:00:00Z', head_sha: sha } }] },
  };
  change(data);
  return async path => path.startsWith('/releases/tags/') ? data.release : path.startsWith('/git/ref/tags/') ? data.ref : path.startsWith('/git/tags/') ? data.tag : path.startsWith('/compare/') ? data.compare : path.endsWith('/publish.yml') ? data.workflow : path.includes('/jobs?') ? data.jobs : path.includes('/artifacts?') ? data.artifacts : data.run;
}
test('resolves exact successful source, attempt and immutable artifact from GitHub rather than caller labels', async () => {
  const evidence = await resolveStagingRun('123', { request: fixture() });
  assert.equal(evidence.commit, sha); assert.equal(evidence.artifactId, 456); assert.equal(evidence.attempt, 1); assert.deepEqual(evidence.release,{id:17,tag:'eaos-core-v0.2.0'});
});
test('rejects failed/newer attempts, wrong workflow/repository/event/branch, skipped staging and expired or ambiguous artifacts', async () => {
  for (const change of [
    d => { d.run.conclusion = 'failure'; }, d => { d.run.run_attempt = 2; }, d => { d.run.workflow_id = 9; },
    d => { d.run.head_repository.full_name = 'fork/repo'; }, d => { d.run.event = 'pull_request'; },
    d => { d.run.head_branch = 'feature'; }, d => { d.run.event='workflow_dispatch'; },
    d => { d.release.draft=true; }, d => { d.release.prerelease=true; }, d => { d.tag.object.sha='e'.repeat(40); }, d => { d.compare.status='diverged'; }, d => { d.jobs.jobs[1].conclusion = 'skipped'; },
    d => { d.artifacts.artifacts[0].expired = true; }, d => { d.artifacts.artifacts[0].workflow_run.head_sha = 'c'.repeat(40); },
    d => { d.artifacts.artifacts.push({ ...d.artifacts.artifacts[0], id: 457 }); },
  ]) await assert.rejects(resolveStagingRun('123', { request: fixture(change) }));
  await assert.rejects(resolveStagingRun('../other', { request: fixture() }));
});
test('accepted HTTP 204 dispatch does not parse an empty response body',async()=>{
 const original=globalThis.fetch,token=process.env.GITHUB_TOKEN
 process.env.GITHUB_TOKEN='fixture-only'
 try{
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,'https://api.github.com/repos/dataarthub/eaos/actions/workflows/publish.yml/dispatches')
   assert.equal(options.method,'POST');assert.equal(options.redirect,'error')
   return {ok:true,status:204,json(){throw Error('204 has no JSON body')}}
  }
  assert.equal(await githubRequest('/actions/workflows/publish.yml/dispatches',{method:'POST',body:'{}'}),null)
 }finally{globalThis.fetch=original;if(token===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=token}
})

test('transient evidence GET failures retry within bounds; mutations and denied reads never retry',async()=>{
 const original=globalThis.fetch,token=process.env.GITHUB_TOKEN;process.env.GITHUB_TOKEN='fixture-only';
 try{
  let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)throw new TypeError('fetch failed');return {ok:true,status:200,json:async()=>({verified:true})};};
  assert.deepEqual(await githubRequest('/actions/runs/123'),{verified:true});assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('fetch failed');};
  await assert.rejects(githubRequest('/actions/workflows/publish.yml/dispatches',{method:'POST',body:'{}'}));assert.equal(calls,1);
  calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status:401};};
  await assert.rejects(githubRequest('/actions/runs/123'));assert.equal(calls,1);
  calls=0;globalThis.fetch=async()=>{calls++;return calls===1?{ok:false,status:503}:{ok:true,status:200,json:async()=>({verified:true})};};
  assert.deepEqual(await githubRequest('/actions/runs/123'),{verified:true});assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('fetch failed');};
  await assert.rejects(githubRequest('/actions/runs/123'));assert.equal(calls,3);
 }finally{globalThis.fetch=original;if(token===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=token;}
});

test('read retries do not shorten the existing mutating-request timeout',async()=>{
 const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout,token=process.env.GITHUB_TOKEN;process.env.GITHUB_TOKEN='fixture-only';const budgets=[];
 try{
  AbortSignal.timeout=ms=>{budgets.push(ms);return originalTimeout(ms);};
  globalThis.fetch=async()=>({ok:true,status:204});
  await githubRequest('/actions/workflows/publish.yml/dispatches',{method:'POST',body:'{}',timeoutMs:20000});
  assert(budgets[0]>15000&&budgets[0]<=20000,'Preserve the full caller budget for an ambiguous mutation');
 }finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;if(token===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=token;}
});
