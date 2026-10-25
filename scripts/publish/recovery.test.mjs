import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryId,recoveryTitle,validateRecoveryFacts} from './recovery.mjs';
const candidate={releaseId:17,tag:'eaos-core-v0.2.0',tagObject:'b'.repeat(40),commit:'a'.repeat(40),originalRun:123,reason:'Fixture'};
const owner={full_name:'dataarthub/eaos'};
export function recoveryFixture(){return {candidate,id:'fixture',controlCommit:'c'.repeat(40),runId:456,workflow:{id:7},
 original:{id:123,workflow_id:7,path:'.github/workflows/publish.yml',event:'release',head_branch:candidate.tag,head_sha:candidate.commit,head_repository:owner,run_attempt:1,status:'completed',conclusion:'failure',created_at:'2026-10-21T00:00:00Z'},
 jobs:{total_count:2,jobs:[{name:'verify',status:'completed',conclusion:'failure'},{name:'stage',status:'completed',conclusion:'skipped'}]},artifacts:{total_count:0,artifacts:[]},
 release:{id:17,tag_name:candidate.tag,draft:false,prerelease:false},ref:{object:{type:'tag',sha:candidate.tagObject}},tag:{object:{type:'commit',sha:candidate.commit}},comparison:{status:'ahead'},controlComparison:{status:'identical'},
 producer:{id:456,workflow_id:7,path:'.github/workflows/publish.yml',event:'workflow_dispatch',head_branch:'main',head_sha:'c'.repeat(40),head_repository:owner,run_attempt:1,display_title:recoveryTitle('fixture'),created_at:'2026-10-22T00:00:00Z'},history:{total_count:1,workflow_runs:[{id:456,display_title:recoveryTitle('fixture')}]},catalogAtProducer:{fixture:candidate}};}
test('only catalogued recovery IDs and exact original never-staged candidates are accepted',()=>{
 assert.equal(recoveryId('recover:fixture',{fixture:candidate}),'fixture');
 for(const value of ['123','recover:missing','recover:fixture\n','recover:../fixture'])assert.throws(()=>recoveryId(value,{fixture:candidate}));
 assert.equal(validateRecoveryFacts(recoveryFixture()).commit,candidate.commit);
});
test('recovery rejects changed Release/tag/source, original retries, artifacts, attempted stages and duplicate producers',()=>{
 for(const mutate of [
 f=>{f.original.run_attempt=2},f=>{f.original.head_sha='d'.repeat(40)},f=>{f.original.event='workflow_dispatch'},f=>{f.original.conclusion='success'},f=>{f.original.head_repository={full_name:'fork/repo'}},
 f=>{f.jobs.jobs[1].conclusion='failure'},f=>{f.jobs.jobs[1].conclusion='success'},f=>{f.jobs.jobs.push({...f.jobs.jobs[1]});f.jobs.total_count++},
 f=>{f.artifacts.total_count=1},f=>{f.artifacts.artifacts=[{id:1}]},f=>{f.release.id++},f=>{f.release.draft=true},f=>{f.release.prerelease=true},
 f=>{f.ref.object.sha='e'.repeat(40)},f=>{f.tag.object.sha='e'.repeat(40)},f=>{f.comparison.status='diverged'},f=>{f.controlComparison.status='diverged'},
 f=>{f.producer.run_attempt=2},f=>{f.producer.head_branch='feature'},f=>{f.producer.head_sha='d'.repeat(40)},f=>{f.producer.display_title='Complete npm staging run 123'},
 f=>{f.history.workflow_runs.push({id:457,display_title:recoveryTitle('fixture')});f.history.total_count++},f=>{f.history.total_count=101},f=>{f.catalogAtProducer.fixture={...candidate,commit:'d'.repeat(40)}}
 ]){const f=recoveryFixture();mutate(f);assert.throws(()=>validateRecoveryFacts(f));}
});

test('recovery bundles bind original source/Release and separate producer control commit',async()=>{
 const {assertRecoveryBundle,assertRecoveryContext}=await import('./recovery.mjs');
 const id=Object.keys((await import('./recovery.mjs')).recoveryCatalog)[0];
 const c={...candidate,id,runId:456,attempt:1,controlCommit:'c'.repeat(40)};
 const m={commit:c.commit,release:{id:c.releaseId,tag:c.tag},targets:['@alneas/eaos-core'],artifacts:[{name:'@alneas/eaos-core',version:'0.2.0'}],staging:{runId:456,attempt:1},recovery:{candidate:id,originalRun:123,controlCommit:c.controlCommit}};
 assert.doesNotThrow(()=>assertRecoveryBundle(m,c));
 for(const mutate of [m=>{m.commit=c.controlCommit},m=>{m.recovery.originalRun++},m=>{m.recovery.controlCommit=c.commit},m=>{m.staging.runId++}]){const x=structuredClone(m);mutate(x);assert.throws(()=>assertRecoveryBundle(x,c));}
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'dataarthub/eaos',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'dataarthub/eaos/.github/workflows/publish.yml@refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:c.controlCommit,STAGED_RUN:'recover:'+id};
 assert.doesNotThrow(()=>assertRecoveryContext(env));
 for(const change of [{GITHUB_EVENT_NAME:'release'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_RUN_ATTEMPT:'2'},{STAGED_RUN:'recover:missing'}])assert.throws(()=>assertRecoveryContext({...env,...change}));
});

