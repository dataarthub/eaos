import { describe, expect, it } from 'bun:test'
import { parseWorkflowAgentProposal } from './workflow-contracts'
import { renderWorkflowDot, renderWorkflowMermaid } from './workflow-visualization'

describe('workflow agent contracts', () => {
  it('parses a proposal while leaving domain output validation to the plugin', () => {
    const proposal = parseWorkflowAgentProposal<{ severity: string }>(JSON.stringify({
      schemaVersion: '1.0',
      summary: 'Classified repair report',
      output: { severity: 'high' },
      evidence: [{ kind: 'record', source: 'repair:rep-1', revision: 3 }],
      actions: [{ toolName: 'estate_repairs_update', args: { id: 'rep-1' }, idempotencyKey: 'wf-1:update' }],
      riskLevel: 'high',
      confidence: 0.91,
    }))

    expect(proposal.output).toEqual({ severity: 'high' })
    expect(proposal.actions[0]?.toolName).toBe('estate_repairs_update')
  })

  it('rejects prose and malformed action envelopes', () => {
    expect(() => parseWorkflowAgentProposal('I completed the task')).toThrow('valid JSON')
    expect(() => parseWorkflowAgentProposal({
      schemaVersion: '1.0', summary: 'bad', output: {}, evidence: [], actions: [{ toolName: 'x', args: {} }], riskLevel: 'low',
    })).toThrow('Invalid workflow agent actions')
  })

  it('renders a workflow graph without treating labels or conditions as executable code', () => {
    const visualization = {
      graph: {
        schemaVersion: '1.0' as const,
        workflowId: 'invoice-review',
        entryNode: 'extract',
        nodes: [
          { id: 'extract', kind: 'agent' as const, label: '抽出', canRequestApproval: true },
          { id: 'approve', kind: 'approval' as const, label: '承認 "必要"', canRequestApproval: true },
        ],
        edges: [{ from: 'extract', to: 'approve', kind: 'conditional' as const, condition: 'confidence < 0.8' }],
      },
      runtime: { status: 'waiting_approval' as const, currentNodeId: 'approve' },
    }

    const mermaid = renderWorkflowMermaid(visualization)
    const dot = renderWorkflowDot(visualization)
    expect(mermaid).toContain('flowchart TD')
    expect(mermaid).toContain('confidence &lt; 0.8')
    expect(dot).toContain('digraph workflow')
    expect(dot).toContain('confidence < 0.8')
    expect(dot).toContain('\\"必要\\"')
  })
})
