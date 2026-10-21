import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile, unlink, realpath, readdir, rename, lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginLifecycle, lifecycleDigest, rebaseDataContractBaseline, type DataContractBaseline, type LifecycleProject } from '@alneas/eaos-server/lifecycle-engine'
import { platformDatabaseTargets } from '@alneas/eaos-server/platform'
import { generatePlatform, readJson, safePath } from './index'
import { resolveProjectManifest } from './preset'
import { deployPlatformImage } from './deploy'

/**
 * Execution identity and reviewed input hash passed to trusted release callbacks; hosts must preserve these values.
 * @see {@link executePlatformOperation} for the canonical usage example and runtime requirements.
 */
export interface ReleaseContext { 
    /**
   * Canonical application root associated with the reviewed inputs.
   */
  root: string; 
    /**
   * Unique operation UUID shared by its steps and durable receipt.
   */
  id: string; 
    /**
   * SHA-256 binding the operation to its reviewed source, package and configuration inputs.
   */
  inputSha256: string }
/**
 * Trusted live host capabilities required to execute reviewed release/bootstrap operations.
 * @see {@link definePlatformOperations} for the canonical usage example and runtime requirements.
 */
export interface PlatformOperations {
  
    /**
   * Host operations contract format; must be 1.
   */
  formatVersion: 1
  
    /**
   * Nonblank host environment identity used to bind locks, journals and health checks.
   */
  environment: string
      /**
   * Hold an environment-wide exclusive lock across the awaited action; lock ownership and recovery are host responsibilities.
   * @typeParam T - Result produced by the action while the environment lock is held.
   * @param context - Reviewed release identity and input hash; the object is not frozen and must not be mutated.
   * @param action - Async host operation to await without releasing the exclusive environment lock.
   * @returns The action result after the host lock implementation completes.
   * @throws Host lock acquisition, action and cleanup failures propagate.
   * @remarks The host must release only its own lock and must not silently expire an interrupted writer.
   
   * @example
   * ```typescript
   * import type { PlatformOperations, ReleaseContext } from '@alneas/eaos-cli/platform';
   * export async function inspectLocked(operations: PlatformOperations, context: ReleaseContext) {
   *   return operations.withLock(context, async () => operations.lifecycle.store.read());
   * }
   * ```
   */
  withLock<T>(context: ReleaseContext, action: () => Promise<T>): Promise<T>
  
    /**
   * Real Lifecycle project with shared durable state, migration executors and current admission.
   */
  lifecycle: LifecycleProject
      /**
   * Explicit backend/tenant/plugin selections for reviewed release application; does not enable new tenants.
   */
  migrations: Array<{
    /** Registered backend ID matching the runtime/lifecycle target. */
    backendId: string
    /** Concrete verified tenant ID; wildcards are rejected. */
    tenantId: string
    /** Nonempty unique plugin IDs whose dependencies are migrated in order. */
    pluginIds: string[]
  }>
      /**
   * Optional live role deployment callback receiving immutable image/version/config and the current release context.
   */
  deploy?: (input: { 
/**
 * Current locked release context and retained operation identity for this deployment.
 */
context: ReleaseContext; 
/**
 * Reviewed worker, backend or frontend service selected for this live release step.
 */
role: 'worker' | 'backend' | 'frontend'; 
/**
 * Exact reviewed immutable application image reference for the selected role.
 */
image: string; 
/**
 * Reviewed image/deployment version passed to the host deploy adapter.
 */
version: string; 
/**
 * Generated role-specific deployment configuration path selected by the reviewed release plan.
 */
configFile: string }) => Promise<void>
  
