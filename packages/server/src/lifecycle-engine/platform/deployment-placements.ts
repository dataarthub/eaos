import { canonicalJsonHash } from '@alneas/eaos-core/serialization'
import type { DeploymentInventory } from './artifacts'
import { summarizeDeployment, validateDeploymentPlugins, validateDeploymentReceipt, validateDeploymentTarget, type DeploymentComponent, type DeploymentResult, type DeploymentReceipt, type DeploymentTarget, type DeploymentTaskStatus } from './deployment'

/**
 * Explicit existing host service/resource or physical database destination with a binding revision.
 * 
 * @see summarizePlacedDeployment for canonical integration usage.
 */
export interface DeploymentDestination {
  /**
   * Unique destination identifier.
   */
  id: string
  /**
   * Host/container/function/database/cloud/native/external destination category.
   */
  placement: DeploymentComponent['placement']
  /**
   * Optional symbolic existing frontend/backend/worker role; host/container only.
   * 
   * Symbolic role of an existing Platform service.
   */
  service?: 'frontend' | 'backend' | 'worker'
  /**
   * Optional nonsecret host resource/operation binding; never credentials or executable code.
   * 
   * Host-owned resource/operation binding reference, never credentials or an executable command.
   */
  reference?: string
  /**
   * Required existing backend ID for database destinations; forbidden otherwise.
   */
  backendId?: string
  /**
   * Required exact physical database identity for database destinations.
   */
  databaseId?: string
  /**
   * Optional dedicated concrete tenant restriction; database destinations only.
   * 
   * Restrict a dedicated DB destination to its verified tenant.
   */
  tenantId?: string
  /**
   * Nonblank host binding revision; change when wiring/provider/credential revision changes.
   * 
   * Change when the host binding changes, including a credential/provider revision.
   */
  revision: string
}
/**
 * Explicit plugin selection and destination assignments; empty lists deliberately decline optional components.
 * 
 * @see summarizePlacedDeployment for canonical integration usage.
 */
export interface DeploymentPlacements {
  /**
   * Unique nonsecret existing destination declarations.
   */
  destinations: DeploymentDestination[]
  /**
   * Selected owner/plugin pairs and complete component-ID to destination-ID lists; selection never registers/enables code.
   * 
   * Listing a plugin selects it for this application plan; this never registers or enables code.
   */
  plugins: Array<{
    /**
     * Exact inventory owner selecting this plugin.
     */
    owner: string; 
    /**
     * Plugin declared by that owner; listing it selects application placement only.
     */
    pluginId: string; 
    /**
     * Complete component-ID to destination-ID lists; empty declines only optional capabilities.
     */
    components: Record<string, string[]>}>
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v === v.trim()
const id = (v: unknown): v is string => text(v) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)
const keys = (v: object, allowed: string[]) => { if(Object.keys(v).some(k=>!allowed.includes(k))) throw Error('Unknown deployment placement field') }

/**
 * Validates nonsecret destination definitions and explicit component-to-destination selections.
 * 
 * Validate only non-secret declarations here; no service discovery, provisioning or code execution.
 * @param value - Untrusted destinations/plugins declaration.
 * @returns Completes without a value and narrows the input to DeploymentPlacements.
 * @throws Error for duplicate/unknown IDs, unknown fields, invalid placement kind, malformed host references or conflicting destination configuration.
 * 
 * @remarks
 * A database destination uses exact backend/database IDs; other destinations use exactly one symbolic service or host reference. Dedicated tenant restrictions apply only to database destinations. No discovery, provisioning or code execution occurs.
 * 
 * @example
 * ```typescript
 * import { validateDeploymentPlacements } from '@alneas/eaos-server/platform/deployment-placements';
 * const placements: unknown = { destinations: [], plugins: [] };
 * validateDeploymentPlacements(placements);
 * ```
 */
