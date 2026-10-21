import type { AIExecutionContext } from './governance'

export type { AIHostAdapterName } from './governance'

/**
 * A side-effect request must be replay-safe and tied to the verified execution context.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIHostActionContext {
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AIExecutionContext
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
/** Optional request to preview rather than commit an effect; actual support/enforcement is adapter-owned. */
  dryRun?: boolean
  
  /** Optional host review metadata; an approved value must be established by a trusted host, never by model output. */
  approval?: {
    
    /** Host identity for the review request/decision associated with this operation. */
    approvalId: string
    
    /** Host-established review state; pending/rejected do not authorize a side effect. */
    status: 'pending' | 'approved' | 'rejected'
  }
  
/** Optional absolute deadline supplied to the host; Core does not schedule cancellation. */
  deadline?: string
}

/**
 * Host side-effect status; accepted/pending do not mean completed.
 * @see {@link isAIHostReceiptTerminal}
 */
export type AIHostOperationStatus = 'accepted' | 'completed' | 'pending' | 'failed' | 'unavailable'

/**
 * The only source of truth for an external side effect.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIHostReceipt {
  
/** Host adapter identity that binds routing/receipts to the implementation actually used. */
  adapterId: string
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: string
  
/** Provider/host identity of the effect receipt. */
  receiptId: string
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
  /** Host-reported operation lifecycle; only completed is considered successful by isAIHostReceiptSuccessful. */
  status: AIHostOperationStatus
  
/** Host timestamp at which the side-effect request was accepted. */
  acceptedAt: string
  
/** Optional host completion timestamp; absent while the effect remains unsettled. */
  completedAt?: string
  
/** Optional external resource identity reported by the provider. */
  externalId?: string
  
  /** Human-readable provider/failure explanation; do not include secrets in surfaced diagnostics. */
  message?: string
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Readonly<Record<string, unknown>>
}

/**
 * Optional domain value paired with an authoritative host receipt.
 * @see {@link isAIHostReceiptTerminal}
 * @typeParam T - Optional provider domain output; the receipt remains authoritative for completion.
 */
export interface AIHostResult<T> {
  
  
  /** Optional provider domain value; inspect receipt status before treating it as completed output. */
  value?: T
  
/** Authoritative host operation receipt; inspect its status/outcome before treating optional output as successful. */
  receipt: AIHostReceipt
}

/**
 * Host adapter identity and advertised operation capabilities.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIHostAdapter {
  
  /** Host adapter identity used to bind execution and receipts to a provider implementation. */
  readonly id: string
  
/** Advertised operation/capability names; presence alone does not authorize execution. */
  readonly capabilities: readonly string[]
}

/**
 * Provider-neutral calendar event fields for reads and mutations.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AICalendarEvent {
  
  /** Existing provider event identity; optional when proposing creation. */
  id?: string
  
  /** Human-readable draft, task, file or event title displayed by the host. */
  title: string
  
  
  /** Event start timestamp interpreted with the optional event timezone by the host calendar provider. */
  start: string
  
  
  /** Event end timestamp; the host calendar provider validates ordering and timezone semantics. */
  end: string
  
/** Optional timezone identifier used by the calendar provider. */
  timeZone?: string
  
/** Optional attendee addresses/identities accepted by the host calendar provider. */
  attendees?: readonly string[]
  
/** Optional event location text. */
  location?: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description?: string
  
/** Optional reminder offsets in minutes as interpreted by the calendar provider. */
  remindersMinutes?: readonly number[]
}

/**
 * Busy intervals for a calendar over a host-selected window.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AICalendarAvailability {
  
/** Calendar identity within the authorized host account. */
  calendarId: string
  
/** Provider-reported busy intervals with start/end timestamps. */
  busy: readonly { 
  
  /** Start timestamp of a provider-reported busy interval. */
  start: string; 
  
  /** End timestamp of a provider-reported busy interval. */
  end: string }[]
}

