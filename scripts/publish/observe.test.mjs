import test from 'node:test'
import assert from 'node:assert/strict'
import {observeApproval,assertObserverEvent,assertObserverContext,requestCompletionOnce} from './observe.mjs'
const manifest={artifacts:[{name:'@alneas/eaos-core',version:'0.2.0',integrity:'sha512-reviewed'}]}
test('matching approved bytes dispatch once and HTTP 204 requires no JSON',async()=>{
 let dispatched=0,rechecked=0
 assert.equal(await observeApproval(manifest,{readVersion:async()=>({name:'@alneas/eaos-core',version:'0.2.0',dist:{integrity:'sha512-reviewed'}}),verifyArtifact:async()=>{},revalidate:async()=>rechecked++,dispatch:async()=>{dispatched++}}),'completion-requested')
 assert.equal(dispatched,1);assert.equal(rechecked,1)
})
test('pending approval has bounded monotonic deadline and never dispatches',async()=>{
 let time=0,writes=0
 assert.equal(await observeApproval(manifest,{now:()=>time,sleep:async d=>{time+=d},timeout:50,interval:20,readVersion:async()=>null,dispatch:async()=>writes++}),'approval-pending')
 assert.equal(writes,0);assert.equal(time,50)
})
test('identity/content changes, expired evidence and ambiguous dispatch never retry',async()=>{
 for(const version of [{name:'wrong',version:'0.2.0',dist:{integrity:'sha512-reviewed'}},{name:'@alneas/eaos-core',version:'0.2.0',dist:{integrity:'wrong'}}])await assert.rejects(observeApproval(manifest,{readVersion:async()=>version}))
 let writes=0
 const good={readVersion:async()=>({name:'@alneas/eaos-core',version:'0.2.0',dist:{integrity:'sha512-reviewed'}}),verifyArtifact:async()=>{},revalidate:async()=>{}}
 await assert.rejects(observeApproval(manifest,{...good,revalidate:async()=>{throw Error('expired')},dispatch:async()=>writes++}));assert.equal(writes,0)
 await assert.rejects(observeApproval(manifest,{...good,dispatch:async()=>{writes++;throw Error('ambiguous')}}));assert.equal(writes,1)
})
test('observer rejects completion loops, forks, failed and unrelated workflows',()=>{
 const event={workflow_run:{id:123,event:'release',conclusion:'success',path:'.github/workflows/publish.yml',head_repository:{full_name:'dataarthub/eaos'}}}
 assert.equal(assertObserverEvent(event),123)
 for(const x of [{event:'workflow_dispatch'},{conclusion:'failure'},{path:'.github/workflows/quality.yml'},{head_repository:{full_name:'fork/eaos'}}])assert.throws(()=>assertObserverEvent({workflow_run:{...event.workflow_run,...x}}))
})
test('observer reruns cannot retry an ambiguous dispatch; existing completion is detected',async()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'dataarthub/eaos',GITHUB_EVENT_NAME:'workflow_run',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:'dataarthub/eaos/.github/workflows/complete-approved.yml@refs/heads/main'}
 assert.doesNotThrow(()=>assertObserverContext(env))
 assert.throws(()=>assertObserverContext({...env,GITHUB_RUN_ATTEMPT:'2'}))
 let writes=0
 const evidence={runId:123,createdAt:'2026-10-21T00:00:00Z'}
 const existing={event:'workflow_dispatch',path:'.github/workflows/publish.yml',head_branch:'main',head_repository:{full_name:'dataarthub/eaos'},display_title:'Complete npm staging run 123'}
 assert.equal(await requestCompletionOnce(evidence,{request:async(path,options)=>{if(options?.method==='POST')writes++;return {total_count:1,workflow_runs:[existing]}}}),'completion-already-requested')
 assert.equal(writes,0)
 assert.equal(await requestCompletionOnce(evidence,{request:async(path,options)=>{if(options?.method==='POST'){writes++;return null}return {total_count:0,workflow_runs:[]}}}),'completion-requested')
 assert.equal(writes,1)
})