    /**
   * Optional reviewed database baseline descriptors bound to their exact backend IDs.
   */
  baselines?: Array<{
    /** Declared migration backend whose database owns this baseline. */
    backendId: string
    /** Reviewed baseline whose target must match the lifecycle contract catalog. */
    baseline: DataContractBaseline
  }>
      /**
   * Role-specific readiness URLs whose release headers must match the requested deployed versions.
   */
  health: Array<{
    /** Deployed role; release requires exactly one endpoint for each selected role. */
    role: 'worker' | 'backend' | 'frontend'
    /** HTTPS or loopback HTTP URL without credentials/query/fragment; response x-eaos-release must match the selected version. */
    url: string
  }>
  
    /**
   * Optional real infrastructure, control-DB, identity and administrator-code capabilities required for bootstrap.
   */
  bootstrap?: {
    /** Optional host provisioning callback receiving reviewed context and explicit Pulumi stack; resolves with no value. Omission runs the local Pulumi project through the selected runner. */
    provisionInfrastructure?: (context: ReleaseContext, stack: string) => Promise<void>
    /**
     * Initializes the real host control database during bootstrap.
     * @param context - Reviewed operation identity and input hash.
     * @returns No value; resolves after host initialization.
     * @throws Host initialization errors stop bootstrap without undoing earlier stages.
     
     * @example
     * ```typescript
     * import type { PlatformOperations, ReleaseContext } from '@alneas/eaos-cli/platform';
     * export async function reviewedBootstrap(operations: PlatformOperations, context: ReleaseContext) {
     *   if (!operations.bootstrap) throw new Error("Real bootstrap capabilities required");
     *   // Invoke only after the host approves this operation and preceding stages.
     *   await operations.bootstrap.initializeControlDatabase(context);
     * }
     * ```
     */
    initializeControlDatabase(context: ReleaseContext): Promise<void>
    /**
     * Starts/configures the host identity service after control database initialization.
     * @param context - Reviewed operation identity and input hash.
     * @returns No value; resolves after host identity setup.
     * @throws Host setup errors stop bootstrap without undoing earlier stages.
     
     * @example
     * ```typescript
     * import type { PlatformOperations, ReleaseContext } from '@alneas/eaos-cli/platform';
     * export async function reviewedBootstrap(operations: PlatformOperations, context: ReleaseContext) {
     *   if (!operations.bootstrap) throw new Error("Real bootstrap capabilities required");
     *   // Invoke only after the host approves this operation and preceding stages.
     *   await operations.bootstrap.startIdentity(context);
     * }
     * ```
     */
    startIdentity(context: ReleaseContext): Promise<void>
    /**
     * Delivers the host's short-lived single-use administrator registration code directly.
     * @param context - Reviewed operation identity and input hash.
     * @returns No value; credentials must not be returned for inclusion in receipts.
     * @throws Delivery/setup errors stop bootstrap; the host must reconcile any code already issued.
     
     * @example
     * ```typescript
     * import type { PlatformOperations, ReleaseContext } from '@alneas/eaos-cli/platform';
     * export async function reviewedBootstrap(operations: PlatformOperations, context: ReleaseContext) {
     *   if (!operations.bootstrap) throw new Error("Real bootstrap capabilities required");
     *   // Invoke only after the host approves this operation and preceding stages.
     *   await operations.bootstrap.issueAdminRegistration(context);
     * }
     * ```
     */
    issueAdminRegistration(context: ReleaseContext): Promise<void>
  }
}
/**
 * Trusted argv-only executable runner used by host operations; it is not an OS sandbox.
 * @see {@link runOperation} for the canonical usage example and runtime requirements.
 */
export type OperationRunner = (command: string, argv: string[], options: { 
/**
 * Trusted working directory for the argv-only subprocess invocation.
 */
cwd: string; 
/**
 * Optional explicit subprocess environment; when omitted, the real runner inherits its process environment.
 */
env?: NodeJS.ProcessEnv }) => Promise<void>
/**
 * Application configuration, operation module and plan/stack selections.
 * @see {@link planPlatformOperation} for the canonical usage example and runtime requirements.
 */
export interface PlatformOperationOptions {
  
    /**
   * Workspace-relative application manifest path; defaults to eaos.platform.json.
   */
  config?: string
  
