import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { inspectDeploymentStatus, recordDeploymentResult, renderDeploymentStatusMarkdown } from './deployment-status'
import { generatePlatform } from './index'
import { resolveManifest } from './render'
import type { DeploymentInventory, DeploymentPlacements } from '@alneas/eaos-server/platform'

function placementFixture() {
 const inventory:DeploymentInventory={apiVersion:1,owner:'product',lifecycleBundle:['notes'],functions:[],assets:[],plugins:[{id:'notes',components:[
  {id:'ui',kind:'frontend',placement:'host'}, {id:'api',kind:'api',placement:'host'}, {id:'db',kind:'database',placement:'database'}, {id:'native',kind:'native',placement:'native',required:false},
 ],tasks:[
  {id:'build',componentIds:['ui','api','db'],action:'build',scope:'artifact',required:true,dependsOn:[],executor:'build'},
  {id:'migrate',componentIds:['db'],action:'migrate',scope:'environment',required:true,dependsOn:['build'],executor:'migrate'},
  {id:'deploy',componentIds:['ui','api'],action:'deploy',scope:'environment',required:true,dependsOn:['migrate'],executor:'deploy'},
  {id:'verify',componentIds:['ui','api','db'],action:'verify',scope:'tenant',required:true,dependsOn:['deploy'],executor:'verify'},
  {id:'native-config',componentIds:['native'],action:'configure',scope:'environment',required:false,dependsOn:['build'],executor:'native-config'},
 ]}]}
 const placements:DeploymentPlacements={destinations:[{id:'web',placement:'host',service:'frontend',revision:'1'},{id:'api',placement:'host',service:'backend',revision:'1'},{id:'db',placement:'database',backendId:'shared',databaseId:'local',revision:'1'},{id:'native',placement:'native',reference:'host:python',revision:'1'}],plugins:[{owner:'product',pluginId:'notes',components:{ui:['web'],api:['api'],db:['db'],native:[]}}]}
 return {inventory,placements}
}

test('application config drives both views and recording binds each destination without executing its assets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-placement-status-')), f=placementFixture()
 try {
  const code='throw Error("must not execute this artifact")'
  await writeFile(join(root,'index.js'),code)
  f.inventory.runtime='index.js';f.inventory.assets=[{path:'index.js',sha256:createHash('sha256').update(code).digest('hex')}]
  const inventory=join(root,'deployment.json'), journal='receipts/placement.json'
  await writeFile(inventory,JSON.stringify(f.inventory))
  const manifest={platform:{appName:'placement-test',baseDomain:'example.test'},runtime:{backend:{id:'shared',databaseId:'local',dialect:'sqlite',mode:'shared'}},deployment:{images:{backend:'example/api:1',frontend:'example/ui:1'},placements:f.placements}}
  const save=()=>writeFile(join(root,'eaos.platform.json'),JSON.stringify(manifest))
  await save()
  const config={config:'eaos.platform.json',projectRoot:root,receipts:[join(root,journal)],target:{environment:'staging',tenantId:'a'}}
  const record=async(taskId:string,destination:string|undefined,time:number)=>recordDeploymentResult(root,{inventory,receipt:journal,config:'eaos.platform.json',destination,result:{pluginId:'notes',taskId,status:'succeeded',actor:'fixture',recordedAt:new Date(time*1000).toISOString(),evidence:['fixture:no-deploy'],...(taskId==='build'?{}:{target:{environment:'staging',...(taskId==='verify'?{tenantId:'a'}:{})}})}})
  await expect(record('build','web',1)).rejects.toThrow('shared')
  await record('build',undefined,1)
  const db=await record('migrate','db',2)
  expect(db.executed).toBe(false)
  expect(db.recorded.target).toEqual({environment:'staging',backendId:'shared',databaseId:'local'})
  expect(db.recorded.placementSha256).toMatch(/^[a-f0-9]{64}$/)
  await expect(recordDeploymentResult(root,{inventory,receipt:journal,config:'eaos.platform.json',destination:'db',result:{...db.recorded,recordedAt:new Date(9000).toISOString(),target:{environment:'staging',backendId:'shared',databaseId:'wrong'}}})).rejects.toThrow('differs')
  await expect(record('deploy','native',3)).rejects.toThrow('not assigned')
  await record('deploy','web',3)
  const partial=await inspectDeploymentStatus([inventory],config)
  expect(partial.complete).toBe(false)
  expect(renderDeploymentStatusMarkdown(partial,{view:'destination',remaining:true})).toContain('配置先: api')
  expect(renderDeploymentStatusMarkdown(partial,{remaining:true})).toContain('| deploy | pending | environment | 必須 | api |')
  await record('deploy','api',4)
  for(const [i,destination] of ['web','api','db'].entries())await record('verify',destination,5+i)
  expect((await inspectDeploymentStatus([inventory],config)).complete).toBe(true)
  expect((await inspectDeploymentStatus([inventory],{receipts:config.receipts,target:config.target})).complete).toBe(false)
  manifest.deployment.images.backend='example/api:2'
  await save()
  const moved=await inspectDeploymentStatus([inventory],config)
  expect(moved.complete).toBe(false)
  expect(moved.contributions[0].plugins[0].tasks[0].status).toBe('succeeded')
  expect(moved.contributions[0].ignoredReceipts.some(r=>r.reason==='stale-placement')).toBe(true)
  await expect(record('migrate','api',10)).rejects.toThrow('not assigned')
 }finally{await rm(root,{recursive:true,force:true})}
})

