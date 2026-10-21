import { canonicalJsonHash, type WorkflowDefinition, type WorkflowDefinitionLifecycle, validateWorkflowDefinition } from '@alneas/eaos-core'

/**
 * Versioned workflow definition with lifecycle, integrity hash, revision, and actor/timestamp metadata.
 * @see InMemoryWorkflowDefinitionRegistry.
 */
export interface WorkflowDefinitionRecord {
  /** Workflow identifier copied from the validated definition. */
  workflowId: string
  /** Immutable version key within a workflow after draft. */
  version: string
  /** Current draft/validated/approved/published/retired lifecycle phase. */
  status: WorkflowDefinitionLifecycle
  /** Validated serializable definition; returned records are cloned by this registry. */
  definition: WorkflowDefinition
  /** Canonical SHA-256 definition hash calculated on saveDraft. */
  definitionHash: string
  /** Record revision starting at one and incrementing on each saved transition. */
  revision: number
  /** Creation timestamp from the registry clock. */
  createdAt: string
  /** Latest transition timestamp from the registry clock. */
  updatedAt: string
  /** Optional first author label. */
  createdBy?: string
  /** Optional latest actor label. */
  updatedBy?: string
  /** Optional approval timestamp. */
  approvedAt?: string
  /** Optional approver label. */
  approvedBy?: string
  /** Optional publication timestamp. */
  publishedAt?: string
  /** Optional publisher label. */
  publishedBy?: string
  /** Optional retirement timestamp. */
  retiredAt?: string
  /** Optional retiring actor label. */
  retiredBy?: string
}

/**
 * Workflow authoring lifecycle contract; durable hosts must supply authorization and consistent persistence.
 * @see InMemoryWorkflowDefinitionRegistry for transition semantics.
 */
