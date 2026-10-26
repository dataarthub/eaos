// Fixed, single-use pre-stage recovery. It never changes GitHub event identity or the original source.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {releaseTarget,assertReleaseSelection} from './context.mjs';
const repository='dataarthub/eaos',workflow='.github/workflows/publish.yml';
export const recoveryCatalog=JSON.parse(readFileSync(new URL('./recovery-candidates.json',import.meta.url),'utf8'));
export const recoveryTitle=id=>'Recover npm pre-stage candidate recover:'+id;
export function recoveryId(value,catalog=recoveryCatalog){
 const match=/^recover:([a-z0-9-]+)$/.exec(value??'');
 assert(match&&match[0]===value&&Object.hasOwn(catalog,match[1]),'Unknown pre-stage recovery candidate');return match[1];
}
export function validatePreviousProducer(c,f,workflowId){
 const p=c.previousProducer;assert(p&&Number.isSafeInteger(p.runId));
 const r=f.run;assert.equal(r.id,p.runId);assert.equal(r.workflow_id,workflowId);assert.equal(r.path,workflow);assert.equal(r.event,'workflow_dispatch');assert.equal(r.head_branch,'main');assert.equal(r.head_sha,p.controlCommit);assert.equal(r.head_repository?.full_name,repository);assert.equal(r.run_attempt,1);assert.equal(r.status,'completed');assert.equal(r.conclusion,'failure');assert.equal(r.display_title,recoveryTitle(p.candidate));
 assert(f.jobs.total_count<=100&&f.jobs.total_count===f.jobs.jobs.length);
 for(const [name,result] of [['resolve','failure'],['complete','skipped']]){const jobs=f.jobs.jobs.filter(j=>j.name===name);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'completed');assert.equal(jobs[0].conclusion,result,'Predecessor writer must never have run');}
 assert.equal(f.artifacts.total_count,0);assert.deepEqual(f.artifacts.artifacts,[]);
 const prior=f.catalog[p.candidate];assert(prior);
 for(const key of ['releaseId','tag','tagObject','commit','originalRun'])assert.equal(prior[key],c[key],'Predecessor original identity changed');
 assert(!prior.previousProducer,'Nested recovery histories require separate review');
 return p.runId;
}
export function validateRecoveryFacts(f){
 const c=f.candidate;assert(c&&Number.isSafeInteger(c.releaseId)&&Number.isSafeInteger(c.originalRun));releaseTarget(c.tag);
 for(const value of [c.commit,c.tagObject,f.controlCommit])assert.match(value,/^[a-f0-9]{40}$/);
 for(const [r,id,event,branch,sha] of [[f.original,c.originalRun,'release',c.tag,c.commit],[f.producer,f.runId,'workflow_dispatch','main',f.controlCommit]]){
  assert.equal(r.id,id);assert.equal(r.workflow_id,f.workflow.id);assert.equal(r.path,workflow);assert.equal(r.event,event);assert.equal(r.head_branch,branch);assert.equal(r.head_sha,sha);
  assert.equal(r.head_repository?.full_name,repository);assert.equal(r.run_attempt,1,'Reruns cannot resubmit a recovery');assert(Number.isFinite(Date.parse(r.created_at)));
 }
 assert.equal(f.original.status,'completed');assert.equal(f.original.conclusion,'failure');
 assert(f.jobs.total_count<=100&&f.jobs.jobs.length===f.jobs.total_count);
 for(const [name,conclusion] of [['verify','failure'],['stage','skipped']]){const jobs=f.jobs.jobs.filter(j=>j.name===name);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'completed');assert.equal(jobs[0].conclusion,conclusion,'Original stage must never have run');}
 assert.equal(f.artifacts.total_count,0,'Original archives forbid pre-stage recovery');assert.deepEqual(f.artifacts.artifacts,[]);
 assert.equal(f.release.id,c.releaseId);assert.equal(f.release.tag_name,c.tag);assert.equal(f.release.draft,false);assert.equal(f.release.prerelease,false);
 assert.equal(f.ref.object?.type,'tag');assert.equal(f.ref.object.sha,c.tagObject,'Original tag object changed');assert.equal(f.tag.object?.type,'commit');assert.equal(f.tag.object.sha,c.commit);
 for(const comparison of [f.comparison,f.controlComparison])assert(['ahead','identical'].includes(comparison.status),'Source/control must remain on main');
 assert.equal(f.producer.display_title,recoveryTitle(f.id));
 assert(f.history.total_count<=100&&Array.isArray(f.history.workflow_runs),'Ambiguous recovery history');
 const previous=f.candidate.previousProducer?validatePreviousProducer(c,f.previous,f.workflow.id):null;
 const titles=Object.entries(f.catalogAtProducer).filter(([,entry])=>entry.originalRun===c.originalRun).map(([id])=>recoveryTitle(id));
 const others=f.history.workflow_runs.filter(r=>titles.includes(r.display_title)&&r.id!==f.runId&&r.id!==previous);
 assert.equal(others.length,0,'Candidate is single-use; inspect any previous producer instead of retrying');
 assert.deepEqual(f.catalogAtProducer[f.id],c,'Producer catalog differs from reviewed candidate');
 return {...c,id:f.id,runId:f.runId,controlCommit:f.controlCommit,attempt:1,createdAt:f.producer.created_at};
}
export async function resolveRecovery(value,{request,runId,controlCommit,catalog=recoveryCatalog}={}){
 const id=recoveryId(value,catalog),c=catalog[id];assert(Number.isSafeInteger(runId)&&runId>0);
 const workflowInfo=await request('/actions/workflows/publish.yml');
 const original=await request('/actions/runs/'+c.originalRun),producer=await request('/actions/runs/'+runId);
 const jobs=await request(`/actions/runs/${c.originalRun}/attempts/1/jobs?per_page=100`),artifacts=await request(`/actions/runs/${c.originalRun}/artifacts?per_page=100`);
 const release=await request('/releases/tags/'+encodeURIComponent(c.tag)),ref=await request('/git/ref/tags/'+encodeURIComponent(c.tag)),tag=await request('/git/tags/'+c.tagObject);
 const comparison=await request('/compare/'+c.commit+'...main'),controlComparison=await request('/compare/'+controlCommit+'...main');
 const history=await request('/actions/workflows/publish.yml/runs?'+new URLSearchParams({event:'workflow_dispatch',branch:'main',per_page:'100',created:'>='+original.created_at}));
 const content=await request('/contents/scripts/publish/recovery-candidates.json?ref='+controlCommit);
 assert.equal(content.encoding,'base64');assert.equal(content.type,'file');
 const catalogAtProducer=JSON.parse(Buffer.from(content.content,'base64').toString('utf8'));
 let previous;
 if(c.previousProducer){
  const p=c.previousProducer,run=await request('/actions/runs/'+p.runId);
  const jobs=await request(`/actions/runs/${p.runId}/attempts/1/jobs?per_page=100`),artifacts=await request(`/actions/runs/${p.runId}/artifacts?per_page=100`);
  const content=await request('/contents/scripts/publish/recovery-candidates.json?ref='+p.controlCommit);assert.equal(content.encoding,'base64');assert.equal(content.type,'file');
  previous={run,jobs,artifacts,catalog:JSON.parse(Buffer.from(content.content,'base64').toString('utf8'))};
 }
 return validateRecoveryFacts({candidate:c,id,controlCommit,runId,workflow:workflowInfo,original,producer,jobs,artifacts,release,ref,tag,comparison,controlComparison,history,catalogAtProducer,previous});
}
export function assertRecoveryContext(env){
 assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REPOSITORY,repository);assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_WORKFLOW_REF,`${repository}/${workflow}@refs/heads/main`);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');recoveryId(env.STAGED_RUN);assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
}
export async function recoveryContext(env=process.env){
 assertRecoveryContext(env);const {githubRequest}=await import('./evidence.mjs');
 return resolveRecovery(env.STAGED_RUN,{request:githubRequest,runId:Number(env.GITHUB_RUN_ID),controlCommit:env.GITHUB_SHA});
}
export function recoverySelection(c){return {...releaseTarget(c.tag),commit:c.commit,releaseId:c.releaseId};}
export function assertRecoveryBundle(manifest,c){assertReleaseSelection(manifest,recoverySelection(c));assert.deepEqual(manifest.recovery,{candidate:c.id,originalRun:c.originalRun,controlCommit:c.controlCommit});assert.deepEqual(manifest.staging,{runId:c.runId,attempt:c.attempt});}
async function verifyOriginal(c){
 const root=resolve(import.meta.dirname,'../..'),source=join(root,'.verification/source');
 const {git,handoff}=await import('./bundle.mjs');
 assert.equal(git(source,['rev-parse','HEAD']),c.commit);assert.equal(git(source,['status','--porcelain']),'');
 const run=(command,args)=>execFileSync(command,args,{cwd:source,stdio:'inherit',env:process.env,timeout:1200000});
 // Full original-source verification runs under the real dispatch context, never a forged release event.
 run('bun',['install','--frozen-lockfile','--ignore-scripts','--linker','hoisted','--registry=https://registry.npmjs.org']);
 run('bun',['run','secrets:setup']);run('bun',['run','check']);run('bun',['run','secrets:check','--','--history']);run('bunx',['playwright','install','--with-deps','chromium']);
 const bundle=execFileSync(process.execPath,['scripts/release.mjs','prepare','--final'],{cwd:source,encoding:'utf8',env:process.env,timeout:300000}).trim();
 run('bun',['run','test:consumer','--',bundle]);run('bun',['run','release:verify','--',bundle]);
 assert.equal(git(source,['status','--porcelain']),'');
 assert.deepEqual(await recoveryContext(),c,'Recovery evidence changed during verification');
 await handoff(bundle,join(root,'.verification/handoff'),source,{selection:recoverySelection(c),recovery:{candidate:c.id,originalRun:c.originalRun,controlCommit:c.controlCommit}});
}
async function main(){
 const command=process.argv[2];assert(['resolve','verify'].includes(command));const c=await recoveryContext();
 await mkdir('.verification',{recursive:true});await writeFile('.verification/resolved-recovery.json',JSON.stringify(c,null,2)+'\n');
 if(command==='verify')await verifyOriginal(c);
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`run=${c.runId}\ncommit=${c.commit}\n`);
 if(command==='verify'){const m=JSON.parse(await readFile('.verification/handoff/release.json','utf8'));assertRecoveryBundle(m,c);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error('Pre-stage recovery blocked: '+e.message);process.exitCode=1;});
