import { expect, test } from 'bun:test'
import { summarizeDeployment, validateDeploymentPlugins, validateDeploymentReceipt, type DeploymentPlugin, type DeploymentReceipt, type DeploymentResult, type DeploymentTarget } from './deployment'
import type { DeploymentInventory } from './artifacts'

const hash = 'a'.repeat(64)
const target: DeploymentTarget = { environment: 'staging', backendId: 'shared', databaseId: 'db-1', tenantId: 'tenant-a' }
function inventory(): DeploymentInventory {
  return { apiVersion: 1, owner: 'product', lifecycleBundle: ['notes'], functions: [], assets: [{ path: 'index.js', sha256: hash }], plugins: [{
    id: 'notes', components: [
      { id: 'api', kind: 'api', placement: 'host', runtime: 'bun', entry: 'index.js', requirements: { tools: { bun: '1.4' }, bindings: ['API_KEY'], adapters: ['scoped-db'] } },
      { id: 'db', kind: 'database', placement: 'database', dataContracts: { notes: '^1.0.0' } },
      { id: 'infra', kind: 'infrastructure', placement: 'cloud', runtime: 'pulumi' },
    ], tasks: [
      { id: 'build', componentIds: ['api'], action: 'build', scope: 'artifact', required: true, dependsOn: [], executor: 'bun', argv: ['run', 'build'] },
      { id: 'preview', componentIds: ['infra'], action: 'preview', scope: 'environment', required: true, dependsOn: ['build'], executor: 'pulumi:preview' },
      { id: 'migrate', componentIds: ['db'], action: 'migrate', scope: 'environment', required: true, dependsOn: ['preview'], executor: 'lifecycle:apply' },
      { id: 'verify', componentIds: ['api', 'db', 'infra'], action: 'verify', scope: 'tenant', required: true, dependsOn: ['migrate'], executor: 'host:smoke-test' },
    ],
  }] }
}
function result(taskId: string, time: number, status: DeploymentResult['status'] = 'succeeded'): DeploymentResult {
  const { tenantId: _tenant, ...environment } = target
  return { pluginId: 'notes', taskId, status, recordedAt: new Date(time * 1000).toISOString(), actor: 'operator', evidence: ['logs/test'], ...(taskId === 'build' ? {} : { target: taskId === 'verify' ? target : environment }) }
}
function receipt(results: DeploymentResult[]): DeploymentReceipt { return { apiVersion: 1, owner: 'product', inventorySha256: hash, results } }
function plugin(inv: DeploymentInventory): DeploymentPlugin { return inv.plugins![0] }

