import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {readBundle,sourceTarget,verifyBundleIdentity,registry} from './bundle.mjs'
import {releaseContext,assertReleaseSelection} from './context.mjs'
import {resolveStagingRun,assertCompletionContext} from './evidence.mjs'
import {assertWriteEnvironment,npm,npmWriteArgs,executeStage,executeRelease,publicJson,failureState} from './engine.mjs'
import {verifyArtifact} from './registry.mjs'
import {recordDeployments} from './deployments.mjs'
import {recoveryContext,assertRecoveryBundle} from './recovery.mjs'
let releaseStep='resolve-original-evidence'
async function main(){
 const phase=process.argv[2];assert(['stage','recover-stage','complete'].includes(phase));assertWriteEnvironment(process.env,phase)
 const root=resolve(import.meta.dirname,'../..'),directory=resolve('.verification/handoff')
 let manifest,evidence,target,recovery
 if(phase==='recover-stage'){
  recovery=await recoveryContext();manifest=JSON.parse(await readFile(join(directory,'release.json'),'utf8'))
  target=sourceTarget(root,recovery.commit,recovery.tag)
  await verifyBundleIdentity(manifest,{directory,expectedCommit:recovery.commit,targets:[target]});assertRecoveryBundle(manifest,recovery)
 }else if(phase==='stage'){
  const selection=releaseContext({root});manifest=await readBundle(directory,root)
  assertReleaseSelection(manifest,selection);target=sourceTarget(root,selection.commit,selection.tag)
  assert.deepEqual(manifest.staging,{runId:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT)})
 }else{
  assertCompletionContext(process.env);evidence=await resolveStagingRun(process.env.STAGED_RUN)
  assert.deepEqual(evidence,JSON.parse(await readFile('.verification/resolved-release.json','utf8')),'Original evidence changed')
  manifest=JSON.parse(await readFile(join(directory,'release.json'),'utf8'));target=sourceTarget(root,evidence.commit,evidence.release.tag)
  await verifyBundleIdentity(manifest,{directory,expectedCommit:evidence.commit,targets:[target]})
  assertReleaseSelection(manifest,evidence);assert.deepEqual(manifest.staging,{runId:evidence.runId,attempt:evidence.attempt})
  assert.deepEqual(manifest.recovery,evidence.recovery,'Recovery producer metadata differs')
 }
 assert.equal(npm(['--version']).trim(),'11.21.0','Use reviewed OIDC npm CLI');assert.equal(process.versions.node.split('.')[0],'24')
 const options={readState:(name,timeout)=>publicJson(encodeURIComponent(name),timeout),verifyArtifact,checkPrerequisite:async()=>{
  const deps={...target.meta.dependencies,...target.meta.peerDependencies,...target.meta.optionalDependencies}
  for(const [name,range] of Object.entries(deps)){
   const version=JSON.parse(npm(['view',name+'@'+range,'version','--json','--registry='+registry]))
   assert((Array.isArray(version)?version:[version]).some(v=>typeof v==='string'),'Public dependency unavailable: '+name)
  }
 },write:async(action,artifact,tag)=>{
  assertWriteEnvironment(process.env,phase)
  if(evidence)assert.deepEqual(await resolveStagingRun(process.env.STAGED_RUN),evidence,'Original evidence changed before write')
  if(recovery){assert.deepEqual(await recoveryContext(),recovery,'Recovery changed before write');assertRecoveryBundle(manifest,recovery)}
  npm(npmWriteArgs(action,artifact,tag,directory,process.env.RELEASE_REPOSITORY_PRIVATE))
  console.log(`${action}: ${artifact.name}@${artifact.version} (${tag})`)
 }}
 releaseStep=phase==='complete'?'verify-approved-bytes-and-channels':'submit-staging'
 if(phase==='stage'||phase==='recover-stage')await executeStage(manifest,options)
 else{await executeRelease(manifest,options);releaseStep='record-original-source-deployment';await recordDeployments(manifest)}
 console.log(phase!=='complete'?'Staging submitted; human npm approval required.':'Public bytes, consumer channels and original-SHA Deployment verified.')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error('Release step: '+releaseStep+'; state: '+failureState(e)+'. Stop writes and inspect evidence/public registry before retrying.');process.exitCode=1})
