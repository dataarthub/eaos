import { describe, expect, it } from 'bun:test'
import { createDomainEventBus } from '@alneas/eaos-core'
import { ServerAutonomousWorker } from '../src/agentic/autonomous-worker'
import { EventAgentBridge, InMemoryEventAgentTaskStore, type QueuedEventTask } from '../src/agentic/event-bridge'

describe('EventAgentBridge (DomainEventBus -> Autonomous Agent Trigger)', () => {
  it('triggers an autonomous agent task when a subscribed domain event is published', async () => {
    const executedTasks: any[] = []
    const eventBus = createDomainEventBus()
    const worker = new ServerAutonomousWorker({
      executors: {
        goose: async (request) => {
          executedTasks.push(request)
          return `Processed: ${request.title}`
        },
      },
    })

    const bridge = new EventAgentBridge(eventBus, worker)

    // ルール登録: 請求書作成イベント発生時に、夜間・自動突合エージェントを自律起動
    bridge.registerRule({
      eventName: 'estate-invoices.created',
      createTask: (payload: any) => {
        if (!payload || !payload.invoiceId) return null
        return {
          tenantId: payload.tenantId,
          userId: 'event_agent_bot',
          title: `Reconcile invoice ${payload.invoiceId}`,
          instructions: `Verify invoice ${payload.invoiceId} against contract terms and check amounts.`,
          workerType: 'goose',
          context: { invoiceId: payload.invoiceId },
        }
      },
    })

    // イベント発行
    eventBus.publish('estate-invoices.created', {
      tenantId: 'tenant_alpha',
      invoiceId: 'inv_9988',
      amount: 150000,
    })

    // 非同期タスクの実行を待つ
    await bridge.whenIdle()

    expect(executedTasks.length).toBe(1)
    expect(executedTasks[0].tenantId).toBe('tenant_alpha')
    expect(executedTasks[0].title).toBe('Reconcile invoice inv_9988')
    expect(executedTasks[0].instructions).toContain('Verify invoice inv_9988')
  })

  it('ignores events that do not match the filter criteria', async () => {
    const executedTasks: any[] = []
    const eventBus = createDomainEventBus()
    const worker = new ServerAutonomousWorker({
      executors: {
        goose: async (request) => {
          executedTasks.push(request)
          return `Processed: ${request.title}`
        },
      },
    })

    const bridge = new EventAgentBridge(eventBus, worker)

    bridge.registerRule({
      eventName: 'estate-invoices.created',
      createTask: (payload: any) => {
        if (payload?.status !== 'pending_review') return null
        return {
          tenantId: payload.tenantId,
          userId: 'bot',
          title: 'Review required',
          instructions: 'Review pending invoice',
          workerType: 'goose',
        }
      },
    })

    eventBus.publish('estate-invoices.created', {
      tenantId: 'tenant_alpha',
      invoiceId: 'inv_123',
      status: 'already_paid',
    })

    await bridge.whenIdle()

    expect(executedTasks.length).toBe(0)
  })

  it('bounds concurrent worker executions and rejects tasks beyond the queue limit', async () => {
    const eventBus = createDomainEventBus()
    let active = 0
    let maximumActive = 0
    let executed = 0
    const worker = new ServerAutonomousWorker({
      executors: {
        goose: async () => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await new Promise(resolve => setTimeout(resolve, 5))
          active -= 1
          executed += 1
          return 'done'
        },
      },
    })
    const errors: string[] = []
    const bridge = new EventAgentBridge(eventBus, worker, { maxConcurrent: 2, maxQueueSize: 2, onError: detail => errors.push(detail.phase) })
    bridge.registerRule({
      eventName: 'invoice.created',
      createTask: payload => ({
        tenantId: 'tenant_alpha',
        userId: 'bot',
        title: `Task ${(payload as { id: number }).id}`,
        instructions: 'process',
        workerType: 'goose',
      }),
    })

    for (let id = 0; id < 6; id += 1) eventBus.publish('invoice.created', { id })
    await bridge.whenIdle()

    expect(maximumActive).toBe(2)
    expect(executed).toBe(4)
    expect(errors.filter(phase => phase === 'queue').length).toBe(2)
  })

  it('surfaces pending approvals and worker failures to host callbacks', async () => {
    const eventBus = createDomainEventBus()
    const pending: string[] = []
    const errors: string[] = []
    const worker = {
      runTask: async (request: { id: string }) => request.id.endsWith('1')
        ? { taskId: request.id, status: 'PENDING_APPROVAL' as const, approvalTicketId: 'ticket-1', durationMs: 1 }
        : Promise.reject(new Error('worker unavailable')),
    } as unknown as ServerAutonomousWorker
    const bridge = new EventAgentBridge(eventBus, worker, {
      maxConcurrent: 1,
      onPendingApproval: item => pending.push(item.result.approvalTicketId ?? 'missing'),
      onError: detail => errors.push(detail.phase),
    })
    bridge.registerRule({
      eventName: 'invoice.updated',
      createTask: payload => ({
        tenantId: 'tenant_alpha',
        userId: 'bot',
        title: `Task ${(payload as { id: number }).id}`,
        instructions: 'process',
        workerType: 'goose',
      }),
    })

    eventBus.publish('invoice.updated', { id: 1 })
    eventBus.publish('invoice.updated', { id: 2 })
    await bridge.whenIdle()

    expect(pending).toEqual(['ticket-1'])
    expect(errors).toEqual(['runTask'])
  })

  it('unregisters the event listener when the last rule is removed', async () => {
    const eventBus = createDomainEventBus()
    const executedTasks: string[] = []
    const worker = new ServerAutonomousWorker({ executors: { goose: async request => { executedTasks.push(request.id); return 'done' } } })
    const bridge = new EventAgentBridge(eventBus, worker)
    const unregister = bridge.registerRule({
      eventName: 'invoice.deleted',
      createTask: () => ({ tenantId: 'tenant_alpha', userId: 'bot', title: 'Delete', instructions: 'process', workerType: 'goose' }),
    })
    unregister()
    eventBus.publish('invoice.deleted', {})
    await bridge.whenIdle()

    expect(executedTasks).toEqual([])
  })

  it('dispatches every rule registered for the same event', async () => {
    const eventBus = createDomainEventBus()
    const executedTitles: string[] = []
    const worker = new ServerAutonomousWorker({ executors: { goose: async request => { executedTitles.push(request.title); return 'done' } } })
    const bridge = new EventAgentBridge(eventBus, worker)
    const task = (title: string) => ({ tenantId: 'tenant_alpha', userId: 'bot', title, instructions: 'process', workerType: 'goose' as const })
    bridge.registerRule({ eventName: 'invoice.created', createTask: () => task('reconcile') })
    bridge.registerRule({ eventName: 'invoice.created', createTask: () => task('notify') })

    eventBus.publish('invoice.created', {})
    await bridge.whenIdle()

    expect(executedTitles.sort()).toEqual(['notify', 'reconcile'])
  })

  it('reports rule errors and continues processing later rules and events', async () => {
    const eventBus = createDomainEventBus()
    const executed: string[] = []
    const errors: string[] = []
    const worker = new ServerAutonomousWorker({ executors: { goose: async request => { executed.push(request.title); return 'done' } } })
    const bridge = new EventAgentBridge(eventBus, worker, { onError: detail => errors.push(detail.phase) })
    bridge.registerRule({ eventName: 'invoice.repaired', createTask: () => { throw new Error('bad event payload') } })
    bridge.registerRule({ eventName: 'invoice.repaired', createTask: () => ({ tenantId: 'tenant_alpha', userId: 'bot', title: 'recover', instructions: 'process', workerType: 'goose' }) })

    eventBus.publish('invoice.repaired', {})
    eventBus.publish('invoice.repaired', {})
    await bridge.whenIdle()

    expect(executed).toEqual(['recover', 'recover'])
    expect(errors).toEqual(['createTask', 'createTask'])
  })

  it('persists event tasks through a host store and drains them explicitly', async () => {
    const eventBus = createDomainEventBus()
    const queued: QueuedEventTask[] = [], completed: string[] = [], failed: string[] = [], executed: string[] = []
    const worker = new ServerAutonomousWorker({ executors: { goose: async request => { executed.push(request.id); return 'durable-done' } } })
    const store = {
      enqueue: async (task: QueuedEventTask) => { queued.push(task) },
      claim: async (limit: number) => queued.splice(0, limit),
      complete: async (taskId: string) => { completed.push(taskId) },
      fail: async (taskId: string) => { failed.push(taskId) },
    }
    const bridge = new EventAgentBridge(eventBus, worker, { taskStore: store })
    bridge.registerRule({ eventName: 'invoice.durable', createTask: () => ({ tenantId: 'tenant_alpha', userId: 'bot', title: 'durable', instructions: 'process', workerType: 'goose' }) })
    eventBus.publish('invoice.durable', { tenantId: 'tenant_alpha', invoiceId: 'inv-1' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(queued).toHaveLength(1)
    const taskId = queued[0].task.id
    expect(executed).toEqual([])
    expect(await bridge.runDurableOnce()).toEqual({ claimed: 1, completed: 1, failed: 0 })
    expect(executed).toHaveLength(1)
    expect(completed).toEqual([taskId])
    expect(failed).toEqual([])
  })

  it('provides an explicit idempotency key for event-triggered tasks', async () => {
    const eventBus = createDomainEventBus()
    const executed: any[] = []
    const worker = new ServerAutonomousWorker({ executors: { goose: async request => { executed.push(request); return 'done' } } })
    const bridge = new EventAgentBridge(eventBus, worker)
    bridge.registerRule({ eventName: 'invoice.idempotency', createTask: () => ({ tenantId: 'tenant_alpha', userId: 'bot', title: 'idempotent', instructions: 'process', workerType: 'goose' }) })

    eventBus.publish('invoice.idempotency', {})
    await bridge.whenIdle()

    expect(executed[0].executionContext.idempotencyKey).toMatch(/^event-agent:invoice\.idempotency:/)
  })

  it('offers a process-local task store for development without pretending it is durable', async () => {
    const store = new InMemoryEventAgentTaskStore({ maxTasks: 2 })
    const task: QueuedEventTask = { eventName: 'invoice.local', payload: { invoiceId: 'inv-1' }, task: { id: 'task-1', tenantId: 'tenant-1', userId: 'bot', title: 'local', instructions: 'process', workerType: 'goose' } }
    await store.enqueue(task)
    await store.enqueue(task)
    expect(await store.claim(1)).toEqual([task])
    await store.complete('task-1', { taskId: 'task-1', status: 'COMPLETED', output: 'ok', durationMs: 1 })
    expect(store.getResult('task-1')?.output).toBe('ok')
    await expect(store.enqueue({ ...task, task: { ...task.task, title: 'conflict' } })).rejects.toThrow('Conflicting duplicate')
  })
})
