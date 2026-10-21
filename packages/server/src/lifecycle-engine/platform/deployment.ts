import type { DeploymentInventory } from './artifacts'

/**
 * Supported deployment capability categories used to validate component declarations.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export const deploymentComponentKinds = ['frontend', 'api', 'mcp', 'service', 'function', 'worker', 'job', 'webhook', 'workflow', 'database', 'infrastructure', 'storage', 'cache', 'queue', 'search', 'integration', 'native', 'model', 'data-import'] as const
/**
 * Supported declarative work phases; inspection never executes these actions.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export const deploymentActions = ['build', 'test', 'preview', 'provision', 'configure', 'migrate', 'deploy', 'verify', 'import', 'enable'] as const
/**
 * One declared deployable capability with explicit placement and nonsecret host requirements.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export interface DeploymentComponent {
  /**
   * Unique component ID within the plugin.
   */
  id: string
  /**
   * False marks an optional capability; omitted means required.
   * 
   * Optional provider/native capabilities remain visible without requiring every deployment to adopt them.
   */
  required?: boolean
  /**
   * Supported frontend/server/storage/compute capability category.
   */
  kind: typeof deploymentComponentKinds[number]
  /**
   * Declared host/container/function/database/cloud/native/external placement.
   */
  placement: 'host' | 'container' | 'function' | 'database' | 'cloud' | 'native' | 'external'
  /**
   * Optional runtime descriptor.
   */
  runtime?: string
  /**
   * Exact checksummed inventory asset references.
   * 
   * References to files in the checksummed inventory, not arbitrary source paths.
   */
  assets?: string[]
  /**
   * Author-side asset selectors resolved by packing; unresolved patterns prevent completion.
   * 
   * Author-side selectors resolved to exact assets by the packer; emitted inventories omit these.
   */
  assetPatterns?: string[]
  /**
   * Optional entry asset path.
   */
  entry?: string
  /**
   * Canonical schema contract IDs and semver ranges, never copied DDL.
   * 
   * Canonical contract IDs/ranges; no copied DDL.
   */
  dataContracts?: Record<string, string>
  /**
   * Optional required tool ranges and host binding/adapter names.
   */
  requirements?: { 
    /**
     * Tool-name to required-version/range map declared by the plugin.
     */
    tools?: Record<string, string>; 
    /**
     * Required nonsecret host binding names; never credential values.
     */
    bindings?: string[]; 
    /**
     * Required host adapter capability names.
     */
    adapters?: string[] }
}
/**
 * Declarative host-approved work and dependency ordering for deployment evidence.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export interface DeploymentTask {
  /**
   * Unique task ID within the plugin.
   */
  id: string
  /**
   * Existing components whose work this task covers.
   */
  componentIds: string[]
  /**
   * Supported build/test/provision/deploy/etc. phase.
   */
  action: typeof deploymentActions[number]
  /**
   * Artifact work is reusable; environment and tenant work require corresponding target evidence.
   */
  scope: 'artifact' | 'environment' | 'tenant'
  /**
   * Whether successful task evidence is required for completion.
   */
  required: boolean
  /**
   * Existing task IDs that must succeed before this task is considered unblocked.
   */
  dependsOn: string[]
  /**
   * Host-approved executor reference; inspection never launches it.
   * 
   * Host-approved executor reference. Inspection never executes it or argv.
   */
  executor: string
  /**
   * Optional declarative arguments; never automatically executed by inspection.
   */
  argv?: string[]
  /**
   * Optional human operator instructions.
   */
  instructions?: string
}
/**
 * Classified deployment component/task graph for one lifecycle feature.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export interface DeploymentPlugin {
  /**
   * Plugin ID covered by the inventory lifecycle bundle.
   */
  id: string;
  /**
   * Unique deployable capability definitions.
   */
  components: DeploymentComponent[];
  /**
   * Unique work definitions forming an acyclic dependency graph.
   */
  tasks: DeploymentTask[] }
/**
 * Nonsecret exact environment, physical placement and optional tenant context for scoped evidence.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export interface DeploymentTarget {
  /**
   * Nonblank deployment environment label.
   */
  environment: string;
  /**
   * Optional exact lifecycle backend ID; required for database work evidence.
   */
  backendId?: string;
  /**
   * Optional physical database identity; required with backendId for database evidence.
   */
  databaseId?: string;
  /**
   * Optional concrete tenant; required for tenant tasks and absent for environment tasks.
   */
  tenantId?: string }