/**
 * Host-owned calendar reads and replay-safe event mutations.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AICalendarAdapter extends AIHostAdapter {
  
  /**
   * List authorized calendar events in a requested time window.
   * @param input - Window start/end and optional calendar IDs; provider defines interval boundaries and default calendars.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns The matching event array, possibly empty.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AICalendarAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AICalendarAdapter, context: AIExecutionContext) {
   *  return adapter.listEvents({ from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z" }, context);
   * }
   * ```
   */
  listEvents(input: { 
  
  /** Start timestamp of the calendar query window; host provider defines inclusivity and timezone handling. */
  from: string; 
  
  /** End timestamp of the calendar query window; host provider defines inclusivity and timezone handling. */
  to: string; 
/** Optional calendars within the authorized host account; omission uses adapter-defined selection. */
  calendarIds?: readonly string[] }, context: AIExecutionContext): Promise<readonly AICalendarEvent[]>
  
  /**
   * Read busy intervals for an availability search.
   * @param input - Window, requested duration in minutes and optional calendar IDs; host validates bounds.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Calendar busy-interval arrays; empty when none are returned.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AICalendarAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AICalendarAdapter, context: AIExecutionContext) {
   *  return adapter.findAvailability({ from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z", durationMinutes: 30 }, context);
   * }
   * ```
   */
  findAvailability(input: { 
  
  /** Start timestamp of the calendar query window; host provider defines inclusivity and timezone handling. */
  from: string; 
  
  /** End timestamp of the calendar query window; host provider defines inclusivity and timezone handling. */
  to: string; 
/** Requested availability duration in minutes; adapter validates its supported bounds. */
  durationMinutes: number; 
/** Optional calendars within the authorized host account; omission uses adapter-defined selection. */
  calendarIds?: readonly string[] }, context: AIExecutionContext): Promise<readonly AICalendarAvailability[]>
  
  /**
   * Request creation of an event through the admitted calendar host.
   * @param input - Event title/time range and optional attendee/location/reminder metadata.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional created event plus an authoritative receipt; acceptance may remain pending.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AICalendarAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AICalendarAdapter, context: AIHostActionContext) {
   *  return adapter.createEvent({ title: "Review", start: "2026-10-19T10:00:00Z", end: "2026-10-19T10:30:00Z" }, context);
   * }
   * ```
   */
  createEvent(input: AICalendarEvent, context: AIHostActionContext): Promise<AIHostResult<AICalendarEvent>>
  
  /**
   * Request an admitted update to an existing calendar event.
   * @param input - Existing event ID and replacement/update fields interpreted by the provider.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional updated event and host receipt; inspect receipt status before assuming completion.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AICalendarAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AICalendarAdapter, context: AIHostActionContext) {
   *  return adapter.updateEvent({ id: "event-1", title: "Review", start: "2026-10-19T10:00:00Z", end: "2026-10-19T10:30:00Z" }, context);
   * }
   * ```
   */
  updateEvent(input: AICalendarEvent & { 
  /** Existing provider event identity to update within authorized calendars. */
  id: string }, context: AIHostActionContext): Promise<AIHostResult<AICalendarEvent>>
  
  /**
   * Request cancellation of an authorized calendar event.
   * @param input - Existing event ID and optional human-readable cancellation reason.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Host receipt and optional provider result; completion is receipt-driven.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AICalendarAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AICalendarAdapter, context: AIHostActionContext) {
   *  return adapter.cancelEvent({ id: "event-1", reason: "Rescheduled" }, context);
   * }
   * ```
   */
  cancelEvent(input: { 
  /** Existing provider event identity to cancel within authorized calendars. */
  id: string; 
/** Human-readable explanation of the decision or requested action. */
  reason?: string }, context: AIHostActionContext): Promise<AIHostResult<unknown>>
}

/**
 * Provider-neutral email message metadata and optional plain-text content.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIEmailMessage {
  
  /** Provider message identity used for reads, replies and label actions. */
  id: string
  
/** Host conversation/thread identity for correlation. */
  threadId?: string
  
  
  /** Sender address/identity reported by the mail provider. */
  from: string
  
  
  /** Recipient addresses/identities reported by the mail provider. */
  to: readonly string[]
  
/** Email subject text passed to or returned by the host provider. */
  subject: string
  
/** Provider-reported email receive timestamp. */
  receivedAt: string
  
/** Plain-text email content; provider rendering and delivery policy remain host-owned. */
  bodyText?: string
  
/** Optional provider labels or metric dimensions carried without framework interpretation. */
  labels?: readonly string[]
}

/**
 * Draft recipients, subject and plain-text body, optionally tied to a reply.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIEmailDraft {
  
  /** Optional provider draft identity, normally populated after host draft creation. */
  id?: string
  
/** Optional existing message identity used when constructing a reply draft. */
  replyToMessageId?: string
  
  
  /** Intended recipient addresses; the host must authorize any later send. */
  to: readonly string[]
  
/** Optional copy-recipient addresses; host applies delivery authorization. */
  cc?: readonly string[]
  
/** Email subject text passed to or returned by the host provider. */
  subject: string
  
