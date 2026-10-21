import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { summarizeDeployment, summarizePlacedDeployment, resolveDeploymentPlacements, deploymentPlacementHash, deploymentExecutionTarget, validateDeploymentReceipt, type DeploymentExecution, type DeploymentInventory, type DeploymentReceipt, type DeploymentResult, type DeploymentTarget } from '@alneas/eaos-server/platform'
import { readDeploymentPlacementConfig } from './deployment-placement-config'
import { createDeploymentPlan } from './deployment-plan'
import { readJson, safePath } from './index'

type BaseSummary=ReturnType<typeof summarizeDeployment>
type BasePlugin=BaseSummary['plugins'][number]
type PlacedSummary=ReturnType<typeof summarizePlacedDeployment>
/**
 * Deployment summary enriched with destination-specific adoption and task evidence.
 * @see {@link inspectDeploymentStatus} for the canonical usage example and runtime requirements.
 */
export type DeploymentStatusContribution=Omit<BaseSummary,'plugins'> & {
  
  /**
   * Plugin status summaries with optional destination adoption and per-task execution evidence.
   */
  plugins:Array<Omit<BasePlugin,'tasks'|'components'> & {
    /** False when this application has not adopted the plugin; omitted in summaries without placement selection. */
    selected?:boolean
    /** Optional hash binding adopted component assignments to destination/runtime configuration. */
    placementSha256?:string
    /** Per-task status extended with destination-specific adoption and execution evidence when placements are supplied. */
    tasks:Array<BasePlugin['tasks'][number] & {
    /** Whether this task belongs to an adopted component assignment; false excludes it from required remaining work. */
    adopted?:boolean;
    /** Optional artifact/destination execution summaries with independently bound status and evidence. */
    executions?:DeploymentExecution[]}>
    /** Declared components enriched with application adoption and assigned destination identities. */
    components:Array<BasePlugin['components'][number] & {
    /** Whether this application explicitly selects the component for deployment. */
    adopted?:boolean;
    /** Explicit destination IDs assigned to this component when placement-aware inspection is used. */
    destinationIds?:string[]}>
  }>
  
  /**
   * Optional explicit deployment destinations included by placement-aware status inspection.
   */
  destinations?:PlacedSummary['destinations']
  
  /**
   * Optional artifact-scoped task executions shared across destination summaries.
   */
  artifactExecutions?:PlacedSummary['artifactExecutions']
  
  /**
   * Whether declared destination placements are represented by verified status evidence.
   */
  placementCoverage?:'explicit'
}

/**
 * Summarize deployment task evidence after verifying its inventory and journal bindings.
 * @param inventories - Immutable deployment inventory paths to inspect.
 * @param options - Optional receipts, target and explicit placement bindings used to scope the summary.
 * @returns Contribution status summaries; missing evidence remains visibly incomplete.
 * @throws Rejects changed inventories, invalid evidence or incompatible placement/target bindings.
 * @remarks Inspection does not execute tasks or turn absent evidence into success.
 * @example
 * import { inspectDeploymentStatus } from '@alneas/eaos-cli/platform'
 * export function inspectRelease(inventory: string) { return inspectDeploymentStatus([inventory]) }
 */
export async function inspectDeploymentStatus(inventories: string[], options: { 
/**
 * Optional deployment evidence journal paths; omission leaves required work pending rather than assuming success.
 */
receipts?: string[]; 
/**
 * Optional exact environment/backend/database/tenant context used to select matching scoped evidence; placement-aware inspection derives database identity from destinations.
 */
target?: DeploymentTarget; 
/**
 * Optional workspace-relative application manifest path providing explicit placements and binding revisions; omitted uses unplaced evidence summaries.
 */
config?: string; 
/**
 * Root against which the optional placement config is resolved; defaults to process.cwd().
 */
projectRoot?: string } = {}) {
  const plan = await createDeploymentPlan(inventories)
  const receipts: DeploymentReceipt[] = []
  for (const path of options.receipts ?? []) {
    const { data } = await readJson(await safePath(dirname(resolve(path)), basename(path)))
    validateDeploymentReceipt(data)
    receipts.push(data)
  }
  const contributions:DeploymentStatusContribution[] = []
  const placement=options.config?await readDeploymentPlacementConfig(options.projectRoot??process.cwd(),options.config):undefined
  const verified:DeploymentInventory[]=[]
  for (const contribution of plan.contributions) {
    const bytes = await readFile(contribution.artifact)
    // Bind reporting to the exact inventory whose assets were verified, including during concurrent edits.
    if (createHash('sha256').update(bytes).digest('hex') !== contribution.inventorySha256) throw new Error('Inventory changed during inspection')
    const inventory=JSON.parse(bytes.toString()) as DeploymentInventory
    verified.push(inventory)
    contributions.push(placement?summarizePlacedDeployment(inventory,contribution.inventorySha256,receipts,placement.placements,options.target,placement.bindings):summarizeDeployment(inventory, contribution.inventorySha256, receipts, options.target))
  }
  if(placement)resolveDeploymentPlacements(placement.placements,verified)
  return { mode: 'status-only', complete: contributions.length > 0 && contributions.every(contribution => contribution.complete), contributions }
}