/**
 * Reported execution evidence bound to a task, inventory and optional destination revision.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export interface DeploymentResult {
  /**
   * Declared inventory plugin ID.
   */
  pluginId: string
  /**
   * Declared plugin task ID.
   */
  taskId: string
  /**
   * Exact environment/tenant target; absent for artifact work.
   */
  target?: DeploymentTarget
  /**
   * Reported running/succeeded/failed result; no independent execution proof is implied.
   */
  status: 'running' | 'succeeded' | 'failed'
  /**
   * Exact UTC ISO timestamp including millisecond precision; increases per task/target/placement.
   */
  recordedAt: string
  /**
   * Nonblank host/operator identity reporting the result.
   */
  actor: string
  /**
   * Nonempty distinct nonsecret evidence references, such as reviewed logs or CI receipts.
   * 
   * Non-secret evidence references, such as a reviewed log, CI run or lifecycle plan receipt.
   */
  evidence: string[]
  /**
   * Optional explicit destination identity paired with placementSha256; forbidden for artifact results.
   * 
   * Environment/tenant evidence bound to a reviewed component placement. Artifact results remain reusable.
   */
  destinationId?: string
  /**
   * Hash of reviewed placement/binding revisions paired with destinationId.
   */
  placementSha256?: string
}
/**
 * Operator/host-owned reported evidence journal pinned to one inventory digest.
 * 
 * 
 * Host/operator-owned journal. This is reported evidence, never runtime admission authority.
 * @see summarizeDeployment for canonical integration usage.
 */
export interface DeploymentReceipt {
  /**
   * Receipt discriminator; currently 1.
   */
  apiVersion: 1
  /**
   * Exact inventory owner to which these results belong.
   */
  owner: string
  /**
   * Lowercase 64-character SHA-256 of the trusted inventory bytes.
   */
  inventorySha256: string
  /**
   * Reported task outcomes in increasing per-task/target/placement timestamp order.
   */
  results: DeploymentResult[]
}
/**
 * Derived task readiness: pending, dependency-blocked, stale evidence, running, succeeded or failed.
 * 
 * @see summarizeDeployment for canonical integration usage.
 */
export type DeploymentTaskStatus = 'pending' | 'blocked' | 'stale' | 'running' | 'succeeded' | 'failed'