/** Plain-text email content; provider rendering and delivery policy remain host-owned. */
  bodyText: string
}

/**
 * Host-owned message reads, label changes, draft creation and sending.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIEmailAdapter extends AIHostAdapter {
  
  /**
   * Search messages in the authorized mail scope.
   * @param input - Provider query and optional count limit; syntax/defaults remain adapter-owned.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Matching message metadata/content, possibly empty.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIEmailAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIEmailAdapter, context: AIExecutionContext) {
   *  return adapter.searchMessages({ query: "subject:review", limit: 10 }, context);
   * }
   * ```
   */
  searchMessages(input: { 
/** Provider/host query text; syntax, authorization and limits are adapter-owned. */
  query: string; 
  /** Optional result-count bound; default and maximum are owned by the connected adapter. */
  limit?: number }, context: AIExecutionContext): Promise<readonly AIEmailMessage[]>
  
  /**
   * Read one authorized email message by provider identity.
   * @param input - Existing provider message ID.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Message when available, otherwise null.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIEmailAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIEmailAdapter, context: AIExecutionContext) {
   *  return adapter.getMessage({ id: "message-1" }, context);
   * }
   * ```
   */
  getMessage(input: { 
  /** Provider message identity within the authorized mail account. */
  id: string }, context: AIExecutionContext): Promise<AIEmailMessage | null>
  
  /**
   * Request admitted label changes on an email message.
   * @param input - Message ID and optional labels to add/remove; provider owns conflict semantics.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Host receipt and optional provider result.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIEmailAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIEmailAdapter, context: AIHostActionContext) {
   *  return adapter.applyLabels({ messageId: "message-1", add: ["reviewed"] }, context);
   * }
   * ```
   */
  applyLabels(input: { 
/** Existing message identity within the authorized mail account. */
  messageId: string; 
/** Optional labels to add to the selected message. */
  add?: readonly string[]; 
/** Optional labels to remove from the selected message. */
  remove?: readonly string[] }, context: AIHostActionContext): Promise<AIHostResult<unknown>>
  
  /**
   * Request a draft without implicitly sending it.
   * @param input - Recipients, subject/body and optional reply metadata.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional created draft and host receipt; sending requires a separate admitted action.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIEmailAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIEmailAdapter, context: AIHostActionContext) {
   *  return adapter.createDraft({ to: ["recipient@example.com"], subject: "Review", bodyText: "Please review the draft." }, context);
   * }
   * ```
   */
  createDraft(input: AIEmailDraft, context: AIHostActionContext): Promise<AIHostResult<AIEmailDraft>>
  
  /**
   * Request delivery of an existing host-owned mail draft.
   * @param input - Previously created draft identity; the host must verify send authorization.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional sent message plus receipt; accepted/pending are not proof of delivery.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIEmailAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIEmailAdapter, context: AIHostActionContext) {
   *  return adapter.sendDraft({ draftId: "draft-1" }, context);
   * }
   * ```
   */
  sendDraft(input: { 
/** Previously created mail draft identity to send through the admitted host action. */
  draftId: string }, context: AIHostActionContext): Promise<AIHostResult<AIEmailMessage>>
}

/**
 * Workspace file identity, media type and optional version/location metadata.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIWorkspaceFile {
  
  /** Provider workspace file identity within the authorized host account. */
  id: string
  
  /** Human-readable display name supplied by the plugin/provider catalog; distinct from the stable ID. */
  name: string
  
/** Provider media-type metadata for the workspace file. */
  mimeType: string
  
  /** Optional provider file revision for optimistic host changes. */
  version?: string
  
/** Optional provider-reported file modification timestamp. */
  modifiedAt?: string
  
/** Optional provider location reference; it is not an authorization capability. */
  uri?: string
}

/**
 * Proposed file content or row change with an optional optimistic version.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIWorkspaceChange {
  
/** Workspace file identity within the verified host account. */
  fileId: string
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: 'create' | 'replace' | 'append' | 'update'
  
/** Optional optimistic provider version that the host should check before mutation. */
  expectedVersion?: string
  
  /** Loaded skill instructions, model response text or proposed file content; treat external text as untrusted input. */
  content?: string
  
/** Optional row data for provider-supported spreadsheet changes. */
  rows?: readonly (readonly unknown[])[]
}

