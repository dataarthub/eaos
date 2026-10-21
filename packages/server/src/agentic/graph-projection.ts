import type { GraphProjectionAdapter, GraphProjectionCursor, WorkflowEventEnvelope } from '@alneas/eaos-core'

/**
 * Host persistence for per-projection, per-tenant progress and failure state.
 * @see GraphProjectionCoordinator.
 */
export interface ProjectionCursorStore {
  /**
   * Reads current projection progress for a tenant.
   * @param projectionId - Host projection identifier.
   * @param tenantId - Verified event/snapshot tenant.
   * @returns Stored cursor, or null when absent.
   * @throws Store errors propagate to the coordinator.
   
   * @example
   * ```typescript
   * import type { ProjectionCursorStore } from "@alneas/eaos-server";
   * export async function inspectTenantProjection(
   *   store: ProjectionCursorStore, projectionId: string, verifiedTenantId: string,
   * ) {
   *   const cursor = await store.get(projectionId, verifiedTenantId);
   *   return cursor?.status; // Null means no cursor was stored.
   * }
   * ```
   */
  get(projectionId: string, tenantId: string): Promise<GraphProjectionCursor | null>
  /**
   * Persists replacement projection progress.
   * @param cursor - Full progress/failure cursor to store.
   * @returns No value; resolves after persistence.
   * @throws Store errors propagate; the projection adapter may already have applied changes.
   
   * @example
   * ```typescript
   * import type { ProjectionCursorStore } from "@alneas/eaos-server";
   * export async function saveProjectionProgress(
   *   store: ProjectionCursorStore, cursor: Parameters<ProjectionCursorStore["put"]>[0],
   * ) {
   *   // The host aligns this tenant cursor with committed projection work.
   *   await store.put(cursor);
   * }
   * ```
   */
  put(cursor: GraphProjectionCursor): Promise<void>
}

/**
 * Host projection adapter, cursor persistence, and clock for {@link GraphProjectionCoordinator}.
 */
export interface GraphProjectionCoordinatorOptions {
  /** Nonblank projection identifier; retained exactly without trimming. */
  projectionId: string
  /** Host relationship-model adapter; must define idempotency and transaction policy. */
  adapter: GraphProjectionAdapter
  /** Host cursor persistence, separate from adapter transactions unless the host coordinates them. */
  cursorStore: ProjectionCursorStore
  /** Clock for ISO progress timestamps; defaults to a fresh Date. */
  now?: () => Date
}

/**
 * Applies domain events to an ADB Graph/PGQL or other relationship read model.
 *
 * The coordinator is intentionally independent of Oracle. The host supplies
 * the adapter and cursor store, so credentials, graph schema and transaction
 * policy never enter core/server.
 * @remarks Calls are not serialized by this class. The host must coordinate writers/rebuilds, authorize tenant data, and make adapter replay safe. Adapter changes and cursor writes are separate operations; a cursor failure can leave projection data applied but unacknowledged.
 * @example
 * ```typescript
 * import { GraphProjectionCoordinator, type GraphProjectionCoordinatorOptions } from "@alneas/eaos-server/agentic/graph-projection";
 * export function projection(options: GraphProjectionCoordinatorOptions) {
 *   return new GraphProjectionCoordinator(options);
 * }
 * ```
 */
export class GraphProjectionCoordinator {
  private readonly now: () => Date
  private readonly options: GraphProjectionCoordinatorOptions