/**
 * Render deployment completeness and optional remaining-task details as a Markdown report.
 * @param status - Verified status from inspectDeploymentStatus.
 * @param options - remaining omits already succeeded work from detailed task sections.
 * @returns Markdown status text with table cells escaped.
 * @throws Malformed caller-supplied status objects can fail during rendering.
 * @remarks Rendering is presentation only; it neither revalidates evidence nor performs an operation.
 * @example
 * import { renderDeploymentStatusMarkdown } from '@alneas/eaos-cli/platform'
 * import { inspectDeploymentStatus } from '@alneas/eaos-cli/platform/deployment-status'
 * export async function report(inventory: string) { return renderDeploymentStatusMarkdown(await inspectDeploymentStatus([inventory]), { remaining: true }) }
 */
export function renderDeploymentStatusMarkdown(status: Awaited<ReturnType<typeof inspectDeploymentStatus>>, options: { 
/**
 * When true, omit succeeded work from detailed sections; false/omitted includes all task states.
 */
remaining?: boolean; 
/**
 * Plugin view by default; destination requires placement-aware status with destinations and shared artifact executions.
 */
view?: 'plugin'|'destination' } = {}) {
  const cell = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ')
  const lines = ['# プラグイン作業状況', '', '運用者が記録した証拠の集計です。環境適用やテナント有効化は実行しません。', '']
  for (const contribution of status.contributions) {
    lines.push(`## ${cell(contribution.owner)}`, '', `台帳SHA-256: ${contribution.inventorySha256}`, '')
    lines.push(contribution.target ? `対象: ${cell(JSON.stringify(contribution.target))}` : '環境・テナントの対象未指定。環境設定・DB適用・有効化・受入は、対象を指定して証拠を記録するまで未完了です。', '')
    if(!contribution.artifactResolved)lines.push('配布物の参照が未解決です。source宣言への成功記録だけでは配布完了になりません。','')
    if (contribution.coverage === 'legacy-unclassified') lines.push('未分類の台帳です。構成・必要作業の宣言が必要です。', '')
    for (const ignored of contribution.ignoredReceipts) lines.push(`除外した記録: ${cell(ignored.owner)} (${ignored.reason})`, '')
    if(options.view==='destination') {
      if(!contribution.destinations||!contribution.artifactExecutions)throw Error('Destination view requires --config with deployment.placements')
      lines.push('### 共有artifact作業', '', '| プラグイン | 作業 | 状態 | 証拠 |', '| --- | --- | --- | --- |')
      for(const execution of contribution.artifactExecutions) {
        if(options.remaining&&execution.status==='succeeded')continue
        lines.push(`| ${cell(execution.pluginId)} | ${cell(execution.taskId)} | ${execution.status} | ${cell(execution.result?.evidence.join(', ')??'')} |`)
      }
      for(const destination of contribution.destinations) {
        const remaining=destination.executions.filter(e=>e.status!=='succeeded')
        lines.push('',`### 配置先: ${cell(destination.id)}`,'',`${cell(destination.placement)} / ${cell(destination.service??destination.reference??`${destination.backendId}/${destination.databaseId}`)}; 必須残 ${remaining.filter(e=>e.required).length} / 全残 ${remaining.length}`,'','| プラグイン | 作業 | 状態 | scope | 構成要素 | 依存待ち | 実施内容・証拠 |','| --- | --- | --- | --- | --- | --- | --- |')
        if(!destination.executions.length)lines.push('採用componentの割当なし（この配置先は未使用）。','')
        for(const execution of destination.executions) {
          if(options.remaining&&execution.status==='succeeded')continue
          const task=contribution.plugins.find(p=>p.id===execution.pluginId)!.tasks.find(t=>t.id===execution.taskId)!
          const waiting=execution.dependencies.filter(d=>contribution.plugins.find(p=>p.id===execution.pluginId)!.tasks.find(t=>t.id===d.taskId)?.executions?.find(e=>e.destinationId===d.destinationId)?.status!=='succeeded').map(d=>`${d.taskId}@${d.destinationId??'artifact'}`)
          const detail=[task.executor,task.argv?.join(' '),task.instructions,...(execution.result?.evidence??[])].filter(Boolean).join('; ')
          lines.push(`| ${cell(execution.pluginId)} | ${cell(execution.taskId)} | ${execution.status} | ${task.scope} | ${cell(execution.componentIds.join(', '))} | ${cell(execution.status==='blocked'?waiting.join(', '):'')} | ${cell(detail)} |`)
        }
      }
      continue
    }
    lines.push('| プラグイン | artifact成功/全件 | 必須の残作業 | 任意の残作業 | 必須作業の完了 |', '| --- | --- | --- | --- | --- |')
    for (const plugin of contribution.plugins) {
      if(plugin.selected===false){lines.push(`| ${cell(plugin.id)} | — | — | — | このアプリでは未採用 |`);continue}
      const artifacts = plugin.tasks.filter(task => task.scope === 'artifact')
      const remaining = plugin.tasks.filter(task=>task.adopted!==false).flatMap<{status:string;required:boolean}>(task=>task.executions??[task]).filter(task=>task.status!=='succeeded')
      lines.push(`| ${cell(plugin.id)} | ${artifacts.filter(task => task.status === 'succeeded').length}/${artifacts.length} | ${remaining.filter(task => task.required).length} | ${remaining.filter(task => !task.required).length} | ${plugin.complete ? '完了' : '未完了'}${plugin.artifactResolved ? '' : ' (配布未解決)'} |`)
    }
    for (const plugin of contribution.plugins) {
      if(plugin.selected===false)continue
      if(plugin.selected!==undefined) {
        lines.push('',`### ${cell(plugin.id)}`,'',`未採用の任意component: ${plugin.components.filter(c=>c.adopted===false).map(c=>cell(c.id)).join(', ')||'なし'}`,'','| 作業 | 状態 | scope | 必須 | 配置先 | 構成要素 | 依存先 | 実施内容・証拠 |','| --- | --- | --- | --- | --- | --- | --- | --- |')
        for(const task of plugin.tasks) {
          if(!task.executions||!task.adopted)continue
          for(const execution of task.executions) {
            if(options.remaining&&execution.status==='succeeded')continue
            const detail=[task.executor,task.argv?.join(' '),task.instructions,...(execution.result?.evidence??[])].filter(Boolean).join('; ')
            lines.push(`| ${cell(task.id)} | ${execution.status} | ${task.scope} | ${execution.required?'必須':'任意'} | ${cell(execution.destinationId??'共有artifact')} | ${cell(execution.componentIds.join(', '))} | ${cell(execution.dependencies.map(d=>`${d.taskId}@${d.destinationId??'artifact'}`).join(', '))} | ${cell(detail)} |`)
          }
        }
        continue
      }
      lines.push('', `### ${cell(plugin.id)}`, '', '| 作業 | 状態 | scope | 必須 | 構成要素 | 依存待ち | 実施内容・証拠 |', '| --- | --- | --- | --- | --- | --- | --- |')
      for (const task of plugin.tasks) {
        if (options.remaining && task.status === 'succeeded') continue
        const waiting = task.dependsOn.filter(id => plugin.tasks.find(dependency => dependency.id === id)?.status !== 'succeeded')
        const detail = task.status === 'succeeded' ? task.result?.evidence.join(', ') ?? '' : [task.executor, task.argv?.join(' '), task.instructions].filter(Boolean).join('; ')
        lines.push(`| ${cell(task.id)} | ${task.status} | ${task.scope} | ${task.required ? '必須' : '任意・採用時'} | ${cell(task.componentIds.join(', '))} | ${cell(waiting.join(', '))} | ${cell(detail)} |`)
      }
    }
  }
  return lines.join('\n') + '\n'
}