export function validateDeploymentPlacements(value: unknown): asserts value is DeploymentPlacements {
  if(!object(value) || !Array.isArray(value.destinations) || !Array.isArray(value.plugins)) throw Error('Invalid deployment placements')
  keys(value,['destinations','plugins'])
  const destinations = new Set<string>(), plugins = new Set<string>()
  for(const d of value.destinations) {
    if(!object(d) || !id(d.id) || destinations.has(d.id) || !['host','container','function','database','cloud','native','external'].includes(d.placement) || !text(d.revision)) throw Error('Invalid or duplicate deployment destination')
    keys(d,['id','placement','service','reference','backendId','databaseId','tenantId','revision'])
    if(d.tenantId!==undefined&&(!text(d.tenantId)||d.tenantId==='*'||d.placement!=='database'))throw Error('Tenant restriction requires a concrete database destination')
    if(d.service!==undefined && !['frontend','backend','worker'].includes(d.service)) throw Error('Unknown Platform service role')
    if(d.reference!==undefined && (!text(d.reference) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(d.reference))) throw Error('Use a non-secret host binding reference')
    if(d.placement==='database' ? (!text(d.backendId)||!text(d.databaseId)||d.service!==undefined||d.reference!==undefined) : (d.backendId!==undefined||d.databaseId!==undefined||!!d.service===!!d.reference)) throw Error('Destination requires an exact database or one service/resource reference')
    if(d.service && !['host','container'].includes(d.placement)) throw Error('Service destination must use host or container placement')
    destinations.add(d.id)
  }
  for(const p of value.plugins) {
    if(!object(p)||!text(p.owner)||!id(p.pluginId)||!object(p.components)||plugins.has(JSON.stringify([p.owner,p.pluginId]))) throw Error('Invalid or duplicate plugin placement')
    keys(p,['owner','pluginId','components']); plugins.add(JSON.stringify([p.owner,p.pluginId]))
    for(const [component,refs] of Object.entries(p.components)) if(!id(component)||!Array.isArray(refs)||new Set(refs).size!==refs.length||refs.some(ref=>!id(ref)||!destinations.has(ref))) throw Error('Invalid or unknown component destination')
  }
}

/**
 * Resolves each selected plugin component against explicit compatible deployment destinations.
 * 
 * All selected components are explicit; [] means an optional capability was deliberately not adopted.
 * @param placements - Validated explicit selections; every component must have a destination list.
 * @param inventories - Trusted inventories with unique owner IDs and declared plugin work.
 * @returns Component selections with copied destinationIds and adopted flags; an empty list deliberately declines an optional component.
 * @throws Error for unknown inventory/plugin/component/destination, duplicate owners, missing required placement, incompatible role/kind or declined dependency.
 * 
 * @remarks
 * Selecting a plugin does not register or enable it. Required components cannot be declined, and adopted work cannot depend on declined nonartifact work. A host component may target a container destination.
 * 
 * @example
 * ```typescript
 * import { resolveDeploymentPlacements } from '@alneas/eaos-server/platform/deployment-placements';
 * import type { DeploymentInventory } from '@alneas/eaos-server/platform/artifacts';
 * export function resolve(placements: Parameters<typeof resolveDeploymentPlacements>[0], inventories: DeploymentInventory[]) { return resolveDeploymentPlacements(placements, inventories); }
 * ```
 */
export function resolveDeploymentPlacements(placements: DeploymentPlacements, inventories: DeploymentInventory[]) {
  validateDeploymentPlacements(placements)
  const owners = new Set(inventories.map(inv=>inv.owner))
  if(owners.size!==inventories.length) throw Error('Duplicate placement inventory owner')
  for(const inventory of inventories) validateDeploymentPlugins(inventory)
  return placements.plugins.flatMap(selection=>{
    const inventory = inventories.find(inv=>inv.owner===selection.owner)
    const plugin = inventory?.plugins?.find(p=>p.id===selection.pluginId)
    if(!plugin) throw Error(`Unknown or unclassified selected plugin: ${selection.owner}/${selection.pluginId}`)
    if(Object.keys(selection.components).some(c=>!plugin.components.some(known=>known.id===c))) throw Error('Unknown selected component')
    for(const task of plugin.tasks) if(task.componentIds.some(c=>selection.components[c]?.length) && task.dependsOn.some(ref=>{
      const dep=plugin.tasks.find(t=>t.id===ref)!
      return dep.scope!=='artifact'&&!dep.componentIds.some(c=>selection.components[c]?.length)
    })) throw Error('Adopted task depends on an unadopted component')
    return plugin.components.map(component=>{
      if(!Object.hasOwn(selection.components,component.id)) throw Error(`Missing component placement: ${plugin.id}/${component.id}`)
      const destinationIds = selection.components[component.id]
      if(component.required!==false && !destinationIds.length) throw Error('Required component cannot be unadopted')
      for(const ref of destinationIds) {
        const d=placements.destinations.find(d=>d.id===ref)!
        if(component.placement!==d.placement && !(component.placement==='host' && d.placement==='container')) throw Error(`Incompatible component placement: ${plugin.id}/${component.id}`)
        if(d.service && ((component.kind==='frontend' && d.service!=='frontend') || (component.kind!=='frontend' && d.service==='frontend'))) throw Error('Frontend and server components require different service roles')
      }
      return {owner:inventory!.owner,pluginId:plugin.id,componentId:component.id,destinationIds:[...destinationIds],adopted:destinationIds.length>0}
    })
  })
}