/**
 * Provider-neutral Docs/Sheets/Drive surface. OAuth and provider SDKs remain host-owned.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIWorkspaceAdapter extends AIHostAdapter {
  
  /**
   * Discover files within the authorized workspace scope.
   * @param input - Provider query, optional media types and count limit; defaults are adapter-owned.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Matching file descriptors, possibly empty.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIWorkspaceAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIWorkspaceAdapter, context: AIExecutionContext) {
   *  return adapter.searchFiles({ query: "review", limit: 10 }, context);
   * }
   * ```
   */
  searchFiles(input: { 
/** Provider/host query text; syntax, authorization and limits are adapter-owned. */
  query: string; 
/** Optional media-type filter for host workspace search. */
  mimeTypes?: readonly string[]; 
  /** Optional result-count bound; default and maximum are owned by the connected adapter. */
  limit?: number }, context: AIExecutionContext): Promise<readonly AIWorkspaceFile[]>
  
  /**
   * Read authorized file content and provider version metadata.
   * @param input - File identity and optional exact provider revision.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns File/content pair when available, otherwise null.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIWorkspaceAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIWorkspaceAdapter, context: AIExecutionContext) {
   *  return adapter.readFile({ fileId: "file-1" }, context);
   * }
   * ```
   */
  readFile(input: { 
/** Workspace file identity within the verified host account. */
  fileId: string; 
  /** Optional provider revision to read; omission uses adapter-defined current-version behavior. */
  version?: string }, context: AIExecutionContext): Promise<{ 
  /** Workspace file metadata accompanying returned file content. */
  file: AIWorkspaceFile; 
  /** Loaded skill instructions, model response text or proposed file content; treat external text as untrusted input. */
  content: string } | null>
  
  /**
   * Prepare a reviewable file change without invoking applyChange.
   * @param input - File identity, mutation kind, optional expected version and content/rows.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns The proposed structured change and human-readable summary.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIWorkspaceAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIWorkspaceAdapter, context: AIExecutionContext) {
   *  return adapter.proposeChange({ fileId: "file-1", operation: "append", content: "Review notes" }, context);
   * }
   * ```
   */
  proposeChange(input: AIWorkspaceChange, context: AIExecutionContext): Promise<{ 
/** Structured file change to review before an admitted apply operation. */
  change: AIWorkspaceChange; 
  /** Human-readable review/result description suitable for host presentation. */
  summary: string }>
  
  /**
   * Request an admitted workspace mutation with optional version precondition.
   * @param input - Reviewed file change and optional optimistic provider version.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional updated file descriptor and host receipt.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIWorkspaceAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIWorkspaceAdapter, context: AIHostActionContext) {
   *  return adapter.applyChange({ fileId: "file-1", operation: "append", content: "Review notes" }, context);
   * }
   * ```
   */
  applyChange(input: AIWorkspaceChange, context: AIHostActionContext): Promise<AIHostResult<AIWorkspaceFile>>
}

/**
 * Retrieved source excerpt with provider-defined relevance score and optional provenance.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIRetrievalDocument {
  
/** Stable retrieval source identity used to trace returned evidence. */
  sourceId: string
  
  /** Human-readable draft, task, file or event title displayed by the host. */
  title?: string
  
/** Source text excerpt; callers should preserve provenance when presenting it. */
  excerpt: string
  
/** Provider/detector relevance or anomaly score; interpret using the owning result contract. */
  score: number
  
/** Optional source/target revision interpreted by the owning host; approval/effect target revisions must be positive integers. */
  revision?: string
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Readonly<Record<string, unknown>>
}

/**
 * Tenant-scoped, read-only retrieval. Indexing and deletion remain Host/Action operations.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIRetrievalAdapter extends AIHostAdapter {
  
  /**
   * Retrieve tenant-scoped source excerpts from a host-owned index.
   * @param input - Query and optional topK/metadata filters; adapter owns defaults, limits and index authorization.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Retrieved excerpts with source IDs and provider scores, possibly empty.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIRetrievalAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIRetrievalAdapter, context: AIExecutionContext) {
   *  return adapter.search({ query: "review policy", topK: 5 }, context);
   * }
   * ```
   */
  search(input: {
    
/** Provider/host query text; syntax, authorization and limits are adapter-owned. */
    query: string
    
/** Requested maximum result count; vector request validation permits integers from 1 to 10000. */
    topK?: number
    
/** Optional host-approved metadata filters; physical field permissions and semantics remain adapter-owned. */
    filters?: Readonly<Record<string, string | number | boolean | readonly string[]>>
  }, context: AIExecutionContext): Promise<readonly AIRetrievalDocument[]>
}

