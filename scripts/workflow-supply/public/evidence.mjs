import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export function authoritative(run,repository){return run?.path==='.github/workflows/ci.yml'&&run.name==='Source quality'&&run.event==='push'&&run.head_branch==='main'&&run.head_repository?.full_name===repository;}
export function github(repository,{token=process.env.GITHUB_TOKEN,fetchImpl=fetch}={}){
 assert(/^[\w.-]+\/[\w.-]+$/.test(repository));
 const base='https://api.github.com/repos/'+repository;
 async function request(path){assert(path.startsWith('/')&&!path.includes('://'));const response=await fetchImpl(base+path,{headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})},redirect:'error',signal:AbortSignal.timeout(30000)});assert(response.ok,'Source evidence API unavailable');return response.json();}
 async function readArtifact(artifact){
  assert.match(artifact.digest??'',/^sha256:[a-f0-9]{64}$/);assert(Number.isSafeInteger(artifact.id)&&artifact.id>0);
  const redirect=await fetchImpl(base+'/actions/artifacts/'+artifact.id+'/zip',{headers:token?{Authorization:'Bearer '+token}:{},redirect:'manual',signal:AbortSignal.timeout(30000)});
  assert.equal(redirect.status,302,'Artifact download redirect required');const url=new URL(redirect.headers.get('location'));
  assert(url.protocol==='https:'&&!url.username&&!url.password&&(/\.blob\.core\.windows\.net$|\.actions\.githubusercontent\.com$|\.githubusercontent\.com$/.test(url.hostname)),'Unexpected signed artifact destination');
  // Never forward the GitHub Authorization header to signed storage.
  const downloaded=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(30000)});assert(downloaded.ok,'Evidence download unavailable');
  const bytes=Buffer.from(await downloaded.arrayBuffer());assert(bytes.length<=2*1024*1024,'Evidence archive too large');assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'),artifact.digest,'Artifact digest mismatch');
  const dir=mkdtempSync(join(tmpdir(),'source-evidence-'));try{const path=join(dir,'evidence.zip');writeFileSync(path,bytes);const members=execFileSync('unzip',['-Z1',path],{encoding:'utf8',timeout:10000}).trim().split('\n');assert.deepEqual(members,['source.json'],'Unexpected evidence members');return JSON.parse(execFileSync('unzip',['-p',path,'source.json'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}));}finally{rmSync(dir,{recursive:true,force:true});}
 }
 return {request,readArtifact};
}
export async function validateRun(run,{repository,nodeVersions,request,readArtifact,identity,imagePolicy='exact',now=Date.now()}){
 assert(authoritative(run,repository)&&run.status==='completed'&&run.conclusion==='success'&&sha(run.head_sha),'Untrusted source run');
 assert(Number.isSafeInteger(run.id)&&run.id>0&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0,'Invalid source run identity');
 const current=await request('/actions/runs/'+run.id);assert(current.id===run.id&&current.run_attempt===run.run_attempt&&current.conclusion==='success'&&current.status==='completed'&&authoritative(current,repository)&&current.head_sha===run.head_sha,'Source attempt superseded');
 const jobs=await request(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);assert(Array.isArray(jobs.jobs)&&jobs.total_count<=100,'Ambiguous source jobs');
 for(const node of nodeVersions){const suffix=`Verify packages (Node ${node})`;const found=jobs.jobs.filter(j=>j.name===suffix||j.name.endsWith(' / '+suffix));assert(found.length===1&&found[0].status==='completed'&&found[0].conclusion==='success','Required runtime job missing or unsuccessful');}
 const listed=await request(`/actions/runs/${run.id}/artifacts?per_page=100`);assert(Array.isArray(listed.artifacts)&&listed.total_count<=100,'Ambiguous source artifacts');
 const name=`source-evidence-node${identity.nodeMajor}-${run.head_sha}-${run.id}-${run.run_attempt}`;const found=listed.artifacts.filter(a=>a.name===name);assert.equal(found.length,1,'Missing source receipt');const a=found[0];
 assert(a.expired===false&&Date.parse(a.expires_at)>now&&a.workflow_run?.id===run.id&&a.workflow_run?.head_sha===run.head_sha,'Expired or mismatched source evidence');
 const receipt=await readArtifact(a);assert(receipt.schemaVersion===1&&receipt.repository===repository&&receipt.sha===run.head_sha&&receipt.run===run.id&&receipt.attempt===run.run_attempt,'Receipt identity mismatch');assert(['exact','authenticate'].includes(imagePolicy),'Invalid source image policy');const expected={...identity},actual={...receipt.identity};if(imagePolicy==='authenticate'){assert(typeof actual.image==='string'&&/^[^:]+:[^:]+$/.test(actual.image)&&typeof expected.image==='string'&&/^[^:]+:[^:]+$/.test(expected.image),'Known source and current images required');delete actual.image;delete expected.image;}assert.deepEqual(actual,expected,'Execution environment changed');assert(receipt.status==='passed','Source evidence did not pass');const confirmed=await request('/actions/runs/'+run.id);assert(confirmed.id===run.id&&confirmed.run_attempt===run.run_attempt&&confirmed.conclusion==='success'&&confirmed.status==='completed'&&authoritative(confirmed,repository)&&confirmed.head_sha===run.head_sha,'Source attempt superseded during authentication');return receipt;
}
export async function sourceRun({repository,nodeVersions,identity,head,currentRun,isAncestor,exact=false,imagePolicy='exact',request,readArtifact}){
 assert(sha(head),'Exact source SHA required');const query=new URLSearchParams({event:'push',branch:'main',per_page:'100',...(exact?{head_sha:head}:{})});
 const listed=await request('/actions/workflows/ci.yml/runs?'+query);assert(Array.isArray(listed.workflow_runs)&&listed.workflow_runs.length<=100&&Number.isSafeInteger(listed.total_count)&&listed.total_count>=listed.workflow_runs.length,'Invalid bounded source history');
 const seen=new Set();for(const run of listed.workflow_runs.filter(r=>authoritative(r,repository)).sort((a,b)=>b.id-a.id)){
  if(seen.has(run.head_sha))continue;seen.add(run.head_sha);
  if(run.id===Number(currentRun)||!sha(run.head_sha))continue;
  if(exact?run.head_sha!==head:!await isAncestor(run.head_sha))continue;
  if(run.status!=='completed'||run.conclusion!=='success'){if(exact)throw Error('Latest exact-commit Source quality did not pass');continue;}
  try{const receipt=await validateRun(run,{repository,nodeVersions,request,readArtifact,identity,imagePolicy});const latest=await request('/actions/workflows/ci.yml/runs?'+new URLSearchParams({event:'push',branch:'main',per_page:'100',head_sha:run.head_sha}));assert(Array.isArray(latest.workflow_runs)&&latest.workflow_runs.length<=100&&Number.isSafeInteger(latest.total_count)&&latest.total_count>=latest.workflow_runs.length,'Invalid bounded source history');const owning=latest.workflow_runs.filter(r=>authoritative(r,repository)&&r.head_sha===run.head_sha).sort((a,b)=>b.id-a.id)[0];assert(owning?.id===run.id&&owning.run_attempt===run.run_attempt&&owning.status==='completed'&&owning.conclusion==='success','Latest source run superseded during authentication');return {run,receipt};}catch(error){if(exact)throw error;}
 }
 if(exact)throw Error('No authoritative exact-commit Source quality evidence');return null;
}