function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function nonempty(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value === value.trim() }
function id(value: unknown): value is string { return nonempty(value) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) }
function strings(value: unknown, allowEmpty = true): value is string[] { return Array.isArray(value) && (allowEmpty || !!value.length) && value.every(nonempty) && new Set(value).size === value.length }
function fields(value: object, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown deployment declaration field') }
function mapping(value: unknown) { return object(value) && Object.entries(value).every(([key, v]) => nonempty(key) && nonempty(v)) }
function targetKey(target?: DeploymentTarget) { return JSON.stringify([target?.environment ?? null, target?.backendId ?? null, target?.databaseId ?? null, target?.tenantId ?? null]) }

/**
 * Validates declared plugin component references and task dependencies before artifact inspection.
 * 
 * Validate references and the dependency DAG before artifact registration or status inspection.
 * @param inventory - Deployment inventory with checksummed asset metadata and optional per-plugin work declarations.
 * @returns The original plugin array, or undefined for legacy inventories without plugin declarations.
 * @throws Error for invalid/duplicate declarations, unsupported component/action/scope, unknown references, cycles or missing required work.
 * 
 * @remarks
 * Requires explicit lifecycle-bundle coverage, known assets/components, acyclic dependencies and work for adopted components. This validates declarations without executing tasks or proving artifact file checksums.
 * 
 * @example
 * ```typescript
 * import { validateDeploymentPlugins, type DeploymentInventory } from '@alneas/eaos-server/platform';
 * export function inspectDeclaration(inventory: DeploymentInventory) { return validateDeploymentPlugins(inventory); }
 * ```
 */
export function validateDeploymentPlugins(inventory: DeploymentInventory): DeploymentPlugin[] | undefined {
  if (inventory.plugins === undefined) return undefined
  if (!Array.isArray(inventory.plugins) || !inventory.plugins.length || !strings(inventory.lifecycleBundle, false)
    || inventory.plugins.length !== inventory.lifecycleBundle.length) throw new Error('Deployment plugins must cover the lifecycle bundle')
  const pluginIds = new Set<string>(), assets = new Set(inventory.assets.map(asset => asset.path))
  for (const plugin of inventory.plugins) {
    if (!object(plugin) || !id(plugin.id) || pluginIds.has(plugin.id) || !inventory.lifecycleBundle.includes(plugin.id)
      || !Array.isArray(plugin.components) || !Array.isArray(plugin.tasks)) throw new Error('Invalid or duplicate deployment plugin')
    fields(plugin, ['id', 'components', 'tasks'])
    pluginIds.add(plugin.id)
    const components = new Set<string>(), tasks = new Map<string, DeploymentTask>()
    for (const component of plugin.components) {
      if (!object(component) || !id(component.id) || components.has(component.id) || !deploymentComponentKinds.includes(component.kind)
        || (component.required !== undefined && typeof component.required !== 'boolean')
        || !['host', 'container', 'function', 'database', 'cloud', 'native', 'external'].includes(component.placement)
        || (component.runtime !== undefined && !nonempty(component.runtime))
        || (component.assets !== undefined && (!strings(component.assets) || component.assets.some(path => !assets.has(path))))
        || (component.assetPatterns !== undefined && (!strings(component.assetPatterns, false) || component.assetPatterns.some(pattern => pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').some(part => !part || part === '.' || part === '..'))))
        || (component.entry !== undefined && (!nonempty(component.entry) || !assets.has(component.entry)))
        || (component.dataContracts !== undefined && !mapping(component.dataContracts))) throw new Error('Invalid deployment component or unverified asset reference')
      fields(component, ['id', 'kind', 'required', 'placement', 'runtime', 'assets', 'assetPatterns', 'entry', 'dataContracts', 'requirements'])
      if (component.requirements !== undefined) {
        const req = component.requirements
        if (!object(req) || (req.tools !== undefined && !mapping(req.tools)) || (req.bindings !== undefined && (!strings(req.bindings) || req.bindings.some(key => !/^[A-Z][A-Z0-9_]*$/.test(key))))
          || (req.adapters !== undefined && !strings(req.adapters))) throw new Error('Invalid deployment requirements; declare references, not secret values')
        fields(req, ['tools', 'bindings', 'adapters'])
      }
      components.add(component.id)
    }
    for (const task of plugin.tasks) {
      if (!object(task) || !id(task.id) || tasks.has(task.id) || !strings(task.componentIds, false) || task.componentIds.some(ref => !components.has(ref))
        || !deploymentActions.includes(task.action) || !['artifact', 'environment', 'tenant'].includes(task.scope) || typeof task.required !== 'boolean'
        || !strings(task.dependsOn) || !nonempty(task.executor) || (task.argv !== undefined && (!Array.isArray(task.argv) || !task.argv.length || task.argv.some(arg => typeof arg !== 'string')))
        || (task.instructions !== undefined && !nonempty(task.instructions))) throw new Error('Invalid deployment task or component reference')
      fields(task, ['id', 'componentIds', 'action', 'scope', 'required', 'dependsOn', 'executor', 'argv', 'instructions'])
      if (task.scope === 'artifact' && !['build', 'test', 'verify'].includes(task.action)) throw new Error('Environment-changing work cannot have artifact scope')
      tasks.set(task.id, task)
    }
    const visiting = new Set<string>(), visited = new Set<string>(), scopeRank = { artifact: 0, environment: 1, tenant: 2 }
    const visit = (task: DeploymentTask) => {
      if (visiting.has(task.id)) throw new Error('Cyclic deployment task dependency')
      if (visited.has(task.id)) return
      visiting.add(task.id)
      for (const ref of task.dependsOn) {
        const dependency = tasks.get(ref)
        if (!dependency) throw new Error('Unknown deployment task dependency')
        if (scopeRank[dependency.scope] > scopeRank[task.scope]) throw new Error('Deployment dependency has a narrower target scope')
        visit(dependency)
      }
      visiting.delete(task.id); visited.add(task.id)
    }
    for (const task of tasks.values()) visit(task)
    if (plugin.components.some(component => !plugin.tasks.some(task => (component.required === false || task.required) && task.componentIds.includes(component.id)))) throw new Error('Every required deployment component requires at least one required task; optional components still require declared work')
    if (!components.size && tasks.size) throw new Error('Tasks require deployment components')
  }
  return inventory.plugins
}

/**
 * Validates the exact nonsecret environment/backend/database/tenant target shape.
 * @param value - Untrusted target object with a nonblank environment and optional nonblank identity references.
 * @returns Completes without a value and narrows the input to DeploymentTarget.
 * @throws Error for missing/blank identity fields or unknown target properties.
 * 
 * @remarks
 * Does not resolve backend existence, tenant membership or deployment authority.
 * 
 * @example
 * ```typescript
 * import { validateDeploymentTarget } from '@alneas/eaos-server/platform/deployment';
 * const target: unknown = { environment: 'review' };
 * validateDeploymentTarget(target);
 * ```
 */
export function validateDeploymentTarget(value: unknown): asserts value is DeploymentTarget {
  if (!object(value) || !nonempty(value.environment) || ['backendId', 'databaseId', 'tenantId'].some(key => value[key] !== undefined && !nonempty(value[key]))) throw new Error('Invalid deployment target')
  fields(value, ['environment', 'backendId', 'databaseId', 'tenantId'])
}
/**
 * Validates version-1 reported task evidence and strictly increasing timestamps per task/target/placement.
 * @param value - Untrusted receipt with owner, pinned inventory SHA-256 and task result records.
 * @returns Completes without a value and narrows the input to DeploymentReceipt.
 * @throws Error for malformed/extra fields, invalid hashes/timestamps, missing evidence or nonincreasing repeated-result timestamps.
 * 
 * @remarks
 * Each result needs a UTC millisecond ISO timestamp, actor and nonempty distinct evidence references. destinationId and placementSha256 must occur together. This validates shape/order only; it does not independently verify evidence or grant runtime admission.
 * 
 * @example
 * ```typescript
 * import { validateDeploymentReceipt } from '@alneas/eaos-server/platform/deployment';
 * const receipt: unknown = { apiVersion: 1, owner: 'reports', inventorySha256: 'a'.repeat(64), results: [] };
 * validateDeploymentReceipt(receipt);
 * ```
 */
export function validateDeploymentReceipt(value: unknown): asserts value is DeploymentReceipt {
  if (!object(value) || value.apiVersion !== 1 || !nonempty(value.owner) || typeof value.inventorySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.inventorySha256) || !Array.isArray(value.results)) throw new Error('Invalid deployment receipt')
  fields(value, ['apiVersion', 'owner', 'inventorySha256', 'results'])
  const times = new Map<string, number>()
  for (const result of value.results) {
    if (!object(result) || !id(result.pluginId) || !id(result.taskId) || !['running', 'succeeded', 'failed'].includes(result.status)
      || !nonempty(result.actor) || !strings(result.evidence, false) || !nonempty(result.recordedAt)
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(result.recordedAt) || !Number.isFinite(Date.parse(result.recordedAt))
      || new Date(result.recordedAt).toISOString() !== result.recordedAt) throw new Error('Invalid deployment result; actor, timestamp and evidence are required')
    fields(result, ['pluginId', 'taskId', 'target', 'status', 'recordedAt', 'actor', 'evidence', 'destinationId', 'placementSha256'])
    if ((result.destinationId === undefined) !== (result.placementSha256 === undefined) || (result.destinationId !== undefined && (!id(result.destinationId) || !/^[a-f0-9]{64}$/.test(result.placementSha256!)))) throw Error('Placement evidence requires destinationId and placementSha256')
    if (result.target !== undefined) validateDeploymentTarget(result.target)
    const key = JSON.stringify([result.pluginId, result.taskId, targetKey(result.target), result.destinationId ?? null, result.placementSha256 ?? null])
    const time = Date.parse(result.recordedAt)
    if (time <= (times.get(key) ?? -Infinity)) throw new Error('Deployment result timestamps must increase for each task/target')
    times.set(key, time)
  }
}
function taskTarget(task: DeploymentTask, target?: DeploymentTarget): DeploymentTarget | undefined {
  if (task.scope === 'artifact') return undefined
  if (!target || (task.scope === 'tenant' && !target.tenantId)) return undefined
  const { tenantId: _tenantId, ...environment } = target
  return task.scope === 'tenant' ? target : environment
}

/**
 * Aggregates host/operator task evidence into dependency-aware plugin and component completion states.
 * 
 * Aggregate operator/host evidence only. A build receipt cannot complete DB/infra/deployment tasks.
 * @param inventory - Validated artifact declaration; missing plugins remains legacy-unclassified.
 * @param inventorySha256 - Trusted lowercase 64-character inventory digest.
 * @param receipts - Reported receipts; defaults to none.
 * @param target - Optional current environment/backend/database/tenant context for scoped work.
 * @returns A read-only summary with coverage, artifact resolution, task states and ignored owner/stale-inventory/placement receipts.
 * @throws Error for invalid declarations/receipts/hash/target, undeclared tasks, scope mismatch or conflicting equal-time evidence.
 * 
 * @remarks
 * No task executes. Artifact work is reusable; environment/tenant evidence must match scope and database work needs explicit backend/database identities. Newer dependency evidence makes older success stale. Completion is host-reported evidence, never admission authority.
 * 
 * @example
 * ```typescript
 * import { summarizeDeployment, type DeploymentInventory, type DeploymentReceipt, type DeploymentTarget } from '@alneas/eaos-server/platform';
 * export function inspect(inventory: DeploymentInventory, digest: string, receipts: DeploymentReceipt[], target?: DeploymentTarget) { return summarizeDeployment(inventory, digest, receipts, target); }
 * ```
 */
export function summarizeDeployment(inventory: DeploymentInventory, inventorySha256: string, receipts: DeploymentReceipt[] = [], target?: DeploymentTarget) {
  if (!/^[a-f0-9]{64}$/.test(inventorySha256)) throw new Error('Invalid inventory SHA-256')
  const plugins = validateDeploymentPlugins(inventory)
  if (target !== undefined) validateDeploymentTarget(target)
  const results = new Map<string, DeploymentResult>(), ignoredReceipts: Array<{ owner: string; reason: string }> = []
  for (const receipt of receipts) {
    validateDeploymentReceipt(receipt)
    if (receipt.owner !== inventory.owner || receipt.inventorySha256 !== inventorySha256) {
      ignoredReceipts.push({ owner: receipt.owner, reason: receipt.owner !== inventory.owner ? 'different-owner' : 'stale-inventory' }); continue
    }
    for (const result of receipt.results) {
      const task = plugins?.find(plugin => plugin.id === result.pluginId)?.tasks.find(task => task.id === result.taskId)
      if (!task) throw new Error('Receipt references an undeclared deployment task')
      if (result.destinationId !== undefined) {
        if (task.scope === 'artifact') throw Error('Artifact evidence must not be bound to a destination')
        ignoredReceipts.push({ owner: receipt.owner, reason: 'placement-context-required' }); continue
      }
      if ((task.scope === 'artifact' && result.target !== undefined) || (task.scope !== 'artifact' && !result.target)
        || (task.scope === 'environment' && result.target?.tenantId !== undefined) || (task.scope === 'tenant' && !result.target?.tenantId)) throw new Error('Receipt target does not match task scope')
      const plugin = plugins!.find(plugin => plugin.id === result.pluginId)!
      if (task.scope !== 'artifact' && plugin.components.some(component => component.kind === 'database' && task.componentIds.includes(component.id))
        && (!result.target?.backendId || !result.target.databaseId)) throw new Error('Database work requires explicit backendId and databaseId evidence')
      const expected = taskTarget(task, target)
      if ((task.scope !== 'artifact' && !expected) || targetKey(result.target) !== targetKey(expected)) continue
      const key = JSON.stringify([result.pluginId, result.taskId]), old = results.get(key)
      if (old && old.recordedAt === result.recordedAt && JSON.stringify(old) !== JSON.stringify(result)) throw new Error('Conflicting deployment results at the same timestamp')
      if (!old || old.recordedAt < result.recordedAt) results.set(key, result)
    }
  }
  const summaries = (plugins ?? []).map(plugin => {
    const artifactResolved = !plugin.components.some(component => component.assetPatterns?.length)
    const states = new Map<string, { status: DeploymentTaskStatus; result?: DeploymentResult }>()
    const status = (task: DeploymentTask): { status: DeploymentTaskStatus; result?: DeploymentResult } => {
      const known = states.get(task.id)
      if (known) return known
      const result = results.get(JSON.stringify([plugin.id, task.id]))
      const dependencies = task.dependsOn.map(ref => status(plugin.tasks.find(task => task.id === ref)!))
      const blocked = dependencies.some(dependency => dependency.status !== 'succeeded')
      const stale = result?.status === 'succeeded' && dependencies.some(dependency => dependency.result && dependency.result.recordedAt > result.recordedAt)
      const state = { status: (blocked ? 'blocked' : stale ? 'stale' : result?.status ?? 'pending') as DeploymentTaskStatus, result }
      states.set(task.id, state); return state
    }
    const tasks = plugin.tasks.map(task => ({ ...task, ...status(task) }))
    return { id: plugin.id, artifactResolved, complete: artifactResolved && tasks.filter(task => task.required).every(task => task.status === 'succeeded'),
      components: plugin.components.map(component => ({ ...component, complete: artifactResolved && tasks.filter(task => (component.required === false || task.required) && task.componentIds.includes(component.id)).every(task => task.status === 'succeeded') })), tasks }
  })
  return { owner: inventory.owner, inventorySha256, target, coverage: plugins ? 'declared' as const : 'legacy-unclassified' as const,
    artifactResolved: !!plugins && summaries.every(plugin => plugin.artifactResolved), complete: !!plugins && summaries.every(plugin => plugin.complete), plugins: summaries, ignoredReceipts,
    evidencePolicy: 'Operator/host-reported evidence; not independent verification or runtime authorization' }
}
