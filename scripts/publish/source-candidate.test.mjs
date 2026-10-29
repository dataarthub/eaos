import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateAdmission} from './source-candidate.mjs';
const sha='a'.repeat(40),hash='b'.repeat(64),run={id:2,run_attempt:3,head_sha:sha};
const value={schemaVersion:2,state:'working-tree',commit:sha,sourceHash:hash,qualityRunId:'quality-1',consumerVerified:{runId:'consumer-1',sourceHash:hash,guard:{ok:true}},archives:['core','server','react','cli','plugins'].map(name=>({name:'@alneas/eaos-'+name,version:'0.2.0'}))};
test('authenticated unchanged Source candidate is reusable without build or repack',()=>{assert.equal(candidateAdmission(value,{run,sourceHash:hash}),value)});
test('source substitutions, unfinished consumer and stale archive bindings fail closed',()=>{
 for(const patch of [{commit:'c'.repeat(40)},{sourceHash:'d'.repeat(64)},{consumerVerified:false},{consumerVerified:{runId:'c',sourceHash:hash,guard:{ok:false}}}])assert.throws(()=>candidateAdmission({...value,...patch},{run,sourceHash:hash}));
});


import {downloadCandidate} from './source-candidate.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
test('actual immutable source ZIP bytes are checked before extraction; digest/expiry mismatch fails closed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'eaos-source-zip-test-'));let downloaded;
 try{
  mkdirSync(join(root,'release-fixture'));writeFileSync(join(root,'release-fixture/bundle.json'),JSON.stringify(value));
  const bytes=execFileSync('zip',['-qr','-','release-fixture'],{cwd:root}),digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
  const options=patch=>({token:'test-secret',request:async()=>({total_count:1,artifacts:[{id:4,name:`verified-public-candidate-${sha}-2-3`,expired:false,expires_at:'2099-01-01',workflow_run:{id:2,head_sha:sha},digest,size_in_bytes:bytes.length,...patch}]}),fetchImpl:async(url,opts)=>{
   if(url.endsWith('/zip')){assert.equal(opts.headers.Authorization,'Bearer test-secret');return new Response(null,{status:302,headers:{location:'https://unit.blob.core.windows.net/signed'}})}
   assert.equal(opts.headers,undefined);return new Response(bytes);
  }});
  downloaded=await downloadCandidate(run,options());assert(downloaded.directory.endsWith('/release-fixture'));
  for(const patch of [{digest:'sha256:'+'0'.repeat(64)},{expired:true},{workflow_run:{id:99,head_sha:sha}},{expires_at:'2000-01-01'}])await assert.rejects(downloadCandidate(run,options(patch)));
 }finally{downloaded?.cleanup();rmSync(root,{recursive:true,force:true})}
});


import {refreshEnvironment} from './source-candidate.mjs';
test('image drift repeats only dependent runtime/archive checks; malformed or incompatible proofs never become fallback',async()=>{
 const proof={run,receipt:{status:'passed',identity:{node:'v24',bun:'1.4.3',image:'ubuntu:1'}}};let fresh=0;const rerun=async()=>{fresh++};
 assert.equal(await refreshEnvironment(proof,proof.receipt.identity,rerun),false);assert.equal(fresh,0);
 assert.equal(await refreshEnvironment(proof,{...proof.receipt.identity,image:'ubuntu:2'},rerun),true);assert.equal(fresh,1);
 await assert.rejects(refreshEnvironment({...proof,receipt:{...proof.receipt,status:'failed'}},{...proof.receipt.identity,image:'ubuntu:2'},rerun));
 await assert.rejects(refreshEnvironment(proof,{...proof.receipt.identity,node:'v26'},rerun));assert.equal(fresh,1);
 await assert.rejects(refreshEnvironment(proof,{...proof.receipt.identity,image:'ubuntu:2'},async()=>{throw Error('archive consumers failed')}),/archive consumers failed/);
});


import {candidateForRelease,MissingCandidateError} from './source-candidate.mjs';
test('only authenticated never-produced scopes may materialize once; corrupt or missing full evidence blocks',async()=>{
 let builds=0;const materialize=async()=>{builds++;return {directory:'candidate'}};const missing=async()=>{throw new MissingCandidateError('none')};
 for(const scope of ['docs','publication'])assert.equal((await candidateForRelease({run,receipt:{selection:{scope}}},{download:missing,materialize})).fresh,true);
 await assert.rejects(candidateForRelease({run,receipt:{selection:{scope:'full'}}},{download:missing,materialize}));
 await assert.rejects(candidateForRelease({run,receipt:{selection:{scope:'docs'}}},{download:async()=>{throw Error('digest mismatch')},materialize}));assert.equal(builds,2);
});


import {prepareConsumerTools} from './source-candidate.mjs';
test('future hosted consumer setup preserves pinned prerequisites through a stubbed process boundary',()=>{
 const calls=[];prepareConsumerTools('/fixture',{run:(bin,args)=>calls.push([bin,...args])});
 assert.deepEqual(calls,[['gem','install','--user-install','kamal','--version','2.12.0','--no-document'],['bunx','playwright','install','--with-deps','chromium']]);
});
