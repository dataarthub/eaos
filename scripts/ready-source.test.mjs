import test from 'node:test';
import assert from 'node:assert/strict';
import {readySourceProof} from './ready-source.mjs';
const sha='a'.repeat(40),tree='b'.repeat(40),base='c'.repeat(40),head='d'.repeat(40),merge='e'.repeat(40);
const run={id:9,run_attempt:2,head_sha:head,path:'.github/workflows/ci.yml',name:'Source quality',event:'pull_request',head_repository:{full_name:'dataarthub/eaos'},pull_requests:[{number:1}],status:'completed',conclusion:'success'};
const receipt={schemaVersion:1,repository:'dataarthub/eaos',sha:merge,run:9,attempt:2,status:'passed',identity:{image:'ubuntu:1'},tree,pr:{number:1,base,head,ready:true}};
function fixture(patch={}){return {env:{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha},identity:receipt.identity,tree,parent:base,readArtifact:async()=>({...receipt,...patch.receipt}),request:async path=>{
 if(path.includes('/commits/')&&path.includes('/pulls'))return [{number:1,merged:true,draft:false,merge_commit_sha:sha,base:{ref:'main',repo:{full_name:'dataarthub/eaos'}},head:{sha:head,repo:{full_name:'dataarthub/eaos'}}}];
 if(path.includes('/git/commits/'))return {sha:merge,tree:{sha:patch.tree??tree},parents:[{sha:base},{sha:head}]};
 if(path.includes('/compare/'))return {files:[{filename:patch.control??'packages/core/src/index.ts'}]};
 if(path.includes('/workflows/'))return {total_count:500,workflow_runs:[run]};
 if(path.includes('/jobs?'))return {total_count:1,jobs:[{name:'verify / Verify packages (Node 24)',status:'completed',conclusion:'success'}]};
 if(path.includes('/artifacts?'))return {total_count:1,artifacts:[{name:`source-evidence-node24-${merge}-9-2`,expired:false,expires_at:'2099-01-01',workflow_run:{id:9,head_sha:head}}]};
 return {...run,...patch.current};
 }};}
test('Ready PR actual tree inherits with exact base/head/runtime and latest successful attempt',async()=>{assert.equal((await readySourceProof('.',fixture())).run.id,9)});
test('self-declared matching receipt cannot hide different Git tree, controls, failed attempt or stale base',async()=>{
 for(const patch of [{tree:'f'.repeat(40)},{control:'scripts/quality.mjs'},{current:{run_attempt:3,conclusion:'failure'}},{receipt:{pr:{...receipt.pr,base:'f'.repeat(40)}}},{receipt:{identity:{image:'ubuntu:2'}}}])await assert.rejects(readySourceProof('.',fixture(patch)));
});

test('newer failed invocation appearing during artifact inspection invalidates earlier success',async()=>{
 const options=fixture(),request=options.request;let reads=0;
 options.request=async path=>{if(path.includes('/workflows/')){reads++;if(reads>1)return {total_count:2,workflow_runs:[{...run,id:10,status:'in_progress',conclusion:null},run]}}return request(path)};
 await assert.rejects(readySourceProof('.',options),/Newer PR source/);
});
