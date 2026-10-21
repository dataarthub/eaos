import { describe, expect, it } from 'bun:test'
import { createHttpAgentExecutor } from '../src/agentic/remote-executor'

const task = {
  id: 'task-1', tenantId: 'tenant-1', userId: 'worker', title: 'triage', instructions: 'Return a proposal', workerType: 'custom' as const,
}

describe('HTTP agent executor', () => {
  it('sends the verified task envelope and returns runtime output', async () => {
    let received: unknown
    const executor = createHttpAgentExecutor({
      url: 'https://arm.example.test/agent/run',
      headers: { authorization: 'Bearer host-secret' },
      fetch: async (_input, init) => {
        received = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ protocolVersion: '1.0', taskId: 'task-1', status: 'COMPLETED', output: '{"ok":true}' }), { status: 200 })
      },
    })

    await expect(executor(task)).resolves.toBe('{"ok":true}')
    expect(received).toEqual({ protocolVersion: '1.0', task })
  })

  it('classifies unavailable and malformed runtimes without converting them to success', async () => {
    const unavailable = createHttpAgentExecutor({ url: 'https://arm.example.test/agent/run', fetch: async () => new Response('busy', { status: 503 }) })
    await expect(unavailable(task)).rejects.toMatchObject({ failureCode: 'AGENT_UNAVAILABLE', retryable: true })

    const malformed = createHttpAgentExecutor({ url: 'https://arm.example.test/agent/run', fetch: async () => new Response(JSON.stringify({ protocolVersion: '1.0', taskId: 'other', status: 'COMPLETED', output: 'bad' }), { status: 200 }) })
    await expect(malformed(task)).rejects.toMatchObject({ failureCode: 'RUNTIME_FAILED', retryable: false })
  })

  it('rejects non-private plain HTTP endpoints', () => {
    expect(() => createHttpAgentExecutor({ url: 'http://arm.example.test/agent/run' })).toThrow('HTTPS agent runtime endpoint required')
  })

  it('bounds streamed responses and task-specific timeouts', async () => {
    const oversized = createHttpAgentExecutor({ url: 'https://arm.example.test/agent/run', maxResponseBytes: 32, fetch: async () => new Response('x'.repeat(100), { status: 200 }) })
    await expect(oversized(task)).rejects.toMatchObject({ failureCode: 'OUTPUT_LIMIT', retryable: false })

    const executor = createHttpAgentExecutor({ url: 'https://arm.example.test/agent/run', fetch: async () => new Response(JSON.stringify({ protocolVersion: '1.0', taskId: 'task-1', status: 'COMPLETED', output: 'ok' }), { status: 200 }) })
    await expect(executor({ ...task, timeoutMs: 0 })).rejects.toMatchObject({ failureCode: 'RUNTIME_FAILED', retryable: false })
  })
})
