import test from 'node:test';import assert from 'node:assert/strict';
import {sourceRun,validateRun,github} from './evidence.mjs';
const repository='example/public',head='a'.repeat(40),old='b'.repeat(40),identity={nodeMajor:24,node:'v24.0.0'};
const run=(overrides={})=>({id:4,run_attempt:1,head_sha:old,name:'Source quality',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_repository:{full_name:repository},status:'completed',conclusion:'success',...overrides});
function fixture(overrides={}){const r=run(),receipt={schemaVersion:1,repository,sha:old,run:4,attempt:1,identity,status:'passed'},artifact={id:8,name:`source-evidence-node24-${old}-4-1`,digest:'sha256:'+'a'.repeat(64),expired:false,expires_at:'2099-01-01',workflow_run:{id:4,head_sha:old}};
 const request=async path=>path.includes('/workflows/')?{total_count:1,workflow_runs:[r]}:path.includes('/jobs?')?{total_count:2,jobs:[24,26].map(node=>({name:`verify / Verify packages (Node ${node})`,status:'completed',conclusion:'success'}))}:path.includes('/artifacts?')?{total_count:1,artifacts:[artifact]}:r;
 return {repository,nodeVersions:[24,26],identity,head,isAncestor:async()=>true,request,readArtifact:async()=>receipt,...overrides};}
test('successful compatible main ancestor is usable; failed intervening commits remain in diff',async()=>{const result=await sourceRun(fixture());assert.equal(result.run.head_sha,old);});
test('a newer failed attempt or run for a SHA prevents reuse of an earlier green result',async()=>{
 const base=fixture(),request=base.request;
 assert.equal(await sourceRun({...base,request:async p=>p.includes('/workflows/')?{total_count:2,workflow_runs:[run({id:5,conclusion:'failure'}),run()]}:request(p)}),null);
 assert.equal(await sourceRun({...base,request:async p=>p==='/actions/runs/4'?run({run_attempt:2,conclusion:'failure'}):request(p)}),null);
});
test('PR, missing runtime job, expired artifact and changed environment cannot establish baseline',async()=>{
 const base=fixture();for(const request of [async p=>p.includes('/workflows/')?{total_count:1,workflow_runs:[run({event:'pull_request'})]}:base.request(p),async p=>p.includes('/jobs?')?{total_count:0,jobs:[]}:base.request(p),async p=>p.includes('/artifacts?')?{total_count:0,artifacts:[]}:base.request(p)])assert.equal(await sourceRun({...base,request}),null);
 assert.equal(await sourceRun({...base,identity:{...identity,node:'v24.1.0'}}),null);
 await assert.rejects(sourceRun({...base,head,exact:true}),/No authoritative/);
});
test('exact-commit release requires the same SHA and refuses unavailable required-job evidence',async()=>{
 const f=fixture({head:old,exact:true});assert.equal((await sourceRun(f)).run.id,4);
 const request=f.request;await assert.rejects(sourceRun({...f,request:async p=>p.includes('/jobs?')?{total_count:1,jobs:[{name:'Verify packages (Node 24)',status:'completed',conclusion:'success'}]}:request(p)}),/runtime job/);
});
test('GitHub credentials never follow signed storage redirects',async()=>{
 const calls=[];const client=github(repository,{token:'fixture-token',fetchImpl:async(url,options)=>{calls.push({url,options});if(calls.length===1)return {status:302,headers:{get:()=> 'https://fixture.blob.core.windows.net/artifact'}};return {ok:true,arrayBuffer:async()=>Buffer.from('invalid zip')};}});
 await assert.rejects(client.readArtifact({id:8,digest:'sha256:'+'0'.repeat(64)}),/digest mismatch/);assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-token');assert.equal(calls[1].options.headers,undefined);
});
test('digest-bound signed-storage download reads one sanitized JSON member and rejects extra archive members',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');const {createHash}=await import('node:crypto');
 const root=mkdtempSync(join(tmpdir(),'evidence-zip-'));try{
  const proof={status:'passed',fixture:true};writeFileSync(join(root,'source.json'),JSON.stringify(proof));execFileSync('zip',['-q','receipt.zip','source.json'],{cwd:root});
  let bytes=readFileSync(join(root,'receipt.zip')),calls=0;const client=github(repository,{token:'fixture-token',fetchImpl:async()=>++calls%2?{status:302,headers:{get:()=> 'https://fixture.blob.core.windows.net/receipt'}}:{ok:true,arrayBuffer:async()=>bytes}});
  const artifact=()=>({id:8,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')});assert.deepEqual(await client.readArtifact(artifact()),proof);
  writeFileSync(join(root,'extra.json'),'{}');execFileSync('zip',['-q','receipt.zip','extra.json'],{cwd:root});bytes=readFileSync(join(root,'receipt.zip'));await assert.rejects(client.readArtifact(artifact()),/members/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
