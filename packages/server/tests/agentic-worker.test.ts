import { describe, expect, it } from 'bun:test'
import { Annotation, Command, END, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import { ServerAutonomousWorker, ServerWorkflowManager, AgentGraphEngine } from '../src/index'

describe('ServerAutonomousWorker (Headless Goose, Hermes Agent & LiteLLM)', () => {
  it('executes headless Goose batch task safely on server', async () => {
    const worker = new ServerAutonomousWorker({ executors: { goose: async request => `goose executed: ${request.title}` } })

    const result = await worker.runTask({
      id: 'task_batch_001',
      tenantId: 'tenant_tokyo',
      userId: 'system_bot',
      title: 'Nightly Inventory Reconciliation',
      instructions: 'Reconcile stock differences with procurement receipts',
      workerType: 'goose',
    })

    expect(result.status).toBe('COMPLETED')
    expect(result.output).toContain('Nightly Inventory Reconciliation')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('executes a host-selected model through LiteLLM', async () => {
    const worker = new ServerAutonomousWorker({ executors: { litellm: async request => `litellm executed: ${request.title}` } })

    const result = await worker.runTask({
      id: 'task_hermes_002',
      tenantId: 'tenant_tokyo',
      userId: 'system_bot',
      title: 'Auto Categorize Unstructured Invoices',
      instructions: 'Parse invoice tables and map to accounting schemas',
      workerType: 'litellm',
    })

    expect(result.status).toBe('COMPLETED')
    expect(result.output).toContain('litellm executed')
  })

  it('executes NousResearch Hermes Agent with memory and skill accumulation', async () => {
    const worker = new ServerAutonomousWorker({ executors: { hermes_agent: async request => `Hermes Agent executed: ${request.title}` } })

    const result = await worker.runTask({
      id: 'task_hermes_agent_003',
      tenantId: 'tenant_tokyo',
      userId: 'system_bot',
      title: 'Analyze Monthly Variance and Extract SOP Skill',
      instructions: 'Examine ledger variances and generate reusable checking skill',
      workerType: 'hermes_agent',
    })

    expect(result.status).toBe('COMPLETED')
    expect(result.output).toContain('Hermes Agent')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('fails closed when a runtime is unavailable instead of returning simulated success', async () => {
    const worker = new ServerAutonomousWorker({ runtimeRole: 'ai', gooseBinaryPath: '/definitely/missing/goose' })
    const result = await worker.runTask({
      id: 'task_missing_runtime',
      tenantId: 'tenant_tokyo',
      userId: 'system_bot',
      title: 'Unavailable runtime',
      instructions: 'Run the unavailable worker',
      workerType: 'goose',
    })

    expect(result.status).toBe('FAILED')
    expect(result.error).toContain('runtime unavailable')
    expect(result.failureCode).toBe('AGENT_UNAVAILABLE')
    expect(result.retryable).toBe(true)
    expect(result.output).toBeUndefined()
  })
})

describe('ServerWorkflowManager (Long-running workflows & LINE approval callback)', () => {
  it('pauses workflow on approval gate and resumes on human callback', async () => {
    const graph = new AgentGraphEngine(new MemorySaver())
    const manager = new ServerWorkflowManager({ authorizeResume: async () => true })

    graph.addNode('check_budget', async (_state) => ({
      currentStep: 'check_budget',
      context: { requestedAmount: 2000000 },
    }))

    graph.addNode('payment_gate', async (_state) => ({
      currentStep: 'payment_gate',
      pendingApproval: {
        toolName: 'finance_wire_transfer',
        approvalLevel: 'L4_EXECUTIVE',
        riskLevel: 'critical',
        reason: 'Large wire transfer requires executive signoff',
        args: { amount: 2000000 },
      },
    }))

    graph.addNode('dispatch_transfer', async (_state) => ({
      currentStep: 'dispatch_transfer',
      context: { transferred: true },
      isComplete: true,
    }))

    graph.addEdge('check_budget', 'payment_gate')
    graph.addEdge('payment_gate', 'dispatch_transfer')
    graph.setEntryPoint('check_budget')

    // One LangGraph invocation runs all deterministic steps until the approval interrupt.
    let state = {
      sessionId: 'wf_transfer_101',
      tenantId: 'tenant_tokyo',
      userId: 'user_analyst',
      currentStep: 'check_budget',
      history: [],
      isComplete: false,
    }

    state = await manager.runWorkflow(graph, state)

    expect(state.pendingApproval).toBeDefined()
    expect(state.pendingApproval?.approvalLevel).toBe('L4_EXECUTIVE')
    expect(state.pendingApproval?.binding?.bindingHash).toBeDefined()

    const mismatched = await manager.handleApproval(graph, {
      taskId: 'wf_transfer_101', approvalId: state.pendingApproval?.approvalId, bindingHash: 'wrong-binding', approved: true, approverId: 'exec_tanaka', approverRole: 'EXECUTIVE',
    })
    expect(mismatched.resumed).toBe(false)
    expect(mismatched.error).toContain('binding')

    const revoked = await new ServerWorkflowManager({ authorizeResume: async () => false }).handleApproval(graph, {
      taskId: 'wf_transfer_101', approvalId: state.pendingApproval?.approvalId, approved: true, approverId: 'exec_tanaka', approverRole: 'EXECUTIVE',
    })
    expect(revoked.resumed).toBe(false)
    expect(revoked.error).toContain('authorization')

    // Step 2: Human approves via LINE Mini App callback
    const callbackResult = await manager.handleApproval(graph, {
      taskId: 'wf_transfer_101',
      approved: true,
      approverId: 'exec_tanaka',
      approverRole: 'EXECUTIVE',
      comment: 'Approved under Q3 budget allocation',
    })

    expect(callbackResult.resumed).toBe(true)
    expect(callbackResult.state?.pendingApproval).toBeUndefined()
    expect(callbackResult.state?.history.some((h) => h.content.includes('Approved by EXECUTIVE'))).toBe(true)

    const duplicate = await manager.handleApproval(graph, {
      taskId: 'wf_transfer_101', approved: true, approverId: 'exec_tanaka', approverRole: 'EXECUTIVE', comment: 'Duplicate callback',
    })
    expect(duplicate.resumed).toBe(false)
    expect(duplicate.error).toContain('not awaiting approval')
  })

  it('supports conditional routing and retries transient nodes inside LangGraph', async () => {
    const graph = new AgentGraphEngine(new MemorySaver())
    const manager = new ServerWorkflowManager({ authorizeResume: async () => true })
    let attempts = 0

    graph.addNode('classify', async () => {
      attempts += 1
      if (attempts === 1) throw new Error('transient provider failure')
      return { currentStep: 'classify', context: { route: 'requires_approval' } }
    }, { retryPolicy: { maxAttempts: 2 } })
    graph.addNode('auto_complete', async () => ({ currentStep: 'auto_complete', isComplete: true }))
    graph.addNode('approval_gate', async () => ({
      currentStep: 'approval_gate',
      pendingApproval: {
        toolName: 'invoice.register',
        approvalLevel: 'L3_MANAGER',
        riskLevel: 'high',
        reason: 'Registration changes the accounting record',
        args: { invoiceId: 'inv-1' },
      },
    }))
    graph.addNode('register', async () => ({ currentStep: 'register', context: { registered: true }, isComplete: true }))
    graph.addConditionalEdges('classify', state => state.context?.route === 'requires_approval' ? 'approval_gate' : 'auto_complete', ['approval_gate', 'auto_complete'])
    graph.addEdge('approval_gate', 'register')
    graph.setEntryPoint('classify')

    const pending = await manager.runWorkflow(graph, {
      sessionId: 'wf_invoice_201', tenantId: 'tenant_tokyo', userId: 'user_staff', currentStep: 'classify', history: [], isComplete: false,
    })
    expect(attempts).toBe(2)
    expect(pending.pendingApproval?.toolName).toBe('invoice.register')

    const completed = await manager.handleApproval(graph, {
      taskId: 'wf_invoice_201', approved: true, approverId: 'manager_1', approverRole: 'MANAGER',
    })
    expect(completed.resumed).toBe(true)
    expect(completed.state?.context).toEqual({ route: 'requires_approval', registered: true })
    expect(completed.state?.isComplete).toBe(true)
  })

  it('describes the workflow for viewers and overlays a checkpoint without exposing payload data', async () => {
    const graph = new AgentGraphEngine(new MemorySaver(), { workflowId: 'invoice-review', workflowVersion: '3', authorizeResume: async () => true })
    graph.addNode('classify', async () => ({ currentStep: 'classify', context: { secret: 'must not be serialized' } }), { visual: { kind: 'agent', label: '分類', pluginId: 'estate-invoices' } })
    graph.addNode('review', async () => ({ currentStep: 'review', pendingApproval: { toolName: 'invoice.review', approvalLevel: 'L3_MANAGER', riskLevel: 'high', reason: 'Manager review required', args: { invoiceId: 'inv-1' } } }), { visual: { kind: 'human_review', label: '確認', canRequestApproval: true } })
    graph.addNode('register', async () => ({ currentStep: 'register', isComplete: true }), { visual: { kind: 'effect', label: '登録', toolName: 'invoice.register' } })
    graph.addConditionalEdges('classify', state => state.context?.route === 'review' ? 'review' : 'register', ['review', 'register'], { labels: { review: '要確認', register: '自動登録' } })
    graph.addEdge('review', 'register', { visual: { kind: 'approval', label: '承認済み' } })
    graph.setEntryPoint('classify')

    const described = graph.describe()
    expect(described).toMatchObject({ workflowId: 'invoice-review', workflowVersion: '3', entryNode: 'classify' })
    expect(described.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'classify', kind: 'agent', label: '分類', pluginId: 'estate-invoices', canRequestApproval: true }),
      expect.objectContaining({ id: 'register', kind: 'effect', toolName: 'invoice.register' }),
    ]))
    expect(described.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'classify', to: 'review', kind: 'conditional', label: '要確認' }),
      expect.objectContaining({ from: 'classify', to: 'register', kind: 'conditional', label: '自動登録' }),
    ]))

    const pending = await graph.runStep({ sessionId: 'wf_visual_1', tenantId: 'tenant-1', userId: 'user-1', currentStep: 'classify', history: [], context: { route: 'review', secret: 'must not serialize' }, isComplete: false })
    const visualization = await graph.getVisualization('wf_visual_1')
    expect(visualization.runtime?.status).toBe('waiting_approval')
    expect(visualization.runtime?.currentNodeId).toBe('review')
    expect(visualization.runtime?.pendingApproval?.toolName).toBe('invoice.review')
    expect(JSON.stringify(visualization)).not.toContain('must not serialize')
    expect(pending.pendingApproval?.binding?.bindingHash).toBeDefined()
  })

  it('mounts a plugin-owned compiled LangGraph subgraph with explicit state mapping', async () => {
    const SubgraphState = Annotation.Root({ value: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }) })
    const subgraph = new StateGraph(SubgraphState)
      .addNode('double', async state => ({ value: state.value * 2 }))
      .addEdge(START, 'double')
      .addEdge('double', END)
      .compile({ checkpointer: new MemorySaver() })
    const graph = new AgentGraphEngine(new MemorySaver())
    graph.addSubgraph('plugin_calculation', subgraph, {
      mapInput: state => ({ value: Number(state.context?.value ?? 0) }),
      mapOutput: output => ({ context: { doubled: (output as { value: number }).value } }),
    })
    graph.setEntryPoint('plugin_calculation')

    const result = await graph.runStep({
      sessionId: 'wf_subgraph_301', tenantId: 'tenant_tokyo', userId: 'user_staff', currentStep: 'plugin_calculation',
      history: [], context: { value: 21 }, isComplete: false,
    })
    expect(result.context).toEqual({ value: 21, doubled: 42 })
    expect(result.isComplete).toBe(true)
  })

  it('maps a real nested LangGraph interrupt to parent approval and resumes the child checkpoint', async () => {
    const SubgraphState = Annotation.Root({ value: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }), approved: Annotation<boolean | undefined>({ reducer: (_left, right) => right }) })
    const child = new StateGraph(SubgraphState)
      .addNode('approval', async state => ({ approved: Boolean(interrupt({ type: 'approval', value: state.value })) }))
      .addNode('finish', async state => ({ value: state.value + (state.approved ? 1 : 0) }))
      .addEdge(START, 'approval')
      .addEdge('approval', 'finish')
      .addEdge('finish', END)
      .compile({ checkpointer: new MemorySaver() })
    const subgraph = {
      invoke: (input: unknown, config?: unknown) => {
        return child.invoke(input, { ...(config as object), durability: 'sync' } as any)
      },
      getState: (config?: unknown) => child.getState(config as any),
      resume: (input: unknown, decision: { approved: boolean }, config?: unknown) => {
        return child.invoke(new Command({ resume: decision.approved }), { ...(config as object), durability: 'sync' } as any)
      },
    }
    const graph = new AgentGraphEngine(new MemorySaver(), { authorizeResume: async () => true })
    graph.addSubgraph('plugin_review', subgraph, {
      mapInput: state => ({ value: Number(state.context?.value ?? 0) }),
      mapInterrupted: (_error, _state, nested) => {
        const value = (nested as { values?: { value?: number } } | undefined)?.values?.value
        return { pendingApproval: { toolName: 'plugin.review', approvalLevel: 'L2_LEAD', riskLevel: 'high', reason: 'Nested review requires approval', args: value === undefined ? {} : { value } } }
      },
      mapOutput: output => ({ context: { completedValue: (output as { value: number }).value } }),
    })
    graph.setEntryPoint('plugin_review')

    const initial = { sessionId: 'wf_nested_interrupt_401', tenantId: 'tenant_tokyo', userId: 'user_staff', currentStep: 'plugin_review', history: [], context: { value: 41 }, isComplete: false }
    const pending = await graph.runStep(initial)
    expect(pending.pendingApproval?.toolName).toBe('plugin.review')
    expect(pending.context?.__eaosSubgraphResume).toEqual({ node: 'plugin_review' })

    const resumed = await graph.resumeAfterApproval({ sessionId: initial.sessionId, approved: true, approverId: 'lead_1', approverRole: 'LEAD' })
    expect(resumed.resumed).toBe(true)
    expect(resumed.state?.context?.completedValue).toBe(42)
    expect(resumed.state?.pendingApproval).toBeUndefined()
    expect(resumed.state?.isComplete).toBe(true)
  })

})