export interface WorkflowDefinitionRegistry {
  /**
   * Validates and inserts or replaces a draft version, incrementing its revision.
   * @param definition - Unknown workflow definition validated by core validation.
   * @param actorId - Optional author label recorded as creator/updater; not authenticated here.
   * @returns A cloned draft record with canonical definition hash.
   * @throws Invalid definition, non-draft existing version, clock/hash/clone failure.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function saveReviewedDraft(
   *   registry: WorkflowDefinitionRegistry,
   *   definition: Parameters<WorkflowDefinitionRegistry["saveDraft"]>[0], authenticatedActorId: string,
   * ) {
   *   // Supply a real host workflow definition with its registered node types.
   *   return registry.saveDraft(definition, authenticatedActorId);
   * }
   * ```
   */
  saveDraft(definition: unknown, actorId?: string): WorkflowDefinitionRecord
  /**
   * Transitions an existing draft to validated after core and optional host checks.
   * @param workflowId - Exact workflow identifier.
   * @param version - Exact stored version.
   * @param actorId - Optional updater label.
   * @returns A cloned validated record with incremented revision.
   * @throws Missing version, nondraft status, validation/callback/clock failure.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function validateStoredDraft(
   *   registry: WorkflowDefinitionRegistry, workflowId: string, version: string, actorId: string,
   * ) {
   *   const record = registry.validate(workflowId, version, actorId);
   *   return record.status; // Host/Core validation must succeed before transition.
   * }
   * ```
   */
  validate(workflowId: string, version: string, actorId?: string): WorkflowDefinitionRecord
  /**
   * Transitions a validated version to approved and records approver metadata.
   * @param workflowId - Exact workflow identifier.
   * @param version - Exact stored version.
   * @param actorId - Nonblank verified host approver label; no role check occurs here.
   * @returns A cloned approved record.
   * @throws Blank actor, missing version, nonvalidated status, or clock failure.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function approveValidatedWorkflow(
   *   registry: WorkflowDefinitionRegistry, workflowId: string, version: string, authorizedApproverId: string,
   * ) {
   *   // The host checks reviewer authority before requesting this lifecycle change.
   *   return registry.approve(workflowId, version, authorizedApproverId);
   * }
   * ```
   */
  approve(workflowId: string, version: string, actorId: string): WorkflowDefinitionRecord
  /**
   * Publishes an approved version and retires any currently published version of the same workflow.
   * @param workflowId - Exact workflow identifier.
   * @param version - Approved version to publish.
   * @param actorId - Nonblank verified host publisher label.
   * @returns A cloned published record; previous published records become retired.
   * @throws Blank actor, missing version, nonapproved status, or clock/clone failure; earlier retirement updates can already have occurred.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function publishApprovedWorkflow(
   *   registry: WorkflowDefinitionRegistry, workflowId: string, version: string, authorizedPublisherId: string,
   * ) {
   *   return registry.publish(workflowId, version, authorizedPublisherId);
   *   // Host execution can select the resulting published record explicitly.
   * }
   * ```
   */
  publish(workflowId: string, version: string, actorId: string): WorkflowDefinitionRecord
  /**
   * Transitions a published version to retired and records retirement metadata.
   * @param workflowId - Exact workflow identifier.
   * @param version - Currently published version.
   * @param actorId - Nonblank verified host operator label.
   * @returns A cloned retired record.
   * @throws Blank actor, missing version, nonpublished status, or clock failure.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function retirePublishedWorkflow(
   *   registry: WorkflowDefinitionRegistry, workflowId: string, version: string, authorizedActorId: string,
   * ) {
   *   return registry.retire(workflowId, version, authorizedActorId);
   * }
   * ```
   */
  retire(workflowId: string, version: string, actorId: string): WorkflowDefinitionRecord
  /**
   * Reads one workflow version without mutating lifecycle state.
   * @param workflowId - Exact workflow identifier.
   * @param version - Exact stored version.
   * @returns A cloned record, or undefined when absent.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function inspectWorkflowVersion(
   *   registry: WorkflowDefinitionRegistry, workflowId: string, version: string,
   * ) {
   *   return registry.get(workflowId, version); // Undefined when this version is absent.
   * }
   * ```
   */
  get(workflowId: string, version: string): WorkflowDefinitionRecord | undefined
  /**
   * Finds the currently published version of one workflow.
   * @param workflowId - Exact workflow identifier.
   * @returns A cloned published record, or undefined when none exists.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function inspectPublishedWorkflow(registry: WorkflowDefinitionRegistry, workflowId: string) {
   *   return registry.getPublished(workflowId); // Undefined when no version is published.
   * }
   * ```
   */
  getPublished(workflowId: string): WorkflowDefinitionRecord | undefined
  /**
   * Lists records in insertion order with optional workflow filtering.
   * @param workflowId - Exact workflow identifier to filter, or omit for all workflows.
   * @returns Independent cloned records, or an empty array.
   
   * @example
   * ```typescript
   * import type { WorkflowDefinitionRegistry } from "@alneas/eaos-server";
   * export function listWorkflowVersions(registry: WorkflowDefinitionRegistry, workflowId: string) {
   *   return registry.list(workflowId).map(record => ({ version: record.version, status: record.status }));
   * }
   * ```
   */
  list(workflowId?: string): readonly WorkflowDefinitionRecord[]
}

/**
 * Stores versioned workflow drafts and validated/approved/published/retired records in process memory.
 * @remarks Reference registry for tests/local authoring; it performs no actor authentication, role authorization, durable storage, or cross-process coordination. Transitions increment record revision and preserve definitions after draft.
 * @example
 * ```typescript
 * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
 * const registry = new InMemoryWorkflowDefinitionRegistry();
 * console.log(registry.list()); // []
 * ```
 */
export class InMemoryWorkflowDefinitionRegistry implements WorkflowDefinitionRegistry {
  private readonly records = new Map<string, WorkflowDefinitionRecord>()
  private readonly now: () => string
  private readonly validateDefinition?: (definition: WorkflowDefinition) => void

