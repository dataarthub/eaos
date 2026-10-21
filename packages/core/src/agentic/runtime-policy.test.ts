import { describe, expect, it } from 'bun:test'
import { defaultRuntimePlacementPolicy } from './runtime-policy'

describe('runtime placement policy', () => {
  it('keeps critical hosts free of agents and bounds the AI worker by default', () => {
    const policy = defaultRuntimePlacementPolicy()
    expect(policy.edge.agentRuntime).toBe('forbidden')
    expect(policy.applicationWorker.agentRuntime).toBe('dispatch-only')
    expect(policy.ai.agentRuntime).toMatchObject({
      maxConcurrent: 1,
      memoryLimitMb: 2_048,
      pidsLimit: 100,
      rootFilesystem: 'read-only',
      network: 'private-only',
      workspace: { mode: 'quota-volume', maxBytes: 1_024 * 1024 * 1024, persistent: false },
    })
    expect(policy.ai.agentRuntime.tmpfs).toMatchObject({ path: '/tmp', maxBytes: 64 * 1024 * 1024, noexec: true, nosuid: true, nodev: true })
  })

  it('returns a detached value for host-specific tightening', () => {
    const first = defaultRuntimePlacementPolicy()
    first.ai.agentRuntime.maxConcurrent = 2
    expect(defaultRuntimePlacementPolicy().ai.agentRuntime.maxConcurrent).toBe(1)
  })
})