    /**
   * Trusted operation module path; defaults to eaos.operations.ts.
   */
  operations?: string
  
    /**
   * When true, inspect inputs/stages without importing live host operation code.
   */
  plan?: boolean
  
    /**
   * Explicit Pulumi stack required for bootstrap execution.
   */
  stack?: string
}
/**
 * Retain typed trusted host operations without executing any supplied callback.
 * @param operations - Host-owned lock, lifecycle, health and deployment/bootstrap bindings.
 * @returns The same host operations object, without cloning or execution.
 * @remarks Host callbacks carry real capabilities. Configuration passthrough is not validation, approval or a deployment.
 * @example
 * import { definePlatformOperations } from '@alneas/eaos-cli/platform'
 * export function bindOperations(operations: Parameters<typeof definePlatformOperations>[0]) { return definePlatformOperations(operations) }
 */
export const definePlatformOperations = (operations: PlatformOperations): PlatformOperations => operations
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const fail = (message: string): never => { throw new Error(`EAOS operation: ${message}`) }
/**
 * Run one executable with argv and discarded stdin/stdout/stderr, rejecting unsuccessful exit.
 * @param command - Trusted executable name/path; shell parsing is not used.
 * @param argv - Explicit argument vector.
 * @param options - Working directory and optional subprocess environment.
 * @returns Resolves without a value when the executable exits zero.
 * @throws Rejects startup errors, termination or a nonzero exit status.
 * @remarks May execute real host side effects. Output is not captured in the returned error; no command allowlist, timeout or OS sandbox is provided by this runner.
 * @example
 * import { runOperation } from '@alneas/eaos-cli/platform/operations'
 * export function checkDocker(cwd: string) { return runOperation('docker', ['version'], { cwd }) }
 */
export const runOperation: OperationRunner = async (command, argv, options) => new Promise((done, reject) => {
  const child = spawn(command, argv, { ...options, stdio: ['ignore', 'ignore', 'ignore'] })
  child.on('error', () => reject(new Error('Host command failed; output omitted')))
  child.on('exit', code => code === 0 ? done() : reject(new Error('Host command failed; output omitted')))
})
/**
 * Persisted release/bootstrap execution state and lifecycle plan hashes.
 * @see {@link executePlatformOperation} for the canonical usage example and runtime requirements.
 */
export interface OperationReceipt {
  
    /**
   * Persisted operation receipt format; currently 1.
   */
  formatVersion: 1; 
    /**
   * Unique execution UUID matching the release context.
   */
  id: string; 
    /**
   * Requested release or bootstrap operation.
   */
  operation: 'release' | 'bootstrap'; 
    /**
   * Hash of inputs used for the reviewed operation.
   */
  inputSha256: string
  
    /**
   * Shared host environment identity supplied by trusted operations.
   */
  environment: string; 
    /**
   * UTC ISO timestamp for operation start.
   */
  startedAt: string; 
    /**
   * UTC ISO timestamp set when the attempt finishes.
   */
  finishedAt?: string; 
    /**
   * Current running, succeeded or failed outcome.
   */
  status: 'running' | 'succeeded' | 'failed'
  
    /**
   * Ordered per-stage status records; a failed attempt preserves completed and failed stages.
   */
  stages: Array<{
    /** Execution stage label, such as migrate or deploy:backend. */
    name: string
    /** Stage outcome; running can remain in evidence after interruption. */
    status: 'running' | 'succeeded' | 'failed'
    /** ISO start time written before stage work. */
    startedAt: string
    /** ISO completion time when the stage's finally block executes. */
    finishedAt?: string
  }>
  