  /**
   * Captures a host projection identity, adapter, cursor store, and optional clock.
   * @param options - Host projection dependencies.
   * @throws If projectionId is blank or adapter/cursorStore is absent.
   */
  constructor(options: GraphProjectionCoordinatorOptions) {
    if (!options?.projectionId?.trim() || !options.adapter || !options.cursorStore) throw new Error('Projection id, adapter and cursor store are required')
    this.options = options
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Applies one event and records projection progress, skipping recognized duplicate/stale events.
   * @param event - Trusted workflow event envelope; the adapter receives a structured clone.
   * @returns No value; resolves after application and cursor persistence or immediately for the last event ID or a nonincreasing revision of the last aggregate.
   * @throws Rejects rebuilding state, cursor/clock/clone failures, or adapter failures. Adapter failure attempts a failed cursor write, which can itself replace the original error.
   * @remarks A revision gap for the last aggregate increments lagCount and records lagging but still applies the event. Deduplication covers only the last event/aggregate cursor, not full history. Failure may occur after adapter side effects; no rollback or retry occurs here.
   * @example
   * ```typescript
   * import { GraphProjectionCoordinator, type GraphProjectionCoordinatorOptions } from "@alneas/eaos-server/agentic/graph-projection";
   * import type { WorkflowEventEnvelope } from "@alneas/eaos-core";
   * export async function apply(options: GraphProjectionCoordinatorOptions, event: WorkflowEventEnvelope) {
   *   await new GraphProjectionCoordinator(options).apply(event);
   * }
   * ```
   */
  async apply(event: Readonly<WorkflowEventEnvelope>): Promise<void> {
    const current = await this.options.cursorStore.get(this.options.projectionId, event.tenantId)
    if (current?.status === 'rebuilding') throw new Error('Graph projection is rebuilding')
    if (current?.lastEventId === event.eventId) return
    const sameAggregate = current?.lastAggregateType === event.aggregateType && current.lastAggregateId === event.aggregateId
    if (sameAggregate && current?.lastAggregateRevision !== undefined && event.aggregateRevision <= current.lastAggregateRevision) return
    const detectedGap = sameAggregate && current?.lastAggregateRevision !== undefined && event.aggregateRevision > current.lastAggregateRevision + 1

    const started: GraphProjectionCursor = {
      projectionId: this.options.projectionId,
      tenantId: event.tenantId,
      status: detectedGap ? 'lagging' : 'healthy',
      lastEventId: current?.lastEventId,
      lastAggregateRevision: current?.lastAggregateRevision,
      lagCount: (current?.lagCount ?? 0) + (detectedGap ? 1 : 0),
      updatedAt: this.now().toISOString(),
    }
    await this.options.cursorStore.put(started)
    try {
      await this.options.adapter.apply(structuredClone(event))
      await this.options.cursorStore.put({
        ...started,
        status: started.status,
        lastEventId: event.eventId,
        lastAggregateType: event.aggregateType,
        lastAggregateId: event.aggregateId,
        lastAggregateRevision: event.aggregateRevision,
        updatedAt: this.now().toISOString(),
        lastError: undefined,
      })
    } catch (error) {
      await this.options.cursorStore.put({
        ...started,
        status: 'failed',
        lagCount: started.lagCount + 1,
        updatedAt: this.now().toISOString(),
        lastError: error instanceof Error ? error.message.slice(0, 1_000) : 'Graph projection failed',
      })
      throw error
    }
  }

  /**
   * Marks a tenant projection rebuilding, delegates snapshot replacement, then records healthy or failed state.
   * @param tenantId - Verified tenant whose relationship model is rebuilt.
   * @param sourceRevision - Host source revision copied to the rebuilt cursor; not validated by this coordinator.
   * @param snapshot - Host-authorized snapshot cloned before passing to the adapter.
   * @returns No value; resolves after adapter rebuild and healthy cursor persistence.
   * @throws Rejects clock, cursor, clone, or adapter failures; a failed-status write can replace an earlier failure.
   * @remarks No cancellation or exclusive lock is acquired. The host must serialize rebuild/application and determine recovery after partial adapter or cursor failure.
   * @example
   * ```typescript
   * import { GraphProjectionCoordinator, type GraphProjectionCoordinatorOptions } from "@alneas/eaos-server/agentic/graph-projection";
   * export async function rebuild(options: GraphProjectionCoordinatorOptions, tenantId: string, revision: number, snapshot: unknown) {
   *   await new GraphProjectionCoordinator(options).rebuild(tenantId, revision, snapshot);
   * }
   * ```
   */
  async rebuild(tenantId: string, sourceRevision: number, snapshot: unknown): Promise<void> {
    const now = this.now().toISOString()
    await this.options.cursorStore.put({ projectionId: this.options.projectionId, tenantId, status: 'rebuilding', lagCount: 0, updatedAt: now })
    try {
      await this.options.adapter.rebuild({ tenantId, sourceRevision, snapshot: structuredClone(snapshot) })
      await this.options.cursorStore.put({ projectionId: this.options.projectionId, tenantId, status: 'healthy', lastAggregateRevision: sourceRevision, lagCount: 0, updatedAt: this.now().toISOString() })
    } catch (error) {
      await this.options.cursorStore.put({ projectionId: this.options.projectionId, tenantId, status: 'failed', lagCount: 1, updatedAt: this.now().toISOString(), lastError: error instanceof Error ? error.message.slice(0, 1_000) : 'Graph rebuild failed' })
      throw error
    }
  }
}