/**
 * Hashes a selected plugin's normalized component destinations and host binding revisions.
 * @param placements - Previously validated placement declaration.
 * @param owner - Inventory owner selecting the plugin.
 * @param pluginId - Selected plugin ID.
 * @param bindings - Optional nonsecret destination-ID to host-binding revision map; defaults to none.
 * @returns A lowercase SHA-256 hash bound to selected components, referenced destinations and applicable binding revisions.
 * @throws Error when the owner/plugin selection is absent or canonical serialization fails.
 * 
 * @remarks
 * Order of component/destination maps is normalized. Change binding revisions when provider credentials or host wiring change so old scoped evidence becomes stale.
 * 
 * @example
 * ```typescript
 * import { deploymentPlacementHash, type DeploymentPlacements } from '@alneas/eaos-server/platform/deployment-placements';
 * export function bindingDigest(placements: DeploymentPlacements, owner: string, pluginId: string) { return deploymentPlacementHash(placements, owner, pluginId); }
 * ```
 */
export function deploymentPlacementHash(placements: DeploymentPlacements, owner: string, pluginId: string, bindings: Record<string,string> = {}) {
  const selection=placements.plugins.find(p=>p.owner===owner&&p.pluginId===pluginId)
  if(!selection) throw Error('Plugin is not selected in deployment placements')
  const components=Object.fromEntries(Object.entries(selection.components).sort(([a],[b])=>a.localeCompare(b)).map(([key,refs])=>[key,[...refs].sort()]))
  const ids=new Set(Object.values(components).flat())
  return canonicalJsonHash(JSON.parse(JSON.stringify({owner,pluginId,components,destinations:placements.destinations.filter(d=>ids.has(d.id)).sort((a,b)=>a.id.localeCompare(b.id)),bindings:Object.fromEntries([...ids].sort().filter(id=>bindings[id]!==undefined).map(id=>[id,bindings[id]]))})))
}

/**
 * Builds a scoped task target from a reviewed destination and the current inspection context.
 * @param destination - Validated destination with optional exact database and dedicated-tenant identities.
 * @param scope - Environment work omits tenant; tenant work requires a matching concrete tenant.
 * @param context - Current environment/tenant context; omitted cannot resolve a target.
 * @returns A new target object, or undefined for missing context/tenant or dedicated-tenant mismatch.
 * 
 * @remarks
 * Backend/database come from the destination, not the context. This performs no authority or resource-existence checks.
 * 
 * @example
 * ```typescript
 * import { deploymentExecutionTarget } from '@alneas/eaos-server/platform/deployment-placements';
 * const target = deploymentExecutionTarget({ id: 'web', placement: 'host', service: 'frontend', revision: '1' }, 'environment', { environment: 'review' });
 * ```
 */
export function deploymentExecutionTarget(destination: DeploymentDestination, scope: 'environment'|'tenant', context?: DeploymentTarget): DeploymentTarget | undefined {
  if(!context || scope==='tenant'&&!context.tenantId) return undefined
  if(scope==='tenant'&&destination.tenantId&&context.tenantId!==destination.tenantId)return undefined
  return {environment:context.environment,...(destination.backendId?{backendId:destination.backendId,databaseId:destination.databaseId}:{}),...(scope==='tenant'?{tenantId:context.tenantId}:{})}
}
/**
 * One task instance at an explicit destination or reusable artifact scope.
 * 
 * @see summarizePlacedDeployment for canonical integration usage.
 */