/**
 * Travel provider offer with optional dates, price, currency and terms.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AITravelOffer {
  
  /** Provider offer identity to bind a later hold/booking request. */
  id: string
  
  /** Travel offer category used to select transport, lodging or another provider offer. */
  kind: 'transport' | 'lodging' | 'other'
  
  /** Provider identity from model metadata, travel discovery or connection/circuit health. */
  provider: string
  
  /** Human-readable draft, task, file or event title displayed by the host. */
  title: string
  
  
  /** Optional provider offer start/departure timestamp. */
  start?: string
  
  
  /** Optional provider offer end/arrival timestamp. */
  end?: string
  
/** Optional provider quoted price; its monetary units and rounding are provider-defined. */
  totalAmount?: number
  
  /** Currency identifier for reported cost/price; its units are defined by the provider/host contract. */
  currency?: string
  
/** Optional provider terms that the caller must review before booking. */
  terms?: string
}

/**
 * Host-owned travel discovery and replay-safe holds, bookings and cancellations.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AITravelAdapter extends AIHostAdapter {
  
  /**
   * Discover travel offers without creating holds or bookings.
   * @param input - Destination, outbound date, optional return date, traveler count and optional category.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Current provider offers, possibly empty; terms/prices may change before booking.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AITravelAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AITravelAdapter, context: AIExecutionContext) {
   *  return adapter.searchOffers({ destination: "Tokyo", departureDate: "2026-11-01", travelers: 1 }, context);
   * }
   * ```
   */
  searchOffers(input: { 
/** Destination query text interpreted by the travel provider. */
  destination: string; 
/** Outbound business date accepted by the travel provider. */
  departureDate: string; 
/** Optional return business date accepted by the travel provider. */
  returnDate?: string; 
/** Number of travelers; provider validates supported bounds. */
  travelers: number; 
  /** Travel offer category used to select transport, lodging or another provider offer. */
  kind?: AITravelOffer['kind'] }, context: AIExecutionContext): Promise<readonly AITravelOffer[]>
  
  /**
   * Request an admitted temporary hold on a discovered offer.
   * @param input - Offer ID and optional requested expiry; provider determines supported hold semantics.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional held offer plus host receipt.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AITravelAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AITravelAdapter, context: AIHostActionContext) {
   *  return adapter.holdOffer({ offerId: "offer-1" }, context);
   * }
   * ```
   */
  holdOffer(input: { 
/** Travel provider offer identity selected from trusted discovery results. */
  offerId: string; 
/** Optional absolute expiry; the owning validation/evaluation API determines whether it remains live. */
  expiresAt?: string }, context: AIHostActionContext): Promise<AIHostResult<AITravelOffer>>
  
  /**
   * Request an admitted booking for verified traveler identities.
   * @param input - Offer ID and host-verified traveler IDs; host must check authorization and current terms.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional booked offer and host receipt; pending status needs reconciliation.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AITravelAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AITravelAdapter, context: AIHostActionContext) {
   *  return adapter.bookOffer({ offerId: "offer-1", travelerIds: ["traveler-1"] }, context);
   * }
   * ```
   */
  bookOffer(input: { 
/** Travel provider offer identity selected from trusted discovery results. */
  offerId: string; 
/** Host-verified traveler identities used to complete a booking. */
  travelerIds: readonly string[] }, context: AIHostActionContext): Promise<AIHostResult<AITravelOffer>>
  
  /**
   * Request cancellation of an authorized existing booking.
   * @param input - Booking identity and optional cancellation reason.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Host receipt with optional provider cancellation data.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AITravelAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AITravelAdapter, context: AIHostActionContext) {
   *  return adapter.cancelBooking({ bookingId: "booking-1", reason: "Plans changed" }, context);
   * }
   * ```
   */
  cancelBooking(input: { 
/** Existing booking identity authorized for cancellation. */
  bookingId: string; 
/** Human-readable explanation of the decision or requested action. */
  reason?: string }, context: AIHostActionContext): Promise<AIHostResult<unknown>>
}

/**
 * Browser session identity and the origins permitted by its host.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIBrowserSession {
  
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId: string
  
/** Origins permitted by the browser host for this session. */
  allowedOrigins: readonly string[]
}

/**
 * Navigate, interact, wait or capture actions interpreted by a browser host.
 * @see {@link isAIHostReceiptTerminal}
 */
