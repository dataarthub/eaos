// Read-only observer: no npm credentials, OIDC, approval or registry writes.
import assert from 'node:assert/strict'
import {readFile,appendFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {resolveStagingRun,githubRequest} from './evidence.mjs'
import {verifyBundleIdentity,sourceTarget} from './bundle.mjs'
import {assertReleaseSelection} from './context.mjs'
import {readVersion,verifyArtifact} from './registry.mjs'
export function assertObserverEvent(event){
 const r=event?.workflow_run
 assert(r?.event==='release'&&r.conclusion==='success'&&r.path==='.github/workflows/publish.yml'&&r.head_repository?.full_name==='dataarthub/eaos','Untrusted observer event')
 assert(Number.isSafeInteger(r.id)&&r.id>0);return r.id
}
export function assertObserverContext(env){
 assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY==='dataarthub/eaos'&&env.GITHUB_EVENT_NAME==='workflow_run')
 assert.equal(env.GITHUB_WORKFLOW_REF,'dataarthub/eaos/.github/workflows/complete-approved.yml@refs/heads/main')
 assert.equal(env.GITHUB_RUN_ATTEMPT,'1','Observer reruns cannot retry a possibly accepted dispatch; inspect Actions and use completion-only recovery')
}
export async function requestCompletionOnce(evidence,{request=githubRequest}={}){
 assert(Number.isSafeInteger(evidence.runId)&&evidence.runId>0&&Number.isFinite(Date.parse(evidence.createdAt)))
 const query=new URLSearchParams({event:'workflow_dispatch',branch:'main',per_page:'100',created:'>='+evidence.createdAt})
 const listed=await request('/actions/workflows/publish.yml/runs?'+query)
 assert(listed.total_count<=100&&Array.isArray(listed.workflow_runs),'Completion history requires inspection')
 const title=`Complete npm staging run ${evidence.runId}`
 if(listed.workflow_runs.some(r=>r.event==='workflow_dispatch'&&r.path==='.github/workflows/publish.yml'&&r.head_branch==='main'&&r.head_repository?.full_name==='dataarthub/eaos'&&r.display_title===title))return 'completion-already-requested'
 await request('/actions/workflows/publish.yml/dispatches',{method:'POST',body:JSON.stringify({ref:'main',inputs:{staged_run:String(evidence.runId)}})})
 return 'completion-requested'
}
export async function observeApproval(manifest,{readVersion,verifyArtifact,revalidate,dispatch,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeout=1800000,interval=30000}){
 const deadline=now()+timeout
 while(now()<deadline){
  let ready=true
  for(const a of manifest.artifacts){
   const remaining=deadline-now();if(remaining<=0)return 'approval-pending'
   const v=await readVersion(a,remaining)
   if(v===null){ready=false;continue}
   assert(v.name===a.name&&v.version===a.version,'Wrong public package identity')
   assert.equal(v.dist?.integrity,a.integrity,'Approved content mismatch')
  }
  if(ready){
   for(const a of manifest.artifacts){const remaining=deadline-now();if(remaining<=0)return 'approval-pending';await verifyArtifact(a,remaining)}
   if(now()>=deadline)return 'approval-pending'
   await revalidate(deadline-now());if(now()>=deadline)return 'approval-pending'
   return await dispatch()??'completion-requested'
  }
  const remaining=deadline-now();if(remaining>0)await sleep(Math.min(interval,remaining))
 }
 return 'approval-pending'
}
async function main(){
 assertObserverContext(process.env)
 const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8')),id=assertObserverEvent(event)
 const evidence=await resolveStagingRun(id)
 assert.equal(evidence.attempt,event.workflow_run.run_attempt,'Observer event is a stale attempt')
 await writeFile('.verification/observed-release.json',JSON.stringify(evidence)+'\n')
 if(process.argv[2]==='resolve'){
  await appendFile(process.env.GITHUB_OUTPUT,`run=${evidence.runId}\nartifact=${evidence.artifactId}\n`);return
 }
 const directory=resolve('.verification/handoff'),root=resolve(import.meta.dirname,'../..')
 const manifest=JSON.parse(await readFile(join(directory,'release.json'),'utf8'))
 await verifyBundleIdentity(manifest,{directory,expectedCommit:evidence.commit,targets:[sourceTarget(root,evidence.commit,evidence.release.tag)]})
 assertReleaseSelection(manifest,evidence)
 assert.deepEqual(manifest.staging,{runId:evidence.runId,attempt:evidence.attempt})
 const state=await observeApproval(manifest,{readVersion,verifyArtifact,revalidate:async remaining=>{
  const end=performance.now()+remaining
  const request=(path,options)=>{const left=end-performance.now();assert(left>0,'Observation deadline');return githubRequest(path,{...options,timeoutMs:left})}
  assert.deepEqual(await resolveStagingRun(id,{request}),evidence,'Original evidence changed')
 },dispatch:()=>requestCompletionOnce(evidence)})
 console.log(state)
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`${state}: original staging run ${id}. If approval finishes later, complete publish.yml with staged_run=${id}; do not stage again.\n`)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Approval observation blocked; no automatic dispatch retry. Inspect original staging evidence.');process.exitCode=1})