export interface DeploymentExecution {
  /**
   * Declared plugin task ID.
   */
  taskId: string
  /**
   * Scoped destination identity; absent for shared artifact work.
   */
  destinationId?: string
  /**
   * Adopted components covered at this destination.
   */
  componentIds: string[]
  /**
   * Whether this adopted execution must succeed for completion.
   */
  required: boolean
  /**
   * Dependency-aware derived task state.
   */
  status: DeploymentTaskStatus
  /**
   * Resolved environment/database/tenant evidence context, if available.
   */
  target?: DeploymentTarget
  /**
   * Latest matching reported result, if any.
   */
  result?: DeploymentResult
  /**
   * Prerequisite task/destination identities whose evidence must succeed first.
   */
  dependencies: Array<{
    /**
     * Prerequisite declared task ID.
     */
    taskId:string;
    /**
     * Prerequisite destination, absent for shared artifact work.
     */
    destinationId?:string}>
}
const targetKey=(v?:DeploymentTarget)=>canonicalJsonHash([v?.environment??null,v?.backendId??null,v?.databaseId??null,v?.tenantId??null])
const aggregate=(values:DeploymentTaskStatus[]):DeploymentTaskStatus=>values.includes('failed')?'failed':values.includes('blocked')?'blocked':values.includes('stale')?'stale':values.includes('running')?'running':values.every(v=>v==='succeeded')?'succeeded':'pending'

/**
 * Builds one placement-bound execution graph shared by plugin and destination evidence projections.
 * 
 * One execution graph powers both plugin and destination projections. Shared artifact work is never duplicated.
 * @param inventory - Trusted artifact inventory with declared plugin work.
 * @param inventorySha256 - Trusted lowercase inventory digest.
 * @param receipts - Reported task evidence, including placement-bound scoped results.
 * @param placements - Explicit compatible destination selections.
 * @param context - Optional environment and tenant only; backend/database must come from destinations.
 * @param bindings - Optional destination host-binding revisions; defaults to none.
 * @returns A deployment summary with selected/adopted components, task executions, destinations, artifact executions and explicit placement coverage.
 * @throws Error for invalid placements/context/receipts, undeclared tasks, mismatched task scope or conflicting equal-time evidence.
 * 
 * @remarks
 * Shared artifact work is not duplicated. Old binding hashes are ignored as stale; declined optional components do not satisfy adopted dependency work. No task executes, and reported completion does not grant runtime admission.
 * 
 * @example
 * ```typescript
 * import { summarizePlacedDeployment, type DeploymentPlacements } from '@alneas/eaos-server/platform/deployment-placements';
 * import type { DeploymentInventory, DeploymentReceipt } from '@alneas/eaos-server/platform';
 * export function inspectPlaced(inventory: DeploymentInventory, digest: string, receipts: DeploymentReceipt[], placements: DeploymentPlacements) { return summarizePlacedDeployment(inventory, digest, receipts, placements, { environment: 'review' }); }
 * ```
 */
