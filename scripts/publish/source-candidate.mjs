import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {requireSource,executionIdentity} from '../workflow-supply/public/quality.mjs';
import {github} from '../workflow-supply/public/evidence.mjs';
import {sourceHash} from '../source-state.mjs';
import {packages} from '../check-public.mjs';
import {pendingReleaseErrors} from '../release-notes.mjs';
import {cleanCommit} from '../source-state.mjs';
import {handoff} from './bundle.mjs';
export function candidateAdmission(value,{run,sourceHash}){
 assert(value?.schemaVersion===2&&value.commit===run.head_sha&&value.sourceHash===sourceHash,'Source candidate changed');
 assert(['working-tree','commit-bound'].includes(value.state)&&typeof value.qualityRunId==='string','Unverified Source bundle');
 assert(value.consumerVerified?.guard?.ok===true&&typeof value.consumerVerified.runId==='string'&&value.consumerVerified.sourceHash===sourceHash,'Source archive consumers did not pass');
 assert(Array.isArray(value.archives)&&value.archives.length===5,'Incomplete Source candidate');
 return value;
}
// Future hosted CI setup, copied from the existing Source/release setup contract.
// Local regression tests inject this boundary; editing this file executes no installer.
export function prepareConsumerTools(root,{run=execFileSync}={}){
 run('gem',['install','--user-install','kamal','--version','2.12.0','--no-document'],{cwd:root,stdio:'inherit'});
 run('bunx',['playwright','install','--with-deps','chromium'],{cwd:root,stdio:'inherit'});
}
export class MissingCandidateError extends Error {}
export async function candidateForRelease(proof,{download,materialize}){
 try{return {candidate:await download(proof.run),fresh:false}}catch(error){
  if(!(error instanceof MissingCandidateError)||!['docs','publication'].includes(proof.receipt?.selection?.scope))throw error;
  return {candidate:await materialize(),fresh:true};
 }
}
export async function downloadCandidate(run,{request=github('dataarthub/eaos').request,token=process.env.GITHUB_TOKEN,fetchImpl=fetch}={}){
 const listed=await request(`/actions/runs/${run.id}/artifacts?per_page=100`);assert(Array.isArray(listed.artifacts)&&listed.total_count<=100,'Incomplete candidate inventory');
 const found=listed.artifacts.filter(a=>a.name===`verified-public-candidate-${run.head_sha}-${run.id}-${run.run_attempt}`);if(found.length===0)throw new MissingCandidateError('Source did not produce an archive bundle');assert.equal(found.length,1,'Ambiguous exact Source archive bundle');
 const a=found[0];assert(a.expired===false&&Date.parse(a.expires_at)>Date.now()&&a.workflow_run?.id===run.id&&a.workflow_run?.head_sha===run.head_sha&&/^sha256:[a-f0-9]{64}$/.test(a.digest),'Expired or mismatched Source archives');
 assert(Number.isSafeInteger(a.id)&&a.id>0&&a.size_in_bytes<=128*1024*1024,'Invalid Source archive identity');
 const redirect=await fetchImpl(`https://api.github.com/repos/dataarthub/eaos/actions/artifacts/${a.id}/zip`,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(30000)});assert.equal(redirect.status,302);
 const url=new URL(redirect.headers.get('location'));assert(url.protocol==='https:'&&!url.username&&!url.password&&/\.blob\.core\.windows\.net$|\.githubusercontent\.com$/.test(url.hostname),'Unexpected signed archive destination');
 const response=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(30000)});assert(response.ok,'Source archive unavailable');const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.length<=128*1024*1024);assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'),a.digest,'Source artifact digest mismatch');
 const scratch=mkdtempSync(join(tmpdir(),'eaos-source-bundle-'));
 try{const zip=join(scratch,'bundle.zip');writeFileSync(zip,bytes);const members=execFileSync('unzip',['-Z1',zip],{encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n');assert(members.length<=100&&members.every(p=>/^release-[A-Za-z0-9_-]+\/(?:[A-Za-z0-9._-]+)?$/.test(p)&&!p.includes('..')),'Unsafe Source archive members');const manifests=members.filter(p=>p.endsWith('/bundle.json'));assert.equal(manifests.length,1,'Ambiguous Source candidate');let total=0;for(const member of members.filter(p=>!p.endsWith('/'))){const content=execFileSync('unzip',['-p',zip,member],{maxBuffer:128*1024*1024});total+=content.length;assert(total<=256*1024*1024,'Expanded archive exceeds budget');const destination=join(scratch,member);mkdirSync(join(scratch,member.split('/')[0]),{recursive:true});writeFileSync(destination,content,{flag:'wx'});}return {directory:join(scratch,manifests[0].split('/')[0]),cleanup:()=>rmSync(scratch,{recursive:true,force:true})};}catch(error){rmSync(scratch,{recursive:true,force:true});throw error}
}
export async function refreshEnvironment(proof,current,run){
 assert(proof?.receipt?.status==='passed'&&proof.run?.head_sha,'Authenticated Source evidence required');
 const before={...proof.receipt.identity},after={...current};delete before.image;delete after.image;assert.deepEqual(before,after,'Runtime incompatibility cannot use image fallback');
 if(proof.receipt.identity.image===current.image)return false;
 await run();return true;
}
export async function reuseCandidate(root,{verify=(root)=>requireSource(root,{imagePolicy:'authenticate'}),download=downloadCandidate,hash=sourceHash,transfer=handoff}={}){
 cleanCommit(root);
 const fragments=readdirSync(join(root,'.changeset')).filter(name=>name.endsWith('.md')&&name!=='README.md').map(filename=>({filename,text:readFileSync(join(root,'.changeset',filename),'utf8')}));
 assert.deepEqual(pendingReleaseErrors(await packages(),fragments),[],'Review selected pending Changesets before final handoff');
 const proof=await verify(root);assert(proof?.run&&proof.receipt?.status==='passed','Authoritative source proof required');
 const {candidate,fresh:materialized}=await candidateForRelease(proof,{download,materialize:async()=>{
  prepareConsumerTools(root);
  execFileSync('bun',['run','check'],{cwd:root,stdio:'inherit',env:{...process.env,PUBLIC_SOURCE_IMAGE_POLICY:'authenticate'}});
  const directory=execFileSync('node',['scripts/release.mjs','prepare','--final'],{cwd:root,encoding:'utf8'}).trim();
  execFileSync('bun',['run','test:consumer','--',directory],{cwd:root,stdio:'inherit'});
  execFileSync('bun',['run','release:verify','--',directory],{cwd:root,stdio:'inherit'});
  return {directory,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
 }});
 try{const value=candidateAdmission(JSON.parse(readFileSync(join(candidate.directory,'bundle.json'),'utf8')),{run:proof.run,sourceHash:await hash(root)});
  const fresh=!materialized&&await refreshEnvironment(proof,executionIdentity(root),async()=>{
   prepareConsumerTools(root);
   // Source formatting/docs/tooling evidence remains valid. Materialize current
   // workspace outputs and repeat OS/runtime plus exact archive/browser consumers.
   for(const args of [['run','build'],['run','test'],['run','test:consumer','--',candidate.directory]])execFileSync('bun',args,{cwd:root,stdio:'inherit'});
  });
  if(fresh)Object.assign(value,JSON.parse(readFileSync(join(candidate.directory,'bundle.json'),'utf8')));
  candidateAdmission(value,{run:proof.run,sourceHash:await hash(root)});
  // Only the manifest gains clean-commit state. Tested tarballs and notes remain identical.
  value.state='commit-bound';writeFileSync(join(candidate.directory,'bundle.json'),JSON.stringify(value)+'\n');
  await transfer(candidate.directory,join(root,'.verification/handoff'),root);
  console.log(`Reused exact Source archive bundle from run ${proof.run.id}, attempt ${proof.run.run_attempt}; no build or repack.`);
 }finally{candidate.cleanup()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await reuseCandidate(resolve(import.meta.dirname,'../..'));
