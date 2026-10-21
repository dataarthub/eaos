import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { inspectDeploymentStatus, recordDeploymentResult, renderDeploymentStatusMarkdown } from './deployment-status'
import { createDeploymentPlan } from './deployment-plan'
import type { DeploymentInventory, DeploymentResult } from '@alneas/eaos-server/platform'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eaos-status-'))
  await writeFile(join(root, 'index.js'), 'throw new Error("inventory must not execute code")')
  const inventory: DeploymentInventory = { apiVersion: 1, owner: 'product', runtime: 'index.js', lifecycleBundle: ['notes'], functions: [], assets: [{ path: 'index.js', sha256: createHash('sha256').update(await readFile(join(root, 'index.js'))).digest('hex') }], plugins: [{ id: 'notes', components: [{ id: 'api', kind: 'api', placement: 'host', entry: 'index.js' }], tasks: [
    { id: 'build', componentIds: ['api'], action: 'build', scope: 'artifact', required: true, executor: 'bun', argv: ['run', 'build'], dependsOn: [] },
    { id: 'deploy', componentIds: ['api'], action: 'deploy', scope: 'environment', required: true, executor: 'host:deploy', dependsOn: ['build'] },
  ] }] }
  const path = join(root, 'deployment.json')
  await writeFile(path, JSON.stringify(inventory))
  return { root, path, inventory }
}
function result(taskId = 'build', time = 1): DeploymentResult {
  return { pluginId: 'notes', taskId, status: 'succeeded', actor: 'test-operator', evidence: ['fixture:log'], recordedAt: new Date(time * 1000).toISOString(), ...(taskId === 'deploy' ? { target: { environment: 'staging', databaseId: 'db-1' } } : {}) }
}
test('Markdown remaining report preserves optional work, dependency waits, target limits and stale evidence', async () => {
  const { root, path, inventory } = await fixture()
  try {
    inventory.plugins![0].tasks.push({ id: 'native-test', componentIds:['api'], action:'test', scope:'artifact', required:false, executor:'host:python', dependsOn:['build'], instructions:'Verify <model> | retain\nevidence' })
    await writeFile(path, JSON.stringify(inventory))
    await recordDeploymentResult(root, { inventory:path, receipt:'state/receipt.json', result:result() })
    const status = await inspectDeploymentStatus([path], {receipts:[join(root,'state/receipt.json')]})
    const markdown = renderDeploymentStatusMarkdown(status, {remaining:true})
    expect(markdown).toContain('| notes | 1/2 | 1 | 1 | 未完了 |')
    expect(markdown).not.toContain('| build | succeeded |')
    expect(markdown).toContain('| deploy | pending | environment | 必須 |')
    expect(markdown).toContain('| native-test | pending | artifact | 任意・採用時 |')
    expect(markdown).toContain('環境・テナントの対象未指定')
    expect(markdown).toContain('&lt;model&gt; &#124; retain evidence')
    expect(renderDeploymentStatusMarkdown(status)).toContain('fixture:log')
    await recordDeploymentResult(root, { inventory:path, receipt:'state/receipt.json', result:result('native-test',2) })
    await recordDeploymentResult(root, { inventory:path, receipt:'state/receipt.json', result:result('build',3) })
    expect(renderDeploymentStatusMarkdown(await inspectDeploymentStatus([path], {receipts:[join(root,'state/receipt.json')]}),{remaining:true})).toContain('| native-test | stale |')
    inventory.version = 'changed'
    await writeFile(path, JSON.stringify(inventory))
    const stale = renderDeploymentStatusMarkdown(await inspectDeploymentStatus([path], {receipts:[join(root,'state/receipt.json')]}))
    expect(stale).toContain('stale-inventory')
    expect(stale).toContain('| deploy | blocked | environment | 必須 | api | build |')
  } finally { await rm(root,{recursive:true,force:true}) }
})
test('plan and status expose composition, append evidence, isolate targets, and reject stale release recording', async () => {
  const { root, path, inventory } = await fixture()
  try {
    const plan = await createDeploymentPlan([path])
    expect(plan.contributions[0].plugins?.[0].components[0].kind).toBe('api')
    expect(plan.contributions[0].inventorySha256).toMatch(/^[a-f0-9]{64}$/)
    expect((await inspectDeploymentStatus([path])).complete).toBe(false)
    const recorded = await recordDeploymentResult(root, { inventory: path, receipt: 'state/receipt.json', result: result() })
    expect(recorded.executed).toBe(false)
    expect((await inspectDeploymentStatus([path], { receipts: [recorded.receipt] })).complete).toBe(false)
    await recordDeploymentResult(root, { inventory: path, receipt: 'state/receipt.json', result: result('deploy', 2) })
    const status = await inspectDeploymentStatus([path], { receipts: [recorded.receipt], target: { environment: 'staging', databaseId: 'db-1' } })
    expect(status.complete).toBe(true)
    expect(status.contributions[0].plugins[0].tasks[1].result?.actor).toBe('test-operator')
    inventory.version = 'new-release'
    await writeFile(path, JSON.stringify(inventory))
    expect((await inspectDeploymentStatus([path], { receipts: [recorded.receipt], target: { environment: 'staging', databaseId: 'db-1' } })).complete).toBe(false)
    await expect(recordDeploymentResult(root, { inventory: path, receipt: 'state/receipt.json', result: result('build', 3) })).rejects.toThrow('another release')
    expect(JSON.parse(await readFile(recorded.receipt, 'utf8')).results).toHaveLength(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('malformed journal, writer lock, symlinks, artifact writes and undeclared tasks are rejected without losing history', async () => {
  const { root, path } = await fixture()
  try {
    await expect(recordDeploymentResult(root, { inventory: path, receipt: 'deployment.json', result: result() })).rejects.toThrow('separately')
    await expect(recordDeploymentResult(root, { inventory: path, receipt: 'index.js', result: result() })).rejects.toThrow('separately')
    await expect(recordDeploymentResult(root, { inventory: path, receipt: '../escape.json', result: result() })).rejects.toThrow('inside')
    await expect(recordDeploymentResult(root, { inventory: path, receipt: 'receipt.json', result: result('missing') })).rejects.toThrow('undeclared')
    await writeFile(join(root, 'receipt.json'), '{corrupt')
    await expect(recordDeploymentResult(root, { inventory: path, receipt: 'receipt.json', result: result() })).rejects.toThrow('invalid JSON')
    expect(await readFile(join(root, 'receipt.json'), 'utf8')).toBe('{corrupt')
    await writeFile(join(root, 'locked.json.lock'), 'another writer')
    await expect(recordDeploymentResult(root, { inventory: path, receipt: 'locked.json', result: result() })).rejects.toThrow()
    await symlink(join(root, 'receipt.json'), join(root, 'link.json'))
    await expect(inspectDeploymentStatus([path], { receipts: [join(root, 'link.json')] })).rejects.toThrow('symlink')
    await writeFile(join(root, 'index.js'), 'tampered')
    await expect(inspectDeploymentStatus([path])).rejects.toThrow('checksum')
  } finally { await rm(root, { recursive: true, force: true }) }
})