  /**
   * Captures authoring clock and optional semantic validation callback.
   * @param options - now returns a timestamp string and defaults to current ISO time; validate synchronously checks a structurally valid draft during validate and may throw.
   */
  constructor(options: { 
  /**
   * Optional timestamp-string clock used when creating/updating registry records; defaults to current ISO time.
   * @returns Timestamp text recorded without additional format validation by this registry.
   * @see {@link InMemoryWorkflowDefinitionRegistry.saveDraft}
   */
  now?: () => string; 
  /**
   * Optional synchronous host semantic validator called after Core structural validation during a draft-to-validated transition.
   * @param definition - Structurally valid stored workflow definition presented for host semantic checks.
   * @returns No value when accepted; throw to reject validation before the status update.
   * @remarks The callback receives the stored definition reference, so it should inspect without mutating it; this registry supplies no actor authentication or cross-process coordination.
   * @see {@link InMemoryWorkflowDefinitionRegistry.validate}
   */
  validate?: (definition: WorkflowDefinition) => void } = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.validateDefinition = options.validate
  }

  /**
   * Validates and inserts or replaces a draft version, incrementing its revision.
   * @param input - Unknown workflow definition validated by core validation.
   * @param actorId - Optional author label recorded as creator/updater; not authenticated here.
   * @returns A cloned draft record with canonical definition hash.
   * @throws Invalid definition, non-draft existing version, clock/hash/clone failure.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * export function draft(input: unknown) { return new InMemoryWorkflowDefinitionRegistry().saveDraft(input); }
   * ```
   */
  saveDraft(input: unknown, actorId?: string): WorkflowDefinitionRecord {
    const definition = validateWorkflowDefinition(input)
    const key = this.key(definition.workflowId, definition.version)
    const current = this.records.get(key)
    if (current && current.status !== 'draft') throw new Error(`Workflow version '${definition.workflowId}@${definition.version}' is immutable after draft`)
    const timestamp = this.now()
    const record: WorkflowDefinitionRecord = {
      workflowId: definition.workflowId,
      version: definition.version,
      status: 'draft',
      definition,
      definitionHash: canonicalJsonHash(definition),
      revision: (current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(current?.createdBy ?? actorId ? { createdBy: current?.createdBy ?? actorId } : {}),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    }
    this.records.set(key, record)
    return clone(record)
  }

  /**
   * Transitions an existing draft to validated after core and optional host checks.
   * @param workflowId - Exact workflow identifier.
   * @param version - Exact stored version.
   * @param actorId - Optional updater label.
   * @returns A cloned validated record with incremented revision.
   * @throws Missing version, nondraft status, validation/callback/clock failure.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * export function validate(registry: InMemoryWorkflowDefinitionRegistry, workflowId: string, version: string) { return registry.validate(workflowId, version); }
   * ```
   */
  validate(workflowId: string, version: string, actorId?: string): WorkflowDefinitionRecord {
    const current = this.require(workflowId, version)
    if (current.status !== 'draft') throw new Error(`Workflow version '${workflowId}@${version}' is not a draft`)
    validateWorkflowDefinition(current.definition)
    this.validateDefinition?.(current.definition)
    return this.update(current, { status: 'validated', ...(actorId === undefined ? {} : { updatedBy: actorId }) })
  }

  /**
   * Transitions a validated version to approved and records approver metadata.
   * @param workflowId - Exact workflow identifier.
   * @param version - Exact stored version.
   * @param actorId - Nonblank verified host approver label; no role check occurs here.
   * @returns A cloned approved record.
   * @throws Blank actor, missing version, nonvalidated status, or clock failure.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * export function approve(registry: InMemoryWorkflowDefinitionRegistry, workflowId: string, version: string, actorId: string) { return registry.approve(workflowId, version, actorId); }
   * ```
   */
  approve(workflowId: string, version: string, actorId: string): WorkflowDefinitionRecord {
    if (!actorId.trim()) throw new Error('Workflow approver identity is required')
    const current = this.require(workflowId, version)
    if (current.status !== 'validated') throw new Error(`Workflow version '${workflowId}@${version}' must be validated before approval`)
    return this.update(current, { status: 'approved', approvedAt: this.now(), approvedBy: actorId, updatedBy: actorId })
  }

  /**
   * Publishes an approved version and retires any currently published version of the same workflow.
   * @param workflowId - Exact workflow identifier.
   * @param version - Approved version to publish.
   * @param actorId - Nonblank verified host publisher label.
   * @returns A cloned published record; previous published records become retired.
   * @throws Blank actor, missing version, nonapproved status, or clock/clone failure; earlier retirement updates can already have occurred.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * export function publish(registry: InMemoryWorkflowDefinitionRegistry, workflowId: string, version: string, actorId: string) { return registry.publish(workflowId, version, actorId); }
   * ```
   */
  publish(workflowId: string, version: string, actorId: string): WorkflowDefinitionRecord {
    if (!actorId.trim()) throw new Error('Workflow publisher identity is required')
    const current = this.require(workflowId, version)
    if (current.status !== 'approved') throw new Error(`Workflow version '${workflowId}@${version}' must be approved before publication`)
    for (const record of this.records.values()) {
      if (record.workflowId === workflowId && record.status === 'published') this.records.set(this.key(record.workflowId, record.version), this.update(record, { status: 'retired', retiredAt: this.now(), retiredBy: actorId }))
    }
    return this.update(current, { status: 'published', publishedAt: this.now(), publishedBy: actorId, updatedBy: actorId })
  }

  /**
   * Transitions a published version to retired and records retirement metadata.
   * @param workflowId - Exact workflow identifier.
   * @param version - Currently published version.
   * @param actorId - Nonblank verified host operator label.
   * @returns A cloned retired record.
   * @throws Blank actor, missing version, nonpublished status, or clock failure.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * export function retire(registry: InMemoryWorkflowDefinitionRegistry, workflowId: string, version: string, actorId: string) { return registry.retire(workflowId, version, actorId); }
   * ```
   */
  retire(workflowId: string, version: string, actorId: string): WorkflowDefinitionRecord {
    if (!actorId.trim()) throw new Error('Workflow retire identity is required')
    const current = this.require(workflowId, version)
    if (current.status !== 'published') throw new Error(`Workflow version '${workflowId}@${version}' is not published`)
    return this.update(current, { status: 'retired', retiredAt: this.now(), retiredBy: actorId, updatedBy: actorId })
  }

  /**
   * Reads one workflow version without mutating lifecycle state.
   * @param workflowId - Exact workflow identifier.
   * @param version - Exact stored version.
   * @returns A cloned record, or undefined when absent.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * console.log(new InMemoryWorkflowDefinitionRegistry().get("example", "1.0.0")); // undefined
   * ```
   */
  get(workflowId: string, version: string): WorkflowDefinitionRecord | undefined {
    const record = this.records.get(this.key(workflowId, version))
    return record ? clone(record) : undefined
  }

  /**
   * Finds the currently published version of one workflow.
   * @param workflowId - Exact workflow identifier.
   * @returns A cloned published record, or undefined when none exists.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * console.log(new InMemoryWorkflowDefinitionRegistry().getPublished("example")); // undefined
   * ```
   */
  getPublished(workflowId: string): WorkflowDefinitionRecord | undefined {
    const record = [...this.records.values()].find(item => item.workflowId === workflowId && item.status === 'published')
    return record ? clone(record) : undefined
  }

  /**
   * Lists records in insertion order with optional workflow filtering.
   * @param workflowId - Exact workflow identifier to filter, or omit for all workflows.
   * @returns Independent cloned records, or an empty array.
   * @example
   * ```typescript
   * import { InMemoryWorkflowDefinitionRegistry } from "@alneas/eaos-server/agentic/workflow-registry";
   * console.log(new InMemoryWorkflowDefinitionRegistry().list()); // []
   * ```
   */
  list(workflowId?: string): readonly WorkflowDefinitionRecord[] {
    return [...this.records.values()].filter(record => workflowId === undefined || record.workflowId === workflowId).map(clone)
  }

  private require(workflowId: string, version: string): WorkflowDefinitionRecord {
    const record = this.records.get(this.key(workflowId, version))
    if (!record) throw new Error(`Workflow version '${workflowId}@${version}' was not found`)
    return record
  }

  private update(current: WorkflowDefinitionRecord, patch: Partial<WorkflowDefinitionRecord>): WorkflowDefinitionRecord {
    const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: this.now() }
    this.records.set(this.key(current.workflowId, current.version), next)
    return clone(next)
  }

  private key(workflowId: string, version: string): string { return `${workflowId}@${version}` }
}

function clone(record: WorkflowDefinitionRecord): WorkflowDefinitionRecord { return structuredClone(record) }
