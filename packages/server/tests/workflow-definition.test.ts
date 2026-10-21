import { describe, expect, it } from 'bun:test'
import { compileWorkflowDefinition, InMemoryWorkflowDefinitionRegistry, WorkflowNodeCatalog } from '../src/index'

const definition = {
  schemaVersion: '1.0' as const,
  workflowId: 'invoice.review',
  version: '1.0.0',
  entryNode: 'classify',
  nodes: [
    { id: 'classify', type: 'invoice.classify', kind: 'agent' as const, toolScope: { mode: 'read' as const, allowedToolNames: ['invoice.lookup'] } },
    { id: 'approve', type: 'invoice.approve', kind: 'approval' as const, approval: { toolName: 'invoice.register', approvalLevel: 'L3_MANAGER' as const, riskLevel: 'high' as const, reason: '登録前の承認', argsPath: 'context.args' } },
    { id: 'register', type: 'invoice.register', kind: 'effect' as const },
    { id: 'archive', type: 'invoice.archive', kind: 'task' as const },
  ],
  edges: [
    { from: 'classify', to: 'approve', condition: { path: 'context.route', operator: 'equals' as const, value: 'approval' } },
    { from: 'classify', to: 'archive', default: true },
    { from: 'approve', to: 'register' },
  ],
}

function catalog() {
  const result = new WorkflowNodeCatalog()
  result.register({ descriptor: { type: 'invoice.classify', label: '分類', kind: 'agent' }, resolve: async () => async state => ({ context: { route: 'approval', args: { invoiceId: 'inv-1' }, observedScope: state.context?.__eaosWorkflowToolScope } }) })
  result.register({ descriptor: { type: 'invoice.approve', label: '承認', kind: 'approval' }, resolve: async () => async () => ({}) })
  result.register({ descriptor: { type: 'invoice.register', label: '登録', kind: 'effect' }, resolve: async () => async () => ({ context: { registered: true }, isComplete: true }) })
  result.register({ descriptor: { type: 'invoice.archive', label: '保管', kind: 'task' }, resolve: async () => async () => ({ isComplete: true }) })
  return result
}

describe('workflow compiler, catalog and registry', () => {
  it('compiles conditions and approval nodes into LangGraph resume behavior', async () => {
    const { graph } = await compileWorkflowDefinition(definition, { catalog: catalog(), authorizeResume: async () => true })
    const pending = await graph.runStep({ sessionId: 'wf-compiler-1', tenantId: 'tenant-1', userId: 'user-1', currentStep: 'classify', history: [], isComplete: false })
    expect(pending.pendingApproval?.toolName).toBe('invoice.register')
    expect(graph.describe().workflowId).toBe('invoice.review')
    const resumed = await graph.resumeAfterApproval({ sessionId: 'wf-compiler-1', approved: true, approverId: 'manager-1', approverRole: 'MANAGER' })
    expect(resumed.resumed).toBe(true)
    expect(resumed.state?.context?.registered).toBe(true)
    expect(resumed.state?.context?.observedScope).toEqual({ mode: 'read', allowedToolNames: ['invoice.lookup'] })
    expect(resumed.state?.isComplete).toBe(true)
  })

  it('keeps catalog descriptors serializable and enforces lifecycle immutability', () => {
    const nodes = catalog().list()
    expect(nodes).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'invoice.register', kind: 'effect' })]))
    const registry = new InMemoryWorkflowDefinitionRegistry({ now: () => '2026-09-21T00:00:00.000Z' })
    expect(registry.saveDraft(definition, 'author').status).toBe('draft')
    expect(registry.validate('invoice.review', '1.0.0', 'validator').status).toBe('validated')
    expect(registry.approve('invoice.review', '1.0.0', 'manager').status).toBe('approved')
    const published = registry.publish('invoice.review', '1.0.0', 'release').status
    expect(published).toBe('published')
    expect(() => registry.saveDraft(definition, 'author')).toThrow('immutable')
    expect(registry.getPublished('invoice.review')?.definitionHash).toBeDefined()
  })
})