test('Platform generation validates assignments from registered inventories and protects generated plans',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-placement-generate-')), f=placementFixture()
 try {
  const code='throw Error("generation must not import contributions")'
  await writeFile(join(root,'index.js'),code)
  f.inventory.runtime='index.js';f.inventory.assets=[{path:'index.js',sha256:createHash('sha256').update(code).digest('hex')}]
  await writeFile(join(root,'deployment.json'),JSON.stringify(f.inventory))
  const manifest={platform:{appName:'placement-test',baseDomain:'example.test'},packages:[{id:'product',inventory:'deployment.json',module:'index.js',tenantIds:['a'],pluginIds:['notes']}],runtime:{backend:{id:'shared',databaseId:'local',dialect:'sqlite',mode:'shared'}},deployment:{images:{backend:'example/api:1',frontend:'example/ui:1'},placements:f.placements}}
  await writeFile(join(root,'eaos.platform.json'),JSON.stringify(manifest))
  await generatePlatform(root)
  const plan=JSON.parse(await readFile(join(root,'.eaos/generated/platform/deployment-placements.json'),'utf8'))
  expect(plan.components).toHaveLength(4)
  expect((await generatePlatform(root,{check:true})).status).toBe('current')
  await writeFile(join(root,'.eaos/generated/platform/deployment-placements.json'),'edited')
  await expect(generatePlatform(root)).rejects.toThrow('edited')
  f.placements.plugins[0].components.api=['missing']
  await writeFile(join(root,'eaos.platform.json'),JSON.stringify(manifest))
  await expect(generatePlatform(root,{check:true})).rejects.toThrow('destination')
  f.placements.plugins[0].components.api=['api']
  const invalid=structuredClone(manifest);invalid.deployment.placements.destinations.find(d=>d.id==='db')!.databaseId='other'
  expect(()=>resolveManifest(invalid)).toThrow('runtime target')
  const dedicated=resolveManifest({...manifest,runtime:{backend:{id:'shared',databaseId:'local',dialect:'sqlite',mode:'dedicated',tenantId:'a'}}})
  expect(dedicated.deployment.placements!.destinations.find(d=>d.id==='db')!.tenantId).toBe('a')
 }finally{await rm(root,{recursive:true,force:true})}
})
