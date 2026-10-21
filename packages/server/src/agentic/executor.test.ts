import { describe, expect, it } from 'bun:test'
import { buildSystemdRunArgs, createCommandAgentExecutor } from './executor'

const request = {
  id: 'task-1', tenantId: 'tenant-1', userId: 'user-1', title: 'test', instructions: 'hello', workerType: 'custom' as const,
}

describe('command agent executor', () => {
  it('runs a host-configured command without a shell and passes verified context', async () => {
    const executor = createCommandAgentExecutor({
      command: process.execPath,
      includeProcessEnv: false,
      sandbox: { mode: 'direct' },
      buildArgs: task => ['-e', 'process.stdout.write([process.env.EAOS_TENANT_ID, process.env.EAOS_WORKFLOW_ID, process.env.EAOS_TOOL_MODE, process.env.EAOS_ALLOWED_TOOL_NAMES].join(":"))', task.instructions],
    })

    await expect(executor({ ...request, executionContext: { workflowId: 'wf-1', toolMode: 'preview', allowedToolNames: ['notes_get'] } })).resolves.toBe('tenant-1:wf-1:preview:["notes_get"]')
  })

  it('fails on a non-zero runtime instead of converting it to success', async () => {
    const executor = createCommandAgentExecutor({ command: process.execPath, sandbox: { mode: 'direct' }, buildArgs: () => ['-e', 'process.stderr.write("broken"); process.exit(3)'] })
    await expect(executor(request)).rejects.toThrow('exited with code 3')
  })

  it('renders the default Linux cgroup and tmpfs guardrails', () => {
    const args = buildSystemdRunArgs(process.execPath, ['-e', 'console.log("ok")'], {
      placement: 'ai', maxConcurrent: 1, maxRuntimeMs: 900_000, memoryLimitMb: 2_048, pidsLimit: 100,
      rootFilesystem: 'read-only', network: 'private-only',
      tmpfs: { path: '/tmp', maxBytes: 64 * 1024 * 1024, noexec: true, nosuid: true, nodev: true },
      workspace: { mode: 'quota-volume', path: '/workspace', maxBytes: 1024 * 1024 * 1024, persistent: false },
    }, '/workspace', 'eaos-agent-test')
    expect(args).toContain('--property=MemoryMax=2048M')
    expect(args).toContain('--property=TasksMax=100')
    expect(args).toContain('--property=ProtectSystem=strict')
    expect(args).toContain('--property=PrivateTmp=yes')
    expect(args).toContain('--property=TemporaryFileSystem=/tmp:rw,noexec,nosuid,nodev,size=67108864')
  })
})