/**
 * Append reviewed deployment evidence under an exclusive journal writer lock without executing its task.
 * @param root - Trusted workspace root used to validate the receipt path.
 * @param options - Inventory, relative receipt path and actual observed result; placement-bound work also supplies config/destination.
 * @returns The receipt path, recorded result and executed=false.
 * @throws Rejects changed artifacts, wrong release/target/placement evidence, immutable-asset receipt paths, existing writer locks, oversized journals and filesystem errors.
 * @remarks The host supplies truthful evidence. Writes a temporary journal then renames it; no task, migration or tenant activation runs.
 * @example
 * import { recordDeploymentResult } from '@alneas/eaos-cli/platform'
 * export function appendEvidence(root: string, options: Parameters<typeof recordDeploymentResult>[1]) { return recordDeploymentResult(root, options) }
 */
export async function recordDeploymentResult(root: string, options: 

{ 
/**
 * Path to the immutable deployment inventory whose owner, asset hashes and task declaration bind this result.
 */
inventory: string; 
/**
 * Workspace-relative mutable evidence journal path; must remain separate from the immutable inventory and packaged assets.
 */
receipt: string; 
/**
 * Truthful host/operator-observed task result with actor, timestamp, evidence and required scope; recording does not execute or independently verify its task.
 */
result: DeploymentResult; 
/**
 * Optional workspace-relative application manifest supplying reviewed placements; required for destination-bound evidence.
 */
config?: string; 
/**
 * Optional destination ID assigned to this nonartifact task; requires config with compatible explicit placements.
 */
destination?: string }) {
  root = await realpath(resolve(root))
  const plan = await createDeploymentPlan([options.inventory]), contribution = plan.contributions[0]
  const bytes = await readFile(contribution.artifact)
  if (createHash('sha256').update(bytes).digest('hex') !== contribution.inventorySha256) throw new Error('Inventory changed during recording')
  const inventory = JSON.parse(bytes.toString()) as DeploymentInventory
  if (!inventory.plugins) throw new Error('Declare deployment plugins/tasks before recording results')
  if (inventory.plugins.some(plugin => plugin.components.some(component => component.assetPatterns?.length))) throw new Error('Package the source deployment declaration before recording artifact-bound results')
  let result=options.result
  const placement=options.config?await readDeploymentPlacementConfig(root,options.config):undefined
  const plugin=inventory.plugins.find(p=>p.id===result.pluginId), task=plugin?.tasks.find(t=>t.id===result.taskId)
  if(placement) {
    resolveDeploymentPlacements({...placement.placements,plugins:placement.placements.plugins.filter(p=>p.owner===inventory.owner)},[inventory])
    if(task?.scope==='artifact') {
      if(options.destination||result.destinationId||result.placementSha256)throw Error('Artifact evidence is shared; do not select a destination')
    } else {
      const destination=placement.placements.destinations.find(d=>d.id===options.destination)
      const selection=placement.placements.plugins.find(p=>p.owner===inventory.owner&&p.pluginId===result.pluginId)
      if(!task||!destination||!selection||!task.componentIds.some(c=>selection.components[c].includes(destination.id)))throw Error('Task is not assigned to this destination')
      const target=deploymentExecutionTarget(destination,task.scope,result.target)
      if(!target)throw Error('Placement work requires its environment and, for tenant work, tenant')
      if(result.target?.backendId&&result.target.backendId!==target.backendId||result.target?.databaseId&&result.target.databaseId!==target.databaseId)throw Error('Database identity differs from the assigned destination')
      if(task.scope==='environment'&&result.target?.tenantId)throw Error('Environment work cannot select a tenant')
      const digest=deploymentPlacementHash(placement.placements,inventory.owner,result.pluginId,placement.bindings)
      if(result.destinationId&&result.destinationId!==destination.id||result.placementSha256&&result.placementSha256!==digest)throw Error('Placement evidence binding differs')
      result={...result,target,destinationId:destination.id,placementSha256:digest}
    }
  } else if(options.destination||result.destinationId||result.placementSha256)throw Error('Destination evidence requires --config with deployment.placements')
  const path = await safePath(root, options.receipt), lock = await safePath(root, options.receipt + '.lock')
  if (path === contribution.artifact || inventory.assets.some(asset => resolve(dirname(contribution.artifact), asset.path) === path)) throw new Error('Store completion records separately from immutable deployment artifacts')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(lock, 'deployment receipt writer\n', { flag: 'wx' })
  const temp = await safePath(root, options.receipt + '.' + randomUUID() + '.tmp')
  try {
    let receipt: DeploymentReceipt = { apiVersion: 1, owner: inventory.owner, inventorySha256: contribution.inventorySha256, results: [] }
    const present = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error })
    if (present) {
      const { data } = await readJson(path)
      validateDeploymentReceipt(data)
      if (data.owner !== receipt.owner || data.inventorySha256 !== receipt.inventorySha256) throw new Error('Receipt belongs to another release; use a new receipt file')
      receipt = data
    }
    receipt = { ...receipt, results: [...receipt.results, result] }
    validateDeploymentReceipt(receipt)
    if(placement)summarizePlacedDeployment(inventory,contribution.inventorySha256,[receipt],placement.placements,result.target?{environment:result.target.environment,...(result.target.tenantId?{tenantId:result.target.tenantId}:{})}:undefined,placement.bindings)
    else summarizeDeployment(inventory, contribution.inventorySha256, [receipt], result.target)
    const content = JSON.stringify(receipt, null, 2) + '\n'
    if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('Deployment receipt exceeds 1 MiB; start a new journal')
    await writeFile(temp, content, { flag: 'wx' })
    await rename(temp, path)
    return { receipt: path, recorded: result, executed: false }
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    await unlink(lock)
  }
}