test('completion authenticates the successful recovery producer but retains original source identity',async()=>{
 const {resolveStagingRun}=await import('./evidence.mjs');const {recoveryCatalog}=await import('./recovery.mjs');
 const id=Object.keys(recoveryCatalog)[0],c=recoveryCatalog[id],f=recoveryFixture();
 Object.assign(f,{candidate:c,id,catalogAtProducer:recoveryCatalog});
 Object.assign(f.original,{id:c.originalRun,head_branch:c.tag,head_sha:c.commit});
 Object.assign(f.release,{id:c.releaseId,tag_name:c.tag});f.ref.object.sha=c.tagObject;f.tag.object.sha=c.commit;
 Object.assign(f.producer,{status:'completed',conclusion:'success',display_title:recoveryTitle(id)});f.history.workflow_runs[0].display_title=recoveryTitle(id);
 const producerJobs={total_count:2,jobs:[{name:'resolve',status:'completed',conclusion:'success'},{name:'complete',status:'completed',conclusion:'success'}]};
 const artifacts={total_count:1,artifacts:[{id:789,name:'verified-npm-release-456-1',expired:false,expires_at:'2099-01-01T00:00:00Z',digest:'sha256:'+'d'.repeat(64),workflow_run:{id:456,head_sha:f.controlCommit}}]};
 const request=async path=>{
  if(path==='/actions/workflows/publish.yml')return f.workflow;
  if(path.startsWith('/actions/workflows/publish.yml/runs?'))return f.history;
  if(path.startsWith('/contents/'))return {type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(recoveryCatalog)).toString('base64')};
  if(path.startsWith('/releases/'))return f.release;
  if(path.startsWith('/git/ref/'))return f.ref;
  if(path.startsWith('/git/tags/'))return f.tag;
  if(path.startsWith('/compare/'))return f.comparison;
  if(path.includes('/'+c.originalRun+'/'))return path.includes('/jobs?')?f.jobs:f.artifacts;
  if(path==='/actions/runs/'+c.originalRun)return f.original;
  if(path==='/actions/runs/456')return f.producer;
  if(path.includes('/jobs?'))return producerJobs;
  if(path.includes('/artifacts?'))return artifacts;
  throw Error('Unexpected fixture request: '+path);
 };
 const proof=await resolveStagingRun(456,{request});
 assert.equal(proof.commit,c.commit);assert.equal(proof.artifactId,789);assert.deepEqual(proof.recovery,{candidate:id,originalRun:c.originalRun,controlCommit:f.controlCommit});
 producerJobs.jobs[1].conclusion='failure';await assert.rejects(resolveStagingRun(456,{request}));producerJobs.jobs[1].conclusion='success';
 artifacts.artifacts[0].workflow_run.head_sha=c.commit;await assert.rejects(resolveStagingRun(456,{request}));
});

test('pre-stage writer requires main OIDC and a fixed recovery candidate, never direct publication',async()=>{
 const {assertWriteEnvironment}=await import('./engine.mjs');const {recoveryCatalog}=await import('./recovery.mjs');
 const id=Object.keys(recoveryCatalog)[0];
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'dataarthub/eaos',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW_REF:'dataarthub/eaos/.github/workflows/publish.yml@refs/heads/main',GITHUB_SHA:'c'.repeat(40),GITHUB_RUN_ATTEMPT:'1',STAGED_RUN:'recover:'+id,RELEASE_REPOSITORY_PRIVATE:'false',ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.test',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture-ephemeral'};
 assert.doesNotThrow(()=>assertWriteEnvironment(env,'recover-stage'));
 for(const change of [{GITHUB_EVENT_NAME:'release'},{GITHUB_RUN_ATTEMPT:'2'},{ACTIONS_ID_TOKEN_REQUEST_TOKEN:''},{NPM_TOKEN:'fixture-static'},{STAGED_RUN:'recover:unknown'},{GITHUB_REF:'refs/tags/eaos-core-v0.2.0'}])assert.throws(()=>assertWriteEnvironment({...env,...change},'recover-stage'));
 assert.throws(()=>assertWriteEnvironment(env,'stage'));
});