export type AIBrowserAction =
  | { 
  /** Browser action discriminator selecting navigation, interaction, waiting or capture fields. */
  type: 'navigate'; 
  /** Target/observed HTTP(S) location; adapter/host authorization must restrict navigation and delivery. */
  url: string }
  | { 
  /** Browser action discriminator selecting navigation, interaction, waiting or capture fields. */
  type: 'click'; 
/** Element selector interpreted within the authorized browser session. */
  selector: string }
  | { 
  /** Browser action discriminator selecting navigation, interaction, waiting or capture fields. */
  type: 'fill'; 
/** Element selector interpreted within the authorized browser session. */
  selector: string; 
  
  /** Text value to fill or option value to select in the authorized browser page. */
  value: string }
  | { 
  /** Browser action discriminator selecting navigation, interaction, waiting or capture fields. */
  type: 'select'; 
/** Element selector interpreted within the authorized browser session. */
  selector: string; 
  
  /** Text value to fill or option value to select in the authorized browser page. */
  value: string }
  | { 
  /** Browser action discriminator selecting navigation, interaction, waiting or capture fields. */
  type: 'waitFor'; 
/** Element selector interpreted within the authorized browser session. */
  selector: string; 
/** Optional execution deadline in milliseconds; enforcement belongs to the API/runtime consuming this metadata. */
  timeoutMs?: number }
  | { 
  /** Browser action discriminator selecting navigation, interaction, waiting or capture fields. */
  type: 'screenshot'; 
/** Optional request for full-page capture; omission uses the host browser default. */
  fullPage?: boolean }
  | { 
  /** Browser action discriminator selecting navigation, interaction, waiting or capture fields. */
  type: 'pdf' }

/**
 * Current browser URL and optional title, text and screenshot reference.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIBrowserSnapshot {
  
  /** Target/observed HTTP(S) location; adapter/host authorization must restrict navigation and delivery. */
  url: string
  
  /** Human-readable draft, task, file or event title displayed by the host. */
  title?: string
  
  /** Plain-text message/browser content; treat provider text as untrusted data. */
  text?: string
  
/** Optional host-managed reference to captured image data. */
  screenshotRef?: string
}

/**
 * Host-owned scoped browser session lifecycle and admitted interactions.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIBrowserAdapter extends AIHostAdapter {
  
  /**
   * Request a host browser session restricted to an approved origin.
   * @param input - Initial origin; host validates its origin allowlist and browser authorization.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional session identity/allowed origins and host receipt; caller later closes accepted sessions.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIBrowserAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIBrowserAdapter, context: AIHostActionContext) {
   *  const opened = await adapter.openSession({ origin: "https://example.com" }, context);
   *  if (opened.receipt.status !== "completed" || !opened.value) return opened;
   *  const sessionId = opened.value.sessionId;
   *  try {
   *   return await adapter.snapshot({ sessionId }, context.context);
   *  } finally {
   *   await adapter.closeSession({ sessionId }, { ...context, idempotencyKey: context.idempotencyKey + ":close" });
   *  }
   * }
   * ```
   */
  openSession(input: { 
  
  /** Initial HTTP(S) origin that the host must admit into the browser session allowlist. */
  origin: string }, context: AIHostActionContext): Promise<AIHostResult<AIBrowserSession>>
  
  /**
   * Read current page metadata from an authorized host browser session.
   * @param input - Existing browser session identity.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Current URL and optional title/text/screenshot reference.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIBrowserAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIBrowserAdapter, context: AIExecutionContext) {
   *  return adapter.snapshot({ sessionId: "session-1" }, context);
   * }
   * ```
   */
  snapshot(input: { 
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId: string }, context: AIExecutionContext): Promise<AIBrowserSnapshot>
  
  /**
   * Request an admitted ordered browser action sequence.
   * @param input - Existing session and navigation/interaction/capture actions; wait timeout is milliseconds.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional resulting snapshot and host receipt; partial action completion is provider-defined.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIBrowserAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIBrowserAdapter, context: AIHostActionContext) {
   *  return adapter.execute({ sessionId: "session-1", actions: [{ type: "screenshot", fullPage: false }] }, context);
   * }
   * ```
   */
  execute(input: { 
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId: string; 
  /** Ordered proposed actions; the host must validate and authorize them before any side effect. */
  actions: readonly AIBrowserAction[] }, context: AIHostActionContext): Promise<AIHostResult<AIBrowserSnapshot>>
  
  /**
   * Request cleanup of a host browser session.
   * @param input - Existing session identity to release.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Host receipt plus optional provider cleanup data.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIBrowserAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIBrowserAdapter, context: AIHostActionContext) {
   *  return adapter.closeSession({ sessionId: "session-1" }, context);
   * }
   * ```
   */
  closeSession(input: { 
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId: string }, context: AIHostActionContext): Promise<AIHostResult<unknown>>
}