test('a build receipt does not complete infrastructure, migrations or tenant verification', () => {
  const report = summarizeDeployment(inventory(), hash, [receipt([result('build', 1)])], target)
  expect(report.complete).toBe(false)
  expect(report.plugins[0].tasks.map(task => task.status)).toEqual(['succeeded', 'pending', 'blocked', 'blocked'])
  expect(report.plugins[0].components.every(component => component.complete)).toBe(false)
})
test('completion requires exact target and inventory, and preserves operator evidence', () => {
  const records = receipt(['build', 'preview', 'migrate', 'verify'].map((task, i) => result(task, i + 1)))
  const report = summarizeDeployment(inventory(), hash, [records], target)
  expect(report.complete).toBe(true)
  expect(report.plugins[0].tasks[3].result?.evidence).toEqual(['logs/test'])
  for (const other of [{ ...target, tenantId: 'tenant-b' }, { ...target, databaseId: 'db-2' }, { ...target, backendId: 'dedicated' }, { ...target, environment: 'production' }]) {
    expect(summarizeDeployment(inventory(), hash, [records], other).complete).toBe(false)
  }
  expect(summarizeDeployment(inventory(), hash, [records]).complete).toBe(false)
  const stale = summarizeDeployment(inventory(), 'b'.repeat(64), [records], target)
  expect(stale.complete).toBe(false)
  expect(stale.ignoredReceipts[0].reason).toBe('stale-inventory')
})
test('latest failure and newer dependency evidence invalidate dependent success', () => {
  const records = ['build', 'preview', 'migrate', 'verify'].map((task, i) => result(task, i + 1))
  let report = summarizeDeployment(inventory(), hash, [receipt([...records, result('migrate', 5, 'failed')])], target)
  expect(report.plugins[0].tasks[2].status).toBe('failed')
  expect(report.plugins[0].tasks[3].status).toBe('blocked')
  report = summarizeDeployment(inventory(), hash, [receipt([...records, result('migrate', 5)])], target)
  expect(report.plugins[0].tasks[3].status).toBe('stale')
  expect(report.complete).toBe(false)
  expect(summarizeDeployment(inventory(), hash, [receipt([...records, result('migrate', 5), result('verify', 6)])], target).complete).toBe(true)
})
test('legacy inventories remain usable but are never reported complete', () => {
  const inv = inventory(); delete inv.plugins
  expect(summarizeDeployment(inv, hash).coverage).toBe('legacy-unclassified')
  expect(summarizeDeployment(inv, hash).complete).toBe(false)
})
test('validate coverage, references, DAG, scope and required component work', () => {
  const invalid: Array<(inv: DeploymentInventory) => void> = [
    inv => { inv.plugins = [] },
    inv => { inv.lifecycleBundle!.push('other') },
    inv => { plugin(inv).components[0].entry = 'unverified.js' },
    inv => { plugin(inv).tasks[0].componentIds = ['missing'] },
    inv => { plugin(inv).tasks[0].dependsOn = ['missing'] },
    inv => { plugin(inv).tasks[0].dependsOn = ['verify'] },
    inv => { plugin(inv).tasks[1].dependsOn = ['migrate'] },
    inv => { plugin(inv).tasks.forEach(task => { task.required = false }) },
    inv => { plugin(inv).tasks[0].action = 'migrate' },
    inv => { plugin(inv).tasks.push(plugin(inv).tasks[0]) },
    inv => { (plugin(inv).components[0] as any).secret = 'value' },
  ]
  for (const mutate of invalid) { const inv = inventory(); mutate(inv); expect(() => validateDeploymentPlugins(inv)).toThrow() }
  expect(validateDeploymentPlugins(inventory())?.length).toBe(1)
})
test('reject malformed, unsourced, ambiguous, out-of-order or scope-confused evidence', () => {
  expect(() => validateDeploymentReceipt(receipt([{ ...result('build', 1), evidence: [] }]))).toThrow()
  expect(() => validateDeploymentReceipt(receipt([result('build', 2), result('build', 1)]))).toThrow()
  expect(() => summarizeDeployment(inventory(), hash, [receipt([{ ...result('build', 1), target }])], target)).toThrow('scope')
  expect(() => summarizeDeployment(inventory(), hash, [receipt([{ ...result('migrate', 1), target }])], target)).toThrow('scope')
  expect(() => summarizeDeployment(inventory(), hash, [receipt([{ ...result('migrate', 1), target: { environment: 'staging' } }])], target)).toThrow('backendId and databaseId')
  expect(() => summarizeDeployment(inventory(), hash, [receipt([result('missing', 1)])], target)).toThrow('undeclared')
  expect(() => summarizeDeployment(inventory(), hash, [receipt([result('build', 1)]), receipt([result('build', 1, 'failed')])], target)).toThrow('Conflicting')
})
test('running and optional work remain visible without completing required work early', () => {
  const inv = inventory()
  plugin(inv).tasks.push({ id: 'optional', componentIds: ['api'], action: 'test', scope: 'artifact', required: false, dependsOn: [], executor: 'fixture:optional' })
  const records = ['build', 'preview', 'migrate', 'verify'].map((task, i) => result(task, i + 1))
  let report = summarizeDeployment(inv, hash, [receipt([...records, { ...result('optional', 5, 'failed'), target: undefined }])], target)
  expect(report.complete).toBe(true)
  report = summarizeDeployment(inv, hash, [receipt([...records, result('verify', 6, 'running')])], target)
  expect(report.plugins[0].tasks[3].status).toBe('running')
  expect(report.complete).toBe(false)
})
test('empty explicit stateless composition and multiple plugins remain distinct', () => {
  const inv = inventory()
  inv.lifecycleBundle!.push('stateless')
  inv.plugins!.push({ id: 'stateless', components: [], tasks: [] })
  expect(summarizeDeployment(inv, hash).plugins[1].complete).toBe(true)
  expect(summarizeDeployment(inv, hash).complete).toBe(false)
})
test('optional capabilities remain incomplete without blocking required work; source selectors cannot claim artifact completion', () => {
  const inv = inventory()
  plugin(inv).components.push({ id: 'provider', kind: 'integration', placement: 'external', required: false })
  plugin(inv).tasks.push({ id: 'provider', componentIds: ['provider'], action: 'verify', scope: 'tenant', required: false, dependsOn: ['verify'], executor: 'host:provider' })
  const records = receipt(['build', 'preview', 'migrate', 'verify'].map((task, i) => result(task, i + 1)))
  expect(summarizeDeployment(inv, hash, [records], target).complete).toBe(true)
  expect(summarizeDeployment(inv, hash, [records], target).plugins[0].components.at(-1)?.complete).toBe(false)
  plugin(inv).components[0].assetPatterns = ['dist/server.js']
  expect(summarizeDeployment(inv, hash, [records], target).artifactResolved).toBe(false)
  expect(summarizeDeployment(inv, hash, [records], target).complete).toBe(false)
  plugin(inv).components[0].assetPatterns = ['../outside']
  expect(() => validateDeploymentPlugins(inv)).toThrow()
})
