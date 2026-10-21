import { describe, expect, it } from 'bun:test'
import { createWorkflowAgentNode } from './agent-node'
import { createWorkflowAgentRunner } from './agent-runner'

const request = {
  taskId: 'task-1',
  workflowId: 'workflow-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  correlationId: 'corr-1',
  purpose: 'Classify repair',
  input: { recordId: 'repair-1' },
  toolScope: { mode: 'preview' as const, allowedToolNames: ['estate_repairs_get', 'estate_repairs_triage_preview'] },
  idempotencyKey: 'workflow-1:triage',
}

describe('workflow agent runner and node', () => {
  it('turns a host executor response into a structured proposal', async () => {
    let received: any
    const runner = createWorkflowAgentRunner({
      runtimeId: 'hermes-host',
      executor: async task => {
        received = task
        return JSON.stringify({
          schemaVersion: '1.0', summary: 'Repair requires manager review', output: { severity: 'high' },
          evidence: [{ kind: 'tool', source: 'estate_repairs_get:repair-1' }], actions: [], riskLevel: 'high',
        })
      },
    })

    const result = await runner.run<{ severity: string }>(request)

    expect(result.status).toBe('COMPLETED')
    expect(result.proposal?.output).toEqual({ severity: 'high' })
    expect(received.executionContext).toMatchObject({ workflowId: 'workflow-1', toolMode: 'preview' })
    expect(received.executionContext.allowedToolNames).toEqual(['estate_repairs_get', 'estate_repairs_triage_preview'])
  })

  it('fails closed on prose output and refuses a cross-workflow request', async () => {
    const runner = createWorkflowAgentRunner({ executor: async () => 'done' })
    const malformed = await runner.run(request)
    expect(malformed.status).toBe('FAILED')
    expect(malformed.failureCode).toBe('INVALID_PROPOSAL')
    expect(malformed.retryable).toBe(false)

    const node = createWorkflowAgentNode({ runner, createRequest: () => ({ ...request, workflowId: 'other-workflow' }) })
    await expect(node({ sessionId: 'workflow-1', tenantId: 'tenant-1', userId: 'user-1', currentStep: 'agent', history: [], isComplete: false })).rejects.toThrow('workflowId')
  })

  it('marks an unavailable ARM agent as retryable without converting it into success', async () => {
    const runner = createWorkflowAgentRunner({
      executor: async () => {
        const error = new Error('ARM agent is unavailable') as Error & { failureCode: string; retryable: boolean }
        error.failureCode = 'AGENT_UNAVAILABLE'
        error.retryable = true
        throw error
      },
    })

    await expect(runner.run(request)).resolves.toMatchObject({ status: 'UNAVAILABLE', failureCode: 'AGENT_UNAVAILABLE', retryable: true })
  })
})