/**
 * Recipient and optional text/template for a host messaging operation.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AILineMessage {
  
  /** Optional provider message identity returned after delivery. */
  id?: string
  
/** Messaging recipient identity resolved and authorized by the host. */
  recipientId: string
  
  /** Plain-text message/browser content; treat provider text as untrusted data. */
  text?: string
  
/** Optional provider-specific message template; validation belongs to the messaging host. */
  template?: unknown
}

/**
 * Host messaging delivery and inbound-signature verification ports.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIMessagingAdapter extends AIHostAdapter {
  
  /**
   * Request admitted provider message delivery.
   * @param input - Authorized recipient and text/template; host validates provider-specific payload and permissions.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional provider message plus receipt; accepted status does not establish delivery.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIMessagingAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIMessagingAdapter, context: AIHostActionContext) {
   *  return adapter.sendMessage({ recipientId: "recipient-1", text: "Review ready" }, context);
   * }
   * ```
   */
  sendMessage(input: AILineMessage, context: AIHostActionContext): Promise<AIHostResult<AILineMessage>>
  
  /**
   * Validate a provider inbound signature against an exact message body.
   * @param input - Raw body and signature; host owns provider verification/freshness policy.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Validation data with optional decoded event; invalid is returned as valid false.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIMessagingAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIMessagingAdapter, context: AIExecutionContext) {
   *  return adapter.verifyInbound({ body: "{}", signature: "signature-from-provider" }, context);
   * }
   * ```
   */
  verifyInbound(input: { 
  /** Exact inbound body or configured hook body mapping; callback mapping defaults preserve native Kratos behavior. */
  body: string; 
  /** Hexadecimal HMAC or inbound provider signature paired with the exact body; freshness/replay protection remains host-owned. */
  signature: string }, context: AIExecutionContext): Promise<{ 
  /** Whether signature verification succeeded; does not prove timestamp freshness or replay safety. */
  valid: boolean; 
  /** Inbound provider event or webhook event name interpreted by the connected host. */
  event?: unknown }>
}

/**
 * Host workflow identity, lifecycle timestamps and optional output.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIWorkflowExecution {
  
  /** Host/provider execution identity; the legacy sandbox may generate this for a simulated result. */
  executionId: string
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string
  
  /** Host workflow lifecycle independent of action receipt acceptance. */
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  
/** Optional host-reported execution start timestamp. */
  startedAt?: string
  
/** Optional host-reported execution completion timestamp. */
  finishedAt?: string
  
  /** Optional domain output; validate it separately and inspect the accompanying status/receipt. */
  output?: unknown
}

