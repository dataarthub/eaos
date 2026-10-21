import type { WorkflowInstanceRecord, WorkflowInstanceStatus } from '@alneas/eaos-core'
import type { AgentGraphState, AgentGraphEngine } from './graph'
import { ServerWorkflowManager, type ServerWorkflowOptions } from './workflow-manager'
import type { ServerApprovalCallbackPayload } from './types'

/**
 * Durable business-instance record with host compare-and-swap revision.
 * @see DurableWorkflowCoordinator.
 */
export interface StoredWorkflowInstance {
  /** Workflow instance ID, aligned with graph sessionId. */
  id: string
  /** Host CAS revision, starting at one for coordinator-created records. */
  revision: number
  /** Domain workflow instance metadata; graph payload remains in its checkpointer. */
  value: WorkflowInstanceRecord
}

/** Host-owned durable store for the companion workflow instance record.
 * @see DurableWorkflowCoordinator for usage.
 */
export interface WorkflowInstanceStore {
  /**
   * Reads an authorized tenant's companion instance.
   * @param tenantId - Verified owning tenant.
   * @param instanceId - Workflow session/instance ID.
   * @returns Stored record, or null if absent.
   * @throws Persistence failures propagate.
   
   * @example
   * ```typescript
   * import type { WorkflowInstanceStore } from "@alneas/eaos-server";
   * export async function readTenantInstance(
   *   store: WorkflowInstanceStore, verifiedTenantId: string, instanceId: string,
   * ) {
   *   const record = await store.read(verifiedTenantId, instanceId);
   *   return record?.value.status; // A missing instance yields undefined here.
   * }
   * ```
   */
  read(tenantId: string, instanceId: string): Promise<StoredWorkflowInstance | null>
  /**
   * Atomically inserts a new companion instance, rejecting duplicates.
   * @param tenantId - Verified owning tenant.
   * @param record - Initial revision-one queued record.
   * @returns No value; resolves when durable creation completes.
   * @throws Duplicate/conflicting identity or persistence failure must reject.
   
   * @example
   * ```typescript
   * import type { WorkflowInstanceStore } from "@alneas/eaos-server";
   * export async function createQueuedInstance(
   *   store: WorkflowInstanceStore, verifiedTenantId: string,
   *   initialRecord: Parameters<WorkflowInstanceStore["create"]>[1],
   * ) {
   *   // Supply an aligned, admitted revision-one queued record.
   *   await store.create(verifiedTenantId, initialRecord);
   * }
   * ```
   */
  create(tenantId: string, record: StoredWorkflowInstance): Promise<void>
  /**
   * Atomically replaces a companion record only if its revision matches.
   * @param tenantId - Verified owning tenant.
   * @param record - Replacement with incremented revision.
   * @param expectedRevision - Previously read revision required for CAS.
   * @returns True on replacement, false on stale revision.
   * @throws Persistence failures propagate.
   
   * @example
   * ```typescript
   * import type { WorkflowInstanceStore } from "@alneas/eaos-server";
   * export async function replaceTenantInstance(
   *   store: WorkflowInstanceStore, verifiedTenantId: string,
   *   nextRecord: Parameters<WorkflowInstanceStore["replace"]>[1], previouslyReadRevision: number,
   * ) {
   *   // nextRecord has the incremented revision; false means another writer won.
   *   return await store.replace(verifiedTenantId, nextRecord, previouslyReadRevision);
   * }
   * ```
   */
  replace(tenantId: string, record: StoredWorkflowInstance, expectedRevision: number): Promise<boolean>
}

/**
 * Workflow notification/approval callbacks plus durable companion-instance storage.
 * @see DurableWorkflowCoordinator.
 */
export interface DurableWorkflowCoordinatorOptions extends ServerWorkflowOptions {
  /** Host-authorized tenant-scoped store with atomic create and revision checks. */
  store: WorkflowInstanceStore
}

/**
 * Keeps the business workflow instance synchronized with the LangGraph
 * checkpoint without making either one the other's database implementation.
 * @remarks Checkpoint and companion record updates are separate operations; failures can leave them temporarily divergent. The host owns writer serialization, tenant authorization, durable stores, and reconciliation rather than blind retry after partial outcomes.
 * @example
 * ```typescript
 * import { DurableWorkflowCoordinator } from "@alneas/eaos-server/agentic/workflow-coordinator";
 * import type { DurableWorkflowCoordinatorOptions } from "@alneas/eaos-server/agentic/workflow-coordinator";
 * export function coordinator(options: DurableWorkflowCoordinatorOptions) { return new DurableWorkflowCoordinator(options); }
 * ```
 */
export class DurableWorkflowCoordinator extends ServerWorkflowManager {
  private readonly store: WorkflowInstanceStore

  /**
   * Captures workflow callbacks and required durable instance store.
   * @param options - Host store, approval notification, and live resume authorization.
   * @throws If store is missing.
   */
  constructor(options: DurableWorkflowCoordinatorOptions) {
    super(options)
    if (!options?.store) throw new Error('Workflow instance store is required')
    this.store = options.store
  }

