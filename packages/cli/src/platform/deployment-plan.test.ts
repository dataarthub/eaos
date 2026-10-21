import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createDeploymentPlan } from './deployment-plan'

test('deployment inventory verifies assets and rejects tampering or repeated ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-plan-'))
  try {
    await mkdir(join(root, 'db'))
    await writeFile(join(root, 'db/migration.sql'), 'reviewed migration')
    const inventory = {
      apiVersion: 1, owner: 'owner-a', functions: [],
      database: { source: 'db', mode: 'adopt-existing-history', tenantColumn: 'tenant_id' },
      assets: [{ path: 'db/migration.sql', sha256: createHash('sha256').update('reviewed migration').digest('hex') }],
    }
    const path = join(root, 'deployment.json')
    await writeFile(path, JSON.stringify(inventory))
    const plan = await createDeploymentPlan([path])
    expect(plan.contributions[0].verifiedAssets).toBe(1)
    expect(plan.mode).toBe('plan-only')
    await expect(createDeploymentPlan([path, path])).rejects.toThrow('Duplicate deployment owner')
    await writeFile(join(root, 'db/migration.sql'), 'changed migration')
    await expect(createDeploymentPlan([path])).rejects.toThrow('checksum mismatch')
  } finally { await rm(root, { recursive: true, force: true }) }
})
