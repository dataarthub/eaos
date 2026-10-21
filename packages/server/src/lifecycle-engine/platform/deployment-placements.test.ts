import { expect, test } from 'bun:test'
import { deploymentPlacementHash, resolveDeploymentPlacements, summarizePlacedDeployment, type DeploymentPlacements } from './deployment-placements'
import { summarizeDeployment, type DeploymentResult, type DeploymentReceipt } from './deployment'
import type { DeploymentInventory } from './artifacts'

const hash='a'.repeat(64)
export function placementFixture() {
 const inventory:DeploymentInventory={apiVersion:1,owner:'product',lifecycleBundle:['notes'],functions:[],assets:[],plugins:[{id:'notes',components:[
  {id:'ui',kind:'frontend',placement:'host'}, {id:'api',kind:'api',placement:'host'}, {id:'db',kind:'database',placement:'database'}, {id:'native',kind:'native',placement:'native',required:false},
 ],tasks:[
  {id:'build',componentIds:['ui','api','db'],action:'build',scope:'artifact',required:true,dependsOn:[],executor:'build'},
  {id:'migrate',componentIds:['db'],action:'migrate',scope:'environment',required:true,dependsOn:['build'],executor:'migrate'},
  {id:'deploy',componentIds:['ui','api'],action:'deploy',scope:'environment',required:true,dependsOn:['migrate'],executor:'deploy'},
  {id:'verify',componentIds:['ui','api','db'],action:'verify',scope:'tenant',required:true,dependsOn:['deploy'],executor:'verify'},
  {id:'native-test',componentIds:['native'],action:'test',scope:'artifact',required:false,dependsOn:['build'],executor:'native-test'},
  {id:'native-config',componentIds:['native'],action:'configure',scope:'environment',required:false,dependsOn:['native-test'],executor:'native-config'},
 ]}]}
 const placements:DeploymentPlacements={destinations:[
  {id:'web',placement:'host',service:'frontend',revision:'1'}, {id:'api',placement:'host',service:'backend',revision:'1'},
  {id:'db',placement:'database',backendId:'shared',databaseId:'local',revision:'1'}, {id:'native',placement:'native',reference:'host:python',revision:'1'},
 ],plugins:[{owner:'product',pluginId:'notes',components:{ui:['web'],api:['api'],db:['db'],native:[]}}]}
 const result=(taskId:string,destinationId:string|undefined,time:number):DeploymentResult=>({pluginId:'notes',taskId,status:'succeeded',actor:'fixture',recordedAt:new Date(time*1000).toISOString(),evidence:['fixture:offline'],...(destinationId?{destinationId,placementSha256:deploymentPlacementHash(placements,'product','notes'),target:{environment:'staging',...(destinationId==='db'?{backendId:'shared',databaseId:'local'}:{}),...(taskId==='verify'?{tenantId:'a'}:{})}}:{})})
 const receipt=(results:DeploymentResult[]):DeploymentReceipt=>({apiVersion:1,owner:'product',inventorySha256:hash,results})
 const completed=()=>[result('build',undefined,1),result('migrate','db',2),result('deploy','web',3),result('deploy','api',4),result('verify','web',5),result('verify','api',6),result('verify','db',7)]
 return {inventory,placements,result,receipt,completed}
}
test('one execution graph keeps frontend/backend/DB completion independent and artifact evidence shared',()=>{
 const f=placementFixture(), context={environment:'staging',tenantId:'a'}
 const partial=summarizePlacedDeployment(f.inventory,hash,[f.receipt(f.completed().slice(0,3))],f.placements,context)
 expect(partial.plugins[0].tasks.find(t=>t.id==='deploy')!.status).toBe('pending')
 expect(partial.plugins[0].tasks.find(t=>t.id==='verify')!.executions.every(e=>e.status==='blocked')).toBe(true)
 expect(partial.artifactExecutions.filter(e=>e.taskId==='build')).toHaveLength(1)
 expect(partial.destinations.flatMap(d=>d.executions).some(e=>e.taskId==='build')).toBe(false)
 const full=summarizePlacedDeployment(f.inventory,hash,[f.receipt(f.completed())],f.placements,context)
 expect(full.complete).toBe(true)
 expect(full.destinations.find(d=>d.id==='db')!.executions.find(e=>e.taskId==='migrate')!.target).toEqual({environment:'staging',backendId:'shared',databaseId:'local'})
 expect(full.plugins[0].components.find(c=>c.id==='native')!.adopted).toBe(false)
 expect(summarizePlacedDeployment(f.inventory,hash,[f.receipt(f.completed())],f.placements,{environment:'staging',tenantId:'b'}).complete).toBe(false)
 expect(summarizeDeployment(f.inventory,hash,[f.receipt(f.completed())],context).complete).toBe(false)
})
test('binding moves, host revisions and reexecution invalidate only placed evidence; unrelated placements do not',()=>{
 const f=placementFixture(), receipts=[f.receipt(f.completed())], context={environment:'staging',tenantId:'a'}
 const oldHash=deploymentPlacementHash(f.placements,'product','notes')
 f.placements.destinations.find(d=>d.id==='native')!.revision='unrelated'
 expect(deploymentPlacementHash(f.placements,'product','notes')).toBe(oldHash)
 f.placements.destinations.find(d=>d.id==='api')!.revision='new-host'
 const moved=summarizePlacedDeployment(f.inventory,hash,receipts,f.placements,context)
 expect(moved.complete).toBe(false)
 expect(moved.plugins[0].tasks[0].status).toBe('succeeded')
 expect(moved.plugins[0].tasks.find(t=>t.id==='migrate')!.status).toBe('stale')
 expect(moved.ignoredReceipts.some(r=>r.reason==='stale-placement')).toBe(true)
 expect(deploymentPlacementHash(f.placements,'product','notes',{api:'a'})).not.toBe(deploymentPlacementHash(f.placements,'product','notes',{api:'b'}))
 const again=f.completed();again.push(f.result('migrate','db',20))
 const stale=summarizePlacedDeployment(f.inventory,hash,[f.receipt(again)],f.placements,context)
 expect(stale.plugins[0].tasks.find(t=>t.id==='deploy')!.status).toBe('stale')
})
test('explicit adoption, strict references, compatible destinations and source coverage are required',()=>{
 const f=placementFixture()
 expect(resolveDeploymentPlacements(f.placements,[f.inventory])).toHaveLength(4)
 const check=(edit:(p:DeploymentPlacements)=>void)=>{const p=structuredClone(f.placements);edit(p);expect(()=>resolveDeploymentPlacements(p,[f.inventory])).toThrow()}
 check(p=>{delete p.plugins[0].components.api})
 check(p=>{p.plugins[0].components.api=[]})
 check(p=>{p.plugins[0].components.ui=['api']})
 check(p=>{p.plugins[0].components.db=['web']})
 check(p=>{p.plugins[0].components.api=['missing']})
 check(p=>{p.plugins[0].pluginId='missing'})
 check(p=>{p.plugins[0].owner='another'})
 check(p=>{p.destinations.push({...p.destinations[0]})})
 const receipts=[f.receipt(f.completed())]
 f.placements.plugins[0].components.native=['native']
 expect(summarizePlacedDeployment(f.inventory,hash,receipts,f.placements,{environment:'staging',tenantId:'a'}).complete).toBe(false)
 const unselected=summarizePlacedDeployment(f.inventory,hash,receipts,{...f.placements,plugins:[]})
 expect(unselected.plugins[0].selected).toBe(false)
 expect(unselected.destinations.every(d=>d.executions.length===0)).toBe(true)
})
