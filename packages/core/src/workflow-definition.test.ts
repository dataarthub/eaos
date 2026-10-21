import { describe, expect, it } from 'bun:test'
import { evaluateWorkflowCondition, validateWorkflowDefinition, WORKFLOW_DEFINITION_SCHEMA } from './workflow-definition'

const definition = {
  schemaVersion: '1.0' as const,
  workflowId: 'invoice.review',
  version: '1.0.0',
  entryNode: 'extract',
  nodes: [
    { id: 'extract', type: 'invoice.extract', kind: 'agent' as const },
    { id: 'review', type: 'invoice.review', kind: 'approval' as const, approval: { toolName: 'invoice.register', approvalLevel: 'L3_MANAGER' as const, riskLevel: 'high' as const, reason: '登録前の確認', argsPath: 'context.args' } },
    { id: 'done', type: 'invoice.done', kind: 'effect' as const },
  ],
  edges: [
    { from: 'extract', to: 'review', condition: { path: 'context.confidence', operator: 'less_than' as const, value: 0.8 } },
    { from: 'extract', to: 'done', default: true },
    { from: 'review', to: 'done' },
  ],
}

describe('workflow definition contract', () => {
  it('exports a JSON Schema and validates a bounded definition', () => {
    expect(WORKFLOW_DEFINITION_SCHEMA.$id).toContain('workflow-definition-1.0')
    expect(validateWorkflowDefinition(definition)).toEqual(definition)
  })

  it('rejects unsafe or ambiguous definitions', () => {
    expect(() => validateWorkflowDefinition({ ...definition, edges: [{ from: 'extract', to: 'missing' }] })).toThrow('unknown node')
    expect(() => validateWorkflowDefinition({ ...definition, edges: [{ from: 'extract', to: 'review', condition: { path: 'context.x', operator: 'exists' }, default: true }, { from: 'extract', to: 'done', default: true }] })).toThrow('multiple default')
  })

  it('evaluates only the structured condition language', () => {
    const input = { context: { status: 'needs_review', score: 0.62, tags: ['invoice'] } }
    expect(evaluateWorkflowCondition({ path: 'context.status', operator: 'equals', value: 'needs_review' }, input)).toBe(true)
    expect(evaluateWorkflowCondition({ all: [{ path: 'context.score', operator: 'less_than', value: 0.8 }, { path: 'context.status', operator: 'equals', value: 'needs_review' }] }, input)).toBe(true)
    expect(evaluateWorkflowCondition({ any: [{ path: 'context.missing', operator: 'exists' }, { path: 'context.score', operator: 'greater_than', value: 0.5 }] }, input)).toBe(true)
  })
})