  /**
   * Creates a queued companion instance then runs and persists its graph outcome.
   * @param graph - Configured graph with appropriate checkpoint persistence.
   * @param record - Host-admitted instance metadata; instanceId and tenantId must match initialState.
   * @param initialState - Verified workflow identity and starting state.
   * @returns Graph state after execution and companion CAS persistence.
   * @throws Rejects alignment mismatch, existing instance, graph/callback/clone/store failures, or companion revision conflict.
   * @remarks The queued record can exist even if graph execution later fails; no cross-store rollback occurs. Atomic duplicate prevention belongs to store.create.
   * @example
   * ```typescript
   * import { DurableWorkflowCoordinator } from "@alneas/eaos-server/agentic/workflow-coordinator";
   * import type { AgentGraphEngine, AgentGraphState } from "@alneas/eaos-server/agentic/graph";
   * import type { WorkflowInstanceRecord } from "@alneas/eaos-core";
   * export async function start(coordinator: DurableWorkflowCoordinator, graph: AgentGraphEngine, record: WorkflowInstanceRecord, state: AgentGraphState) { return coordinator.start(graph, record, state); }
   * ```
   */
  async start(graph: AgentGraphEngine, record: WorkflowInstanceRecord, initialState: AgentGraphState): Promise<AgentGraphState> {
    if (record.instanceId !== initialState.sessionId || record.tenantId !== initialState.tenantId) throw new Error('Workflow instance and graph state are not aligned')
    const existing = await this.store.read(record.tenantId, record.instanceId)
    if (existing) throw new Error('Workflow instance already exists')
    await this.store.create(record.tenantId, { id: record.instanceId, revision: 1, value: { ...structuredClone(record), status: 'queued' } })
    return this.runAndPersist(graph, initialState)
  }

  /**
   * Runs an existing graph instance and CAS-updates its companion status.
   * @param graph - Graph whose session already has a companion record.
   * @param initialState - Verified state aligned with that record.
   * @returns Graph result after companion persistence; status prioritizes pending approval, error, completion, then running.
   * @throws Graph/store/clock failures, missing companion, or changed revision; graph checkpoints may already have advanced.
   * @example
   * ```typescript
   * import { DurableWorkflowCoordinator } from "@alneas/eaos-server/agentic/workflow-coordinator";
   * import type { AgentGraphEngine, AgentGraphState } from "@alneas/eaos-server/agentic/graph";
   * export async function run(coordinator: DurableWorkflowCoordinator, graph: AgentGraphEngine, state: AgentGraphState) { return coordinator.runWorkflow(graph, state); }
   * ```
   */
  override async runWorkflow(graph: AgentGraphEngine, initialState: AgentGraphState): Promise<AgentGraphState> {
    return this.runAndPersist(graph, initialState)
  }

  /**
   * Resumes a verified graph approval then persists its resulting companion state.
   * @param graph - Graph owning the pending checkpoint.
   * @param payload - Host-authenticated approver decision and optional binding checks.
   * @returns Resume outcome; companion persistence failure becomes resumed:false error data even when graph resume already succeeded.
   * @throws Underlying graph/store failures outside normalized resume/persistence handling may reject.
   * @remarks A false result does not prove no side effects occurred; reconcile graph and companion state before retrying.
   * @example
   * ```typescript
   * import { DurableWorkflowCoordinator } from "@alneas/eaos-server/agentic/workflow-coordinator";
   * import type { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * import type { ServerApprovalCallbackPayload } from "@alneas/eaos-server/agentic/types";
   * export async function approve(coordinator: DurableWorkflowCoordinator, graph: AgentGraphEngine, payload: ServerApprovalCallbackPayload) { return coordinator.handleApproval(graph, payload); }
   * ```
   */
  override async handleApproval(graph: AgentGraphEngine, payload: ServerApprovalCallbackPayload): Promise<{ 
  /** True only when graph resumption and companion-instance persistence complete; false may also mean companion persistence failed after the graph advanced. */
  resumed: boolean; 
  /** Optional resumed graph state returned when companion persistence succeeds; omitted when companion persistence is normalized into failure data. */
  state?: AgentGraphState; 
  /** Optional graph resume or companion persistence failure detail; reconcile both stores before retrying because graph effects may already have completed. */
  error?: string }> {
    const result = await super.handleApproval(graph, payload)
    if (result.resumed && result.state) {
      try { await this.persist(result.state) } catch (error) { return { resumed: false, error: error instanceof Error ? error.message : 'Workflow instance persistence failed' } }
    }
    return result
  }

  private async runAndPersist(graph: AgentGraphEngine, state: AgentGraphState): Promise<AgentGraphState> {
    const result = await super.runWorkflow(graph, state)
    await this.persist(result)
    return result
  }

  private async persist(state: AgentGraphState): Promise<void> {
    const current = await this.store.read(state.tenantId, state.sessionId)
    if (!current) throw new Error(`Workflow instance '${state.sessionId}' not found`)
    const value: WorkflowInstanceRecord = {
      ...current.value,
      status: statusForState(state),
      checkpointRevision: state.checkpointRevision,
      updatedAt: new Date().toISOString(),
      ...(state.error ? { error: state.error } : { error: undefined }),
    }
    if (!await this.store.replace(state.tenantId, { ...current, revision: current.revision + 1, value }, current.revision)) throw new Error('Workflow instance revision changed')
  }
}

function statusForState(state: AgentGraphState): WorkflowInstanceStatus {
  if (state.pendingApproval) return 'waiting_approval'
  if (state.error) return 'failed'
  if (state.isComplete) return 'completed'
  return 'running'
}