/**
 * Host workflow discovery, admitted execution/cancellation and status reads.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIWorkflowAdapter extends AIHostAdapter {
  
  /**
   * Discover workflows available to the verified execution scope.
   * @param input - Optional tag and count limit; defaults belong to the host adapter.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Workflow IDs/display names and optional versions, possibly empty.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIWorkflowAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIWorkflowAdapter, context: AIExecutionContext) {
   *  return adapter.listWorkflows({ tag: "review", limit: 10 }, context);
   * }
   * ```
   */
  listWorkflows(input: { 
  /** Optional host workflow discovery tag filter. */
  tag?: string; 
  /** Optional result-count bound; default and maximum are owned by the connected adapter. */
  limit?: number }, context: AIExecutionContext): Promise<readonly { 
  /** Host workflow definition identity used for a later execute request. */
  id: string; 
  /** Human-readable display name supplied by the plugin/provider catalog; distinct from the stable ID. */
  name: string; 
  /** Optional host workflow release version advertised for execution selection. */
  version?: string }[]>
  
  /**
   * Request an admitted host workflow execution.
   * @param input - Discovered workflow identity and domain payload validated by the host.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional execution record and receipt; queued/running states are not workflow completion.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIWorkflowAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIWorkflowAdapter, context: AIHostActionContext) {
   *  return adapter.executeWorkflow({ workflowId: "review", payload: { documentId: "document-1" } }, context);
   * }
   * ```
   */
  executeWorkflow(input: { 
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string; 
  /** Typed event/request body; constructors clone and strictly hash JSON where documented. */
  payload: unknown }, context: AIHostActionContext): Promise<AIHostResult<AIWorkflowExecution>>
  
  /**
   * Read one authorized host workflow execution.
   * @param input - Existing execution identity.
   * @param context - Verified host scope used for tenant/user access checks.
   * @returns Execution record when available, otherwise null.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy.
   * @example
   * ```typescript
   * import type { AIWorkflowAdapter } from "@alneas/eaos-core/ai/host-adapters";
   * import type { AIExecutionContext } from "@alneas/eaos-core/ai/governance";
   * async function useHost(adapter: AIWorkflowAdapter, context: AIExecutionContext) {
   *  return adapter.getExecution({ executionId: "execution-1" }, context);
   * }
   * ```
   */
  getExecution(input: { 
  /** Host/provider execution identity; the legacy sandbox may generate this for a simulated result. */
  executionId: string }, context: AIExecutionContext): Promise<AIWorkflowExecution | null>
  
  /**
   * Request cancellation of an authorized host workflow execution.
   * @param input - Execution identity and optional reason.
   * @param context - Verified host scope plus replay key and optional review/deadline/dry-run metadata.
   * @returns Optional execution record and host receipt; cancellation completion is host-defined.
   * @throws Host implementation errors/rejections propagate; successful Promise resolution must still be interpreted through the returned result/receipt.
   * @remarks Requires a real host implementation and trusted execution context; Core supplies no provider credentials, default count limits or cancellation policy. The host enforces approval/deadline/dryRun/idempotency and owns durable receipts; reconcile uncertain outcomes before replaying an effect.
   * @example
   * ```typescript
   * import type { AIWorkflowAdapter, AIHostActionContext } from "@alneas/eaos-core/ai/host-adapters";
   * async function useHost(adapter: AIWorkflowAdapter, context: AIHostActionContext) {
   *  return adapter.cancelExecution({ executionId: "execution-1", reason: "Superseded" }, context);
   * }
   * ```
   */
  cancelExecution(input: { 
  /** Host/provider execution identity; the legacy sandbox may generate this for a simulated result. */
  executionId: string; 
/** Human-readable explanation of the decision or requested action. */
  reason?: string }, context: AIHostActionContext): Promise<AIHostResult<AIWorkflowExecution>>
}

/**
 * Host-owned capabilities made available to a runtime without importing providers into core.
 * @see {@link isAIHostReceiptTerminal}
 */
export interface AIHostAdapters {
  
/** Optional host calendar capability; absence means the host has not configured it. */
  calendar?: AICalendarAdapter
  

  /** Optional host email capability; absence means email operations are unavailable. */
  email?: AIEmailAdapter
  
  
  /** Optional host workspace read/proposal/mutation capability; absence means it is unavailable. */
  workspace?: AIWorkspaceAdapter
  
/** Optional host travel capability; absence means the host has not configured it. */
  travel?: AITravelAdapter
  
/** Optional host browser capability; absence means the host has not configured it. */
  browser?: AIBrowserAdapter
  
/** Optional host messaging capability; absence means the host has not configured it. */
  messaging?: AIMessagingAdapter
  
/** Optional host workflow capability; absence means the host has not configured it. */
  workflow?: AIWorkflowAdapter
  
/** Host retrieval capability or placement binding; indexing remains host-owned. */
  retrieval?: AIRetrievalAdapter
}

/**
 * Check whether a receipt has reached a terminal operation status.
 * @param receipt - Host receipt whose status is inspected; other fields are not validated.
 * @returns True for completed, failed or unavailable; false for accepted or pending.
 * @example
 * ```typescript
 * import { isAIHostReceiptTerminal } from "@alneas/eaos-core/ai/host-adapters";
 * console.log(isAIHostReceiptTerminal({ adapterId: "mail", operation: "draft", receiptId: "r-1", idempotencyKey: "request-1", status: "pending", acceptedAt: "2026-10-19T00:00:00Z" })); // false
 * ```
 */
export function isAIHostReceiptTerminal(receipt: AIHostReceipt): boolean {
  return receipt.status === 'completed' || receipt.status === 'failed' || receipt.status === 'unavailable'
}

/**
 * Check whether a host receipt reports completion.
 * @param receipt - Host receipt whose status is inspected; identity and side-effect evidence are not validated.
 * @returns True only for completed; accepted is not counted as success.
 * @example
 * ```typescript
 * import { isAIHostReceiptSuccessful } from "@alneas/eaos-core/ai/host-adapters";
 * console.log(isAIHostReceiptSuccessful({ adapterId: "mail", operation: "draft", receiptId: "r-1", idempotencyKey: "request-1", status: "accepted", acceptedAt: "2026-10-19T00:00:00Z" })); // false
 * ```
 */
export function isAIHostReceiptSuccessful(receipt: AIHostReceipt): boolean {
  return receipt.status === 'completed'
}
