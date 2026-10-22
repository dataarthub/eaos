import { readFile,writeFile,mkdir,rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join,resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runGuarded } from './guarded-process.mjs'
import { sourceHash } from './source-state.mjs'
import { withVerificationLock } from './verification-state.mjs'
const root=resolve(import.meta.dirname,'..'),kind=process.argv[2]
if(!['quality','consumer'].includes(kind))throw Error('Expected quality or consumer')
const selected=kind==='quality'&&process.argv.includes('--selected')?(await import('./workflow-supply/public/quality.mjs')).readSelectedPlan(root):null
const bundle=kind==='consumer'?resolve(process.argv[3]??''):null
await withVerificationLock(root,kind,async()=>{
const receipt=join(root,'.verification',kind+'-latest.json'),runId=randomUUID()
await mkdir(join(root,'.verification'),{recursive:true})
const initial={runId,status:'running',sourceHash:await sourceHash(root),startedAt:new Date().toISOString()}
await writeFile(receipt,JSON.stringify(initial,null,2)+'\n')
if(kind==='quality')await rm(join(root,'.verification/quality.json'),{force:true})
else {
  const file=join(bundle,'bundle.json'),manifest=JSON.parse(await readFile(file,'utf8'))
  manifest.consumerVerified=false
  await writeFile(file,JSON.stringify(manifest,null,2)+'\n')
}
const budget=kind==='quality'?{memoryLimitMiB:6144,timeoutMs:1200000}:{memoryLimitMiB:3072,timeoutMs:600000}
let guard={ok:false,reason:'Invocation did not finish'}
try {
  // These regressions each own a bounded process group; do not nest containment preloads.
  if(kind==='quality') {
    const tests=spawnSync(process.execPath,['--test','scripts/guarded-process.test.mjs'],{cwd:root,stdio:'inherit',timeout:60000})
    if(tests.status!==0)throw Error('Resource guard regressions failed')
  }
  guard=await runGuarded(process.execPath,[join(root,'scripts',kind==='quality'?'quality.mjs':'test-consumer.mjs'),...(bundle?[bundle]:[]),...(selected?['--selected',JSON.stringify({...selected.packageImpact,baseline:selected.baseline,provenance:selected.provenance,sourceInput:selected.sourceInput})]:[])],{cwd:root,env:{...process.env,EAOS_VERIFICATION_RUN:runId},...budget})
  if(!guard.ok)throw Error(guard.reason??`Verification exited with ${guard.code}`)
  if(await sourceHash(root)!==initial.sourceHash)throw Error('Source changed during guarded invocation')
  if(kind==='consumer') {
    const file=join(bundle,'bundle.json'),manifest=JSON.parse(await readFile(file,'utf8'))
    const result=JSON.parse(await readFile(join(bundle,'consumer-result.json'),'utf8'))
    if(result.runId!==runId || result.sourceHash!==initial.sourceHash)throw Error('Consumer result belongs to a different invocation')
    manifest.consumerVerified={...result,guard:{...guard,...budget,concurrency:1}}
    await writeFile(file,JSON.stringify(manifest,null,2)+'\n')
  }
  await writeFile(receipt,JSON.stringify({...initial,status:'passed',guard:{...guard,...budget,concurrency:1},completedAt:new Date().toISOString()},null,2)+'\n')
  console.log(`${kind}: passed; process-tree peak ${guard.peakMiB}/${budget.memoryLimitMiB} MiB, deadline ${budget.timeoutMs} ms, concurrency 1`)
} catch(error) {
  await writeFile(receipt,JSON.stringify({...initial,status:'failed',guard:{...guard,...budget,concurrency:1},error:error.message,completedAt:new Date().toISOString()},null,2)+'\n')
  if(kind==='quality')await rm(join(root,'.verification/quality.json'),{force:true})
  console.error(error.message)
  process.exitCode=1
}
})
