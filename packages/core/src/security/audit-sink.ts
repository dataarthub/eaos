/**
 * Host-owned durable append port; successful completion must mean the event was accepted according to host persistence policy.
 * @see {@link DurableAuditTrail}
 * @typeParam T - Event shape accepted by the host append implementation; caller controls its persistence schema.
 */
export interface AuditSink<T> { 
  /**
   * Append an audit event to host durable storage.
   * @param event - Readonly event delivered by the caller; protect sensitive metadata and enforce tenant scope.
   * @returns No value; completion must mean accepted according to the host durability policy.
   * @throws Host persistence failures reject the Promise.
   * @remarks Host defines transactions, ordering, replay/idempotency and partial-write reconciliation; a rejection can follow a committed effect.
   * @example
   * ```typescript
   * import type { AuditSink } from "@alneas/eaos-core/security/audit-sink";
   * async function appendHostAudit(sink: AuditSink<{ action: string }>, event: { action: string }) { await sink.append(event); }
   * ```
   */
  append(event: Readonly<T>): Promise<void> }