    /**
   * Lifecycle plan hashes used by this attempt for later review.
   */
  lifecyclePlans: string[]
}
async function inputs(root: string, options: PlatformOperationOptions) {
  const config = options.config ?? 'eaos.platform.json'
  const { data, text } = await readJson(await safePath(root, config))
  const project = await resolveProjectManifest(root, data)
  const sources: Record<string, string> = { [config]: digest(text) }
  for (const file of [...project.inventories, ...['package.json', 'platform.operations.json', 'bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', options.operations ?? 'eaos.operations.ts']]) {
    const name = file.startsWith(root + '/') ? file.slice(root.length + 1) : file
    try { sources[name] = digest(await readFile(await safePath(root, name))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const walk = async (directory: string): Promise<void> => {
    let names: string[]
    try { names = await readdir(await safePath(root, directory)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const name of names.sort()) {
      if (['node_modules', '.pulumi', '.git'].includes(name)) continue
      const relative = `${directory}/${name}`, file = await safePath(root, relative), item = await lstat(file)
      if (item.isDirectory()) await walk(relative)
      else if (item.isFile() && /\.(?:ts|js|json|yaml|yml)$/.test(name)) sources[relative] = digest(await readFile(file))
    }
  }
  for (const directory of ['pulumi', 'infra/pulumi', 'src', 'scripts']) await walk(directory)
  return { ...project, inputSha256: digest(JSON.stringify(sources)), config }
}
function roles(project: Awaited<ReturnType<typeof inputs>>) {
  const deployment = project.resolved.deployment
  if (!deployment.kamal || deployment.target === 'compose') fail('release requires explicit Kamal hosts and immutable registry images')
  const values = (['worker', 'backend', 'frontend'] as const).filter(role => deployment.images[role]).map(role => {
    const image = deployment.images[role]!, version = image.slice(image.lastIndexOf(':') + 1)
    if (image.includes('@') || ['dev', 'local', 'latest'].includes(version) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(version)) fail('release images require immutable version tags')
    return { role, image, version }
  })
  if (deployment.images.agentRuntime) fail('agent runtime upgrades require a separate reviewed operation')
  return values
}
function validateOperations(ops: PlatformOperations, project: Awaited<ReturnType<typeof inputs>>, operation: 'release' | 'bootstrap') {
  if (!ops || ops.formatVersion !== 1 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(ops.environment) || typeof ops.withLock !== 'function') fail('trusted operations require an environment and shared release lock')
  if (operation === 'bootstrap') {
    if (!ops.bootstrap || ['initializeControlDatabase', 'startIdentity', 'issueAdminRegistration'].some(key => typeof ops.bootstrap![key as keyof NonNullable<PlatformOperations['bootstrap']>] !== 'function')) fail('bootstrap requires real control DB, identity and single-use administrator delivery adapters')
    return
  }
  if (!ops.lifecycle?.store || typeof ops.lifecycle.migrate !== 'function' || !Array.isArray(ops.migrations) || !Array.isArray(ops.health)) fail('release requires lifecycle, migration targets and health endpoints')
  const selected = new Set(project.resolved.deployment.placements?.plugins.map(p => p.pluginId) ?? [])
  const targets = project.resolved.runtime ? platformDatabaseTargets(project.resolved.runtime) : ops.lifecycle.backends
  const covered = new Set<string>(), pairs = new Set<string>()
  for (const target of ops.migrations) {
    const backend = targets.find(b => b.id === target.backendId)
    const actual = ops.lifecycle.backends.find(b => b.id === target.backendId)
    if (!backend || !actual || lifecycleDigest(backend) !== lifecycleDigest(actual) || typeof target.tenantId !== 'string' || !target.tenantId.trim() || target.tenantId === '*' || (backend.mode === 'dedicated' && backend.tenantId !== target.tenantId) || !Array.isArray(target.pluginIds) || !target.pluginIds.length || new Set(target.pluginIds).size !== target.pluginIds.length) fail('migration targets must match the declared runtime and a concrete tenant')
    const key = JSON.stringify([target.backendId, target.tenantId])
    if (pairs.has(key)) fail('duplicate migration target')
    pairs.add(key)
    for (const id of target.pluginIds) {
      if (!ops.lifecycle.plugins.some(p => p.id === id) || selected.size && !selected.has(id)) fail('migration target references an unselected or unavailable plugin')
      const registration = project.resolved.packages.find(p => p.pluginIds.includes(id))
      if (registration && !registration.tenantIds.includes(target.tenantId)) fail('corporate migration target does not own the selected tenant')
      covered.add(id)
    }
  }
  if ([...selected].some(id => !covered.has(id))) fail('migration targets must cover every selected plugin')
  if (selected.size && !ops.migrations.length) fail('selected plugins require migration targets')
  for (const { role } of roles(project)) {
    const endpoints = ops.health.filter(h => h.role === role)
    if (endpoints.length !== 1) fail('each deployed role requires exactly one versioned health endpoint')
    const url = new URL(endpoints[0].url)
    if (url.username || url.password || url.hash || url.search || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) fail('health endpoints require HTTPS without embedded credentials')
  }
}
async function loadOperations(root: string, options: PlatformOperationOptions): Promise<PlatformOperations> {
  const path = await safePath(root, options.operations ?? 'eaos.operations.ts')
  const module = await import(pathToFileURL(path).href)
  return typeof module.default === 'function' ? await module.default() : module.default
}
/**
 * Inspect release/bootstrap inputs and produce an execution plan without importing host operation code.
 * @param root - Existing application root whose real path and immutable inputs are checked.
 * @param operation - release plans deployment roles; bootstrap requires a supported preset.
 * @param options - Optional config/operations paths and stack selection; no operation callback is executed.
 * @returns Plan-only metadata, input hash, roles, stages and selected plugins.
 * @throws Rejects missing/invalid inputs, unsupported bootstrap configuration or inconsistent role/image selections.
 * @example
 * import { planPlatformOperation } from '@alneas/eaos-cli/platform'
 * export function reviewRelease(root: string) { return planPlatformOperation(root, 'release') }
 */
export async function planPlatformOperation(root: string, operation: 'release' | 'bootstrap', options: PlatformOperationOptions = {}) {
  root = await realpath(resolve(root))
  const project = await inputs(root, options)
  if (operation === 'bootstrap' && !(project.manifest as { preset?: string }).preset) fail('bootstrap requires a supported infrastructure preset')
  const deployed = operation === 'release' ? roles(project) : []
  return { mode: 'plan-only' as const, operation, inputSha256: project.inputSha256, preset: (project.manifest as { preset?: string }).preset,
    roles: deployed, stages: operation === 'release' ? ['platform:check', 'migrate', ...deployed.map(r => `deploy:${r.role}`), 'health', 'restore-activations'] : ['platform:check', 'pulumi', 'control-db', 'identity', 'administrator'],
    selectedPlugins: project.resolved.deployment.placements?.plugins.map(p => ({ owner: p.owner, id: p.pluginId })) ?? [],
    requires: options.operations ?? 'eaos.operations.ts',
  }
}

/**
 * Explicit test or host overrides for operations, commands, deployment and HTTP verification.
 * @see {@link executePlatformOperation} for the canonical usage example and runtime requirements.
 */
export interface OperationPorts {
  
    /**
   * Explicit trusted host operations; omitted value loads the configured live operation module.
   */
  operations?: PlatformOperations
  
    /**
   * Optional argv-only subprocess port; omitted value invokes the real host runner.
   */
  run?: OperationRunner
  
    /**
   * Optional image-deployment port; omitted value uses real Kamal/OpenSSH deployment.
   */
  deploy?: typeof deployPlatformImage
  
    /**
   * Optional HTTP readiness port; omitted value uses global fetch.
   */
  fetch?: typeof globalThis.fetch
}
/**
 * Execute a reviewed release/bootstrap under local and shared host locks with durable step receipts.
 * @param root - Existing application root.
 * @param operation - Explicit release or bootstrap operation.
 * @param options - plan returns inspection only; actual bootstrap additionally requires an explicit Pulumi stack.
 * @param ports - Trusted host operations and optional process/deploy/fetch ports; missing ports use real host implementations.
 * @returns The plan in plan mode; after real execution, an object with the persisted receipt path, succeeded status, and operation UUID. The receipt contents are stored in the referenced file.
 * @throws Rejects invalid or changed inputs, held locks, dirty/stale lifecycle plans, missing capabilities or any failed infrastructure/deployment/health step.
 * @remarks Actual execution can apply infrastructure and migrations, deploy roles and issue administrator setup data. Failure evidence is retained; completed external effects are not generally rolled back. Never retry blindly or treat plan mode as approval. New tenants are not automatically enabled.
 * @example
 * import { executePlatformOperation } from '@alneas/eaos-cli/platform'
 * export function inspectRelease(root: string) { return executePlatformOperation(root, 'release', { plan: true }) }
 */
export async function executePlatformOperation(root: string, operation: 'release' | 'bootstrap', options: PlatformOperationOptions = {}, ports: OperationPorts = {}) {
  if (options.plan) return planPlatformOperation(root, operation, options)
  root = await realpath(resolve(root))
  const plan = await planPlatformOperation(root, operation, options), project = await inputs(root, options)
  const ops = ports.operations ?? await loadOperations(root, options)
  validateOperations(ops, project, operation)
  if (operation === 'bootstrap' && (!options.stack || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/.test(options.stack) || options.stack.split('/').some(p => !p || p === '.' || p === '..'))) fail('bootstrap requires an explicit Pulumi stack')
  const context: ReleaseContext = { root, id: randomUUID(), inputSha256: plan.inputSha256 }
  const receipt: OperationReceipt = { formatVersion: 1, id: context.id, operation, inputSha256: context.inputSha256, environment: ops.environment, startedAt: new Date().toISOString(), status: 'running', stages: [], lifecyclePlans: [] }
  const directory = await safePath(root, '.eaos/operations')
  await mkdir(directory, { recursive: true })
  const file = await safePath(root, `.eaos/operations/${context.id}.json`), lock = await safePath(root, '.eaos/operation.lock')
  // Never expire an interrupted operator's lock automatically.
  await writeFile(lock, context.id + '\n', { flag: 'wx', mode: 0o600 })
  const save = async () => {
    const temp = await safePath(root, `.eaos/operations/${context.id}.tmp`)
    await writeFile(temp, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temp, await safePath(root, `.eaos/operations/${context.id}.json`))
  }
  const check = async () => {
    if ((await inputs(root, options)).inputSha256 !== context.inputSha256) fail('inputs changed during the operation; stop and reconcile')
    await generatePlatform(root, { config: project.config, check: true })
  }
  const stage = async (name: string, fn: () => Promise<void>) => {
    await check()
    const entry: OperationReceipt['stages'][number] = { name, status: 'running', startedAt: new Date().toISOString() }
    receipt.stages.push(entry); await save()
    try { await fn(); entry.status = 'succeeded' }
    catch { entry.status = 'failed'; throw new Error(`EAOS ${operation} stopped at ${name}; inspect receipt ${file} and host state before retrying`) }
    finally { entry.finishedAt = new Date().toISOString(); await save() }
  }
  try {
    await save()
    let entered = false, completed = false
    await ops.withLock(context, async () => {
      if (entered) fail('shared lock adapter invoked the operation more than once')
      entered = true
      await stage('platform:check', async () => {})
      if (operation === 'bootstrap') {
        await stage('pulumi', async () => {
          if (ops.bootstrap!.provisionInfrastructure) return ops.bootstrap!.provisionInfrastructure(context, options.stack!)
          await readFile(await safePath(root, 'pulumi/Pulumi.yaml'))
          await readFile(await safePath(root, 'pulumi/index.ts'))
          await (ports.run ?? runOperation)('pulumi', ['up', '--yes', '--non-interactive', '--stack', options.stack!], { cwd: await safePath(root, 'pulumi') })
        })
        await stage('control-db', () => ops.bootstrap!.initializeControlDatabase(context))
        await stage('identity', () => ops.bootstrap!.startIdentity(context))
        await stage('administrator', () => ops.bootstrap!.issueAdminRegistration(context))
      } else {
        const manager = new PluginLifecycle(ops.lifecycle)
        const before = await ops.lifecycle.store.read()
        const previouslyEnabled = Object.values(before.activations).filter(a => a.enabled)
        const deactivated = new Set<string>()
        await stage('migrate', async () => {
          const databaseIds = new Set(ops.migrations.map(t => ops.lifecycle.backends.find(b => b.id === t.backendId)!.databaseId))
          if (Object.values(before.migrations).some(m => databaseIds.has(m.databaseId) && m.status !== 'applied')) fail('dirty migration history requires reconciliation')
          for (const entry of ops.baselines ?? []) {
            const backend = ops.lifecycle.backends.find(b => b.id === entry.backendId)
            if (!backend || !databaseIds.has(backend.databaseId)) fail('baseline target must belong to a declared migration target')
            const target = (ops.lifecycle.dataContracts ?? []).find(c => c.id === entry.baseline.target.id)
            if (!target || lifecycleDigest(target) !== lifecycleDigest(entry.baseline.target)) fail('lifecycle catalog must use the exact baseline target')
            const state = await ops.lifecycle.store.read(), installed = state.dataContracts?.[JSON.stringify([backend.databaseId, target.id])]
            if (!installed || installed.status === 'installed' && installed.digest === lifecycleDigest(target)) continue
            const live = Object.entries(state.activations).filter(([, a]) => a.enabled && state.backends[a.backendId]?.databaseId === backend.databaseId && state.installations[JSON.stringify([a.backendId, a.pluginId])]?.release.schemaDependencies?.[target.id])
            await rebaseDataContractBaseline(ops.lifecycle.store, backend.databaseId, entry.baseline, { expectedRevision: state.revision, ...(ops.lifecycle.quiesce ? { quiesce: async () => { await ops.lifecycle.quiesce!(live.map(([, a]) => a)) } } : {}) })
            live.forEach(([key]) => deactivated.add(key))
            receipt.lifecyclePlans.push(entry.baseline.hash); await save()
          }
          for (const target of ops.migrations) {
            const ordered: string[] = [], visiting = new Set<string>()
            const visit = (id: string) => {
              if (ordered.includes(id)) return
              if (visiting.has(id)) fail('cyclic lifecycle dependencies')
              visiting.add(id)
              const plugin = ops.lifecycle.plugins.find(p => p.id === id)
              if (!plugin) fail('missing lifecycle dependency')
              const registration = project.resolved.packages.find(p => p.pluginIds.includes(id))
              if (registration && !registration.tenantIds.includes(target.tenantId)) fail('corporate dependency does not own the migration tenant')
              Object.keys(plugin.dependencies ?? {}).forEach(visit)
              visiting.delete(id); ordered.push(id)
            }
            target.pluginIds.forEach(visit)
            for (const id of ordered) {
              const state = await ops.lifecycle.store.read()
              const installed = state.installations[JSON.stringify([target.backendId, id])]
              const child = await manager.plan({ operation: installed ? 'update' : 'install', backendId: target.backendId, tenantId: target.tenantId, pluginId: id })
              if (installed?.status === 'installed' && installed.digest === lifecycleDigest(ops.lifecycle.plugins.find(p => p.id === id)!) && !child.migrations.length && !child.infrastructure.length) continue
              receipt.lifecyclePlans.push(child.id); child.deactivate.forEach(key => deactivated.add(key)); await save()
              await manager.apply(child)
            }
          }
        })
        for (const { role, image, version } of roles(project)) await stage(`deploy:${role}`, () => {
          const configFile = `.eaos/generated/platform/kamal-${role}.yml`
          return ports.deploy ? ports.deploy({ cwd: root, configFile, version }) : ops.deploy ? ops.deploy({ context, role, image, version, configFile }) : deployPlatformImage({ cwd: root, configFile, version })
        })
        await stage('health', async () => {
          for (const { role, version } of roles(project)) {
            const endpoint = ops.health.find(h => h.role === role)!
            let healthy = false
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const response = await (ports.fetch ?? globalThis.fetch)(endpoint.url, { redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' })
                healthy = response.ok && response.headers.get('x-eaos-release') === version
                await response.body?.cancel()
                if (healthy) break
              } catch { /* Treat transient health failures as unhealthy. */ }
              if (attempt < 4) await new Promise(done => setTimeout(done, 250))
            }
            if (!healthy) fail(`health verification failed for ${role}`)
          }
        })
        await stage('restore-activations', async () => {
          // Restore only existing grants after code is healthy. A new tenant/plugin remains disabled.
          for (const activation of previouslyEnabled) {
            const key = JSON.stringify([activation.backendId, activation.tenantId, activation.pluginId])
            if (!deactivated.has(key)) continue
            const current = (await ops.lifecycle.store.read()).activations[key]
            if (!current || current.enabled) continue
            const child = await manager.plan({ operation: 'enable', backendId: activation.backendId, tenantId: activation.tenantId, pluginId: activation.pluginId })
            receipt.lifecyclePlans.push(child.id); await save(); await manager.apply(child)
          }
        })
      }
      await check()
      completed = true
    })
    if (!completed) fail('shared lock adapter did not execute the complete operation')
    receipt.status = 'succeeded'
  } catch (error) { receipt.status = 'failed'; throw error }
  finally { receipt.finishedAt = new Date().toISOString(); await save(); await unlink(lock) }
  return { receipt: file, status: receipt.status, id: context.id }
}

/**
 * Start the configured local Compose application after reviewing its generated runtime contract.
 * @param root - Existing application project root.
 * @param options - plan returns the startup plan without host execution.
 * @param run - Optional trusted argv-only command runner; defaults to the real subprocess runner.
 * @returns The startup plan or local operation result after configured steps succeed.
 * @throws Rejects invalid startup contracts, missing password/TLS files, stale generated configuration or failed build/start/readiness commands.
 * @remarks Actual mode starts host processes/containers and may execute configured local setup operations. Existing credentials and volumes are not silently replaced.
 * @example
 * import { upPlatform } from '@alneas/eaos-cli/platform'
 * export function inspectLocal(root: string) { return upPlatform(root, { plan: true }) }
 */
export async function upPlatform(root: string, options: { 
/**
 * Workspace-relative application manifest used for generation and startup contract checks; defaults to eaos.platform.json.
 */
config?: string; 
/**
 * When true, return Docker startup argv without executing generation or subprocess startup; false/omitted runs the reviewed local startup steps.
 */
plan?: boolean } = {}, run: OperationRunner = runOperation) {
  root = await realpath(resolve(root))
  const { resolved } = await resolveProjectManifest(root, (await readJson(await safePath(root, options.config ?? 'eaos.platform.json'))).data)
  if (resolved.deployment.target === 'kamal') fail('local up requires Compose output')
  const argv = ['compose', '--file', '.eaos/generated/platform/compose.yml', 'up', '--detach', '--wait']
  if (options.plan) return { mode: 'plan-only', command: 'docker', argv }
  await generatePlatform(root, { config: options.config })
  await generatePlatform(root, { config: options.config, check: true })
  await run('docker', ['compose', '--file', '.eaos/generated/platform/compose.yml', 'up', '--detach', '--wait', 'kratos-db'], { cwd: root })
  await run('docker', ['compose', '--file', '.eaos/generated/platform/compose.yml', '--profile', 'operations', 'run', '--rm', 'kratos-migrate'], { cwd: root })
  await run('docker', argv, { cwd: root })
  return { status: 'running' }
}