export function summarizePlacedDeployment(inventory: DeploymentInventory, inventorySha256: string, receipts: DeploymentReceipt[], placements: DeploymentPlacements, context?: DeploymentTarget, bindings: Record<string,string> = {}) {
  resolveDeploymentPlacements({...placements,plugins:placements.plugins.filter(p=>p.owner===inventory.owner)},[inventory])
  if(context) {validateDeploymentTarget(context);if(context.backendId||context.databaseId)throw Error('With placements, backend/database come from destinations; specify only environment and tenant')}
  for(const receipt of receipts) validateDeploymentReceipt(receipt)
  const base=summarizeDeployment(inventory,inventorySha256,receipts,context)
  const ignoredReceipts=base.ignoredReceipts.filter(r=>r.reason!=='placement-context-required')
  const plugins=base.plugins.map(plugin=>{
    const selection=placements.plugins.find(p=>p.owner===inventory.owner&&p.pluginId===plugin.id)
    if(!selection) return {...plugin,selected:false,components:plugin.components.map(c=>({...c,adopted:false,destinationIds:[] as string[]})),tasks:plugin.tasks.map(t=>({...t,adopted:false,executions:[] as DeploymentExecution[]})),complete:false}
    const binding=deploymentPlacementHash(placements,inventory.owner,plugin.id,bindings)
    const active=(componentId:string)=>selection.components[componentId].length>0
    const instances=new Map<string,DeploymentExecution[]>()
    const results=new Map<string,DeploymentResult>(), stale=new Set<string>()
    for(const receipt of receipts) {
      if(receipt.owner!==inventory.owner||receipt.inventorySha256!==inventorySha256) continue
      for(const result of receipt.results.filter(r=>r.pluginId===plugin.id)) {
        const task=plugin.tasks.find(t=>t.id===result.taskId)
        if(!task) throw Error('Receipt references an undeclared placement task')
        if(task.scope==='artifact') {if(result.destinationId||result.target)throw Error('Artifact evidence cannot select a destination');continue}
        if(!result.target || task.scope==='tenant'&&!result.target.tenantId || task.scope==='environment'&&result.target.tenantId) throw Error('Receipt target does not match placement task scope')
        if(!result.destinationId) {ignoredReceipts.push({owner:receipt.owner,reason:'unbound-placement'});continue}
        const destination=placements.destinations.find(d=>d.id===result.destinationId)
        const expected=destination?deploymentExecutionTarget(destination,task.scope,context):undefined
        const key=JSON.stringify([task.id,result.destinationId])
        if(result.placementSha256!==binding || !destination || !task.componentIds.some(c=>selection.components[c].includes(result.destinationId!))) {
          ignoredReceipts.push({owner:receipt.owner,reason:'stale-placement'})
          if(context?.environment===result.target.environment && (task.scope==='environment'||context.tenantId===result.target.tenantId)) stale.add(key)
          continue
        }
        if(!expected || targetKey(expected)!==targetKey(result.target)) continue
        const old=results.get(key)
        if(old?.recordedAt===result.recordedAt && JSON.stringify(old)!==JSON.stringify(result)) throw Error('Conflicting placement results at the same timestamp')
        if(!old||old.recordedAt<result.recordedAt)results.set(key,result)
      }
    }
    const compile=(taskId:string):DeploymentExecution[]=>{
      const known=instances.get(taskId);if(known)return known
      const task=plugin.tasks.find(t=>t.id===taskId)!
      const dependencies=task.dependsOn.flatMap(compile)
      const adopted=task.componentIds.some(active)
      const required=task.required||task.componentIds.some(id=>active(id)&&plugin.components.find(c=>c.id===id)?.required===false)
      const refs=task.scope==='artifact'?[undefined]:[...new Set(task.componentIds.flatMap(c=>selection.components[c]))]
      const rows:DeploymentExecution[]=refs.map(destinationId=>{
        const destination=destinationId?placements.destinations.find(d=>d.id===destinationId)!:undefined
        const key=JSON.stringify([task.id,destinationId])
        const result=task.scope==='artifact'?task.result:results.get(key)
        const blocked=dependencies.some(d=>d.status!=='succeeded')
        const outdated=result?.status==='succeeded'&&dependencies.some(d=>d.result&&d.result.recordedAt>result.recordedAt)
        const status:DeploymentTaskStatus=blocked?'blocked':outdated||!result&&stale.has(key)?'stale':result?.status??'pending'
        return {taskId:task.id,destinationId,componentIds:task.componentIds.filter(c=>!destinationId||selection.components[c].includes(destinationId)),required:required&&(adopted||task.scope==='artifact'),status,result,target:destination?deploymentExecutionTarget(destination,task.scope as 'environment'|'tenant',context):undefined,dependencies:dependencies.map(d=>({taskId:d.taskId,destinationId:d.destinationId}))}
      })
      instances.set(taskId,rows);return rows
    }
    const tasks=plugin.tasks.map(task=>{const executions=compile(task.id);return {...task,adopted:task.scope==='artifact'||task.componentIds.some(active),required:executions.some(e=>e.required),status:executions.length?aggregate(executions.map(e=>e.status)):'pending' as DeploymentTaskStatus,executions}})
    return {...plugin,selected:true,placementSha256:binding,tasks,complete:plugin.artifactResolved&&tasks.filter(t=>t.adopted&&t.required).every(t=>t.status==='succeeded'),components:plugin.components.map(c=>({...c,adopted:active(c.id),destinationIds:selection.components[c.id],complete:active(c.id)&&plugin.artifactResolved&&tasks.filter(t=>t.componentIds.includes(c.id)&&t.adopted&&t.required).every(t=>t.status==='succeeded')}))}
  })
  const executions=plugins.flatMap(p=>p.tasks.flatMap(t=>t.executions.map(e=>({...e,pluginId:p.id,owner:inventory.owner}))))
  const destinations=placements.destinations.map(destination=>({...destination,executions:executions.filter(e=>e.destinationId===destination.id)}))
  return {...base,plugins,complete:base.artifactResolved&&plugins.filter(p=>p.selected).every(p=>p.complete),ignoredReceipts:[...new Map(ignoredReceipts.map(r=>[JSON.stringify([r.owner,r.reason]),r])).values()],placementCoverage:'explicit' as const,destinations,artifactExecutions:executions.filter(e=>!e.destinationId)}
}
