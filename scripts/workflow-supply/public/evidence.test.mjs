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
 const {createHash}=await import('node:crypto');
 // Fixed deflated ZIPs: source.json contains the proof below; the second also has extra.json = {}.
 // Archive creation is deliberately independent of installed command-line tools.
 const archives=[
  Buffer.from('UEsDBBQAAAAIAAAAIQBtcm6hJAAAACIAAAALAAAAc291cmNlLmpzb26rViouSSwpLVayUipILC5OTVHSUUrLrCgpLUpVsiopKk2tBQBQSwECFAMUAAAACAAAACEAbXJuoSQAAAAiAAAACwAAAAAAAAAAAAAAgAEAAAAAc291cmNlLmpzb25QSwUGAAAAAAEAAQA5AAAATQAAAAAA','base64'),
  Buffer.from('UEsDBBQAAAAIAAAAIQBtcm6hJAAAACIAAAALAAAAc291cmNlLmpzb26rViouSSwpLVayUipILC5OTVHSUUrLrCgpLUpVsiopKk2tBQBQSwMEFAAAAAgAAAAhAEO/pqMEAAAAAgAAAAoAAABleHRyYS5qc29uq64FAFBLAQIUAxQAAAAIAAAAIQBtcm6hJAAAACIAAAALAAAAAAAAAAAAAACAAQAAAABzb3VyY2UuanNvblBLAQIUAxQAAAAIAAAAIQBDv6ajBAAAAAIAAAAKAAAAAAAAAAAAAACAAU0AAABleHRyYS5qc29uUEsFBgAAAAACAAIAcQAAAHkAAAAAAA==','base64'),
 ];
 const proof={status:'passed',fixture:true};let bytes=archives[0],calls=0;
 const client=github(repository,{token:'fixture-token',fetchImpl:async()=>++calls%2?{status:302,headers:{get:()=> 'https://fixture.blob.core.windows.net/receipt'}}:{ok:true,arrayBuffer:async()=>bytes}});
 const artifact=()=>({id:8,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')});assert.deepEqual(await client.readArtifact(artifact()),proof);
 bytes=archives[1];await assert.rejects(client.readArtifact(artifact()),/members/);
});

test('evidence fixture runs without a zip executable',async()=>{
 const {mkdtempSync,symlinkSync,rmSync,accessSync,constants}=await import('node:fs');const {tmpdir}=await import('node:os');const {join,delimiter}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const unzip=(process.env.PATH??'').split(delimiter).map(directory=>join(directory,'unzip')).find(path=>{try{accessSync(path,constants.X_OK);return true;}catch{return false;}});
 assert.ok(unzip,'The evidence reader requires unzip');
 const root=mkdtempSync(join(tmpdir(),'evidence-no-zip-'));try{
  symlinkSync(unzip,join(root,'unzip'));
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^digest-bound signed-storage download',import.meta.filename],{env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('NODE_TEST_'))),PATH:root},encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/# tests 1\n/);assert.match(result.stdout,/# pass 1\n/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('image drift may be authenticated for fresh release verification but never ordinary reuse',async()=>{
 const base=fixture({head:old,exact:true});
 const changed={...identity,image:'ubuntu24:new'};
 const f={...base,identity:changed,readArtifact:async()=>({...await base.readArtifact(),identity:{...identity,image:'ubuntu24:old'}})};
 await assert.rejects(sourceRun(f),/Execution environment changed/);
 assert.equal((await sourceRun({...f,imagePolicy:'authenticate'})).run.id,4);
 for(const key of ['node','bun','bundle','environment','arch','os']){
  await assert.rejects(sourceRun({...f,imagePolicy:'authenticate',readArtifact:async()=>({...await f.readArtifact(),identity:{...changed,[key]:'different'}})}),/Execution environment changed/);
 }
 const request=base.request;
 await assert.rejects(sourceRun({...f,imagePolicy:'authenticate',request:async p=>p.includes('/jobs?')?{total_count:0,jobs:[]}:request(p)}),/runtime job/);
 await assert.rejects(sourceRun({...f,imagePolicy:'authenticate',readArtifact:async()=>({...await f.readArtifact(),status:'failed'})}),/did not pass/);
 await assert.rejects(sourceRun({...f,imagePolicy:'anything'}),/image policy/);
});

test('image authentication refuses an unidentified current or recorded runner',async()=>{
 const f=fixture({head:old,exact:true,imagePolicy:'authenticate'});
 for(const image of ['',':','ubuntu24:'])await assert.rejects(sourceRun({...f,identity:{...identity,image},readArtifact:async()=>({...await f.readArtifact(),identity:{...identity,image:'ubuntu24:known'}})}),/Known source/);
});

test('bounded latest history remains reusable after more than one page of lifetime runs',async()=>{
 const f=fixture({head:old,exact:true}),request=f.request;
 const options={...f,request:async p=>p.includes('/workflows/')?{total_count:201,workflow_runs:[run()]}:request(p)};
 assert.equal((await sourceRun(options)).run.id,4);
 await assert.rejects(sourceRun({...options,request:async p=>p.includes('/workflows/')?{total_count:202,workflow_runs:[run({id:5,conclusion:'failure'}),run()]}:request(p)}),/Latest exact-commit/);
});


test('artifact authentication cannot return a superseded attempt or newer same-SHA invocation',async()=>{
 for(const changed of [run({run_attempt:2,status:'in_progress',conclusion:null}),run({id:5,status:'in_progress',conclusion:null}),run({id:5,conclusion:'failure'})]){
  const base=fixture({head:old,exact:true});let authenticated=false;
  const options={...base,request:async path=>{
   if(authenticated&&path==='/actions/runs/4'&&changed.id===4)return changed;
   if(authenticated&&path.includes('/workflows/'))return {total_count:2,workflow_runs:[changed,run()]};
   return base.request(path);
  },readArtifact:async()=>{authenticated=true;return base.readArtifact();}};
  await assert.rejects(sourceRun(options),/superseded|Latest/);
  authenticated=false;assert.equal(await sourceRun({...options,exact:false}),null);
 }
});
