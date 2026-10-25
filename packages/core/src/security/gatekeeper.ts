import { createHash } from 'node:crypto'
import type { GatekeeperPolicy, RiskLevel } from '../plugin-sdk/types'
import type { DatabaseAdapter } from '../db/adapter'
import { resolveGatekeeperPolicy } from './policy'

/**
 * Ordered organizational approval categories from automatic to executive review.
 * @see {@link McpGatekeeper}
 */
export type ApprovalLevel = 'L1_AUTO' | 'L2_LEAD' | 'L3_MANAGER' | 'L4_EXECUTIVE'

/**
 * Tool policy with an explicit approval level and evidence metadata.
 * @see {@link McpGatekeeper}
 */
export interface ExtendedGatekeeperPolicy extends GatekeeperPolicy {
/** Required organizational review category; a level declaration is not proof of approval. */
  approvalLevel?: ApprovalLevel
  
/** Optional evidence requirement metadata; current McpGatekeeper.validateCall does not enforce it. */
  requireEvidence?: boolean
}

/**
 * Hash-linked local audit record for an allowed, blocked or approval-pending tool call.
 * @see {@link McpGatekeeper}
 */
export interface GatekeeperAuditEntry {
  
  /** Generated local audit identity; not a durable approval token. */
  id: string
  
/** Trace correlation identity propagated through host execution and audit paths. */
  traceId?: string
  
/** Registered tool identity used to resolve host execution policy. */
  toolName: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
  /** Observed policy outcome: allowed, blocked or pending review; does not itself grant approval. */
  status: 'ALLOWED' | 'BLOCKED' | 'PENDING_APPROVAL'
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel: RiskLevel
  
/** Required organizational review category; a level declaration is not proof of approval. */
  approvalLevel: ApprovalLevel
  
/** Human-readable explanation of the decision or requested action. */
  reason?: string
  
  /** Source references or audit rationale supporting review; evidence is data and does not grant execution authority. */
  evidence?: {
    
/** Optional statement of the requested action used as audit evidence. */
    intent?: string
    
/** Reported confidence ratio, conventionally from zero to one; validate at the consuming boundary. */
    confidence?: number
    
/** Optional policy-rule identity reported as audit evidence. */
    ruleMatched?: string
    
/** Optional human-readable argument summary; avoid placing secrets in audit evidence. */
    inputSummary?: string
  }
  
  /** Content integrity digest; hashes are unkeyed and do not establish authorization or writer authenticity. */
  hash: string
  
/** Previous audit event hash used to link ordered entries. */
  previousHash?: string
  
  
  /** ISO timestamp generated when the local audit entry is constructed. */
  timestamp: string
  
  /** Operation arguments passed to hooks or bound into a proposed action; authorization and schema checks remain host-owned. */
  args?: Record<string, unknown>
}

/**
 * Host-owned durable audit delivery. Core keeps only a bounded local view.
 * @see {@link McpGatekeeper}
 */
export interface GatekeeperAuditSink {
  
  /**
   * Deliver one gatekeeper entry to host audit persistence.
   * @param entry - Readonly hash-linked audit entry; the gatekeeper supplies a clone.
   * @returns No value; synchronous completion or a resolved Promise indicates host acceptance.
   * @throws Host persistence errors/rejections propagate to durable logging.
   * @remarks Host owns durable storage and replay handling; rejecting does not prove no durable write occurred.
   * @example
   * ```typescript
   * import type { GatekeeperAuditSink } from "@alneas/eaos-core/security/gatekeeper";
   * async function appendGatekeeperAudit(sink: GatekeeperAuditSink, entry: Parameters<GatekeeperAuditSink["append"]>[0]) { await sink.append(entry); }
   * ```
   */
  append(entry: Readonly<GatekeeperAuditEntry>): Promise<void> | void
}

/**
 * Select whether synchronous best-effort audit logging is permitted.
 * @see {@link McpGatekeeper}
 */
export interface GatekeeperOptions {
  /** Reject the legacy synchronous API when durable audit delivery is required. */
  requireDurableAudit?: boolean
}

/**
 * Evaluate local tool policies and record bounded hash-linked audit entries.
 * @remarks Requires node:crypto. Missing policies default to allowed/low/L1_AUTO; this is not a fail-closed authorization system. Validation checks roles, not tenant admission, consent, entitlements or evidence. Local audit view is capped at 500 entries; durable delivery is host-supplied. Avoid mixing legacy and durable logging concurrently when a single ordered chain is required.
 *
 * @example
 * ```typescript
 * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
 * const gatekeeper = new McpGatekeeper();
 * console.log(gatekeeper.validateCall({ toolName: "notes.preview", userRoles: ["member"], tenantId: "tenant-demo" }));
 * ```
 */
export class McpGatekeeper {
  private policies = new Map<string, ExtendedGatekeeperPolicy>()
  private auditLogs: GatekeeperAuditEntry[] = []
  private lastHash: string = '00000000000000000000000000000000'
  private auditDeliveryFailures: { entryId: string; error: string }[] = []
  private durableTail: Promise<void> = Promise.resolve()

  /**
   * Initialize policy state and optional durable audit destinations.
   * @param dbAdapter - Optional host database adapter used for task_audit_logs insertion; the connection must support execute for that insertion path.
   * @param auditSink - Optional durable append sink; when both destinations exist both are awaited by durable logging.
   * @param options - Optional logging policy; requireDurableAudit defaults to false and disables legacy logCall when true.
   *
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * const gatekeeper = new McpGatekeeper();
   * console.log(gatekeeper.getAuditLogs()); // []
   * ```
   */
  constructor(private dbAdapter?: DatabaseAdapter, private auditSink?: GatekeeperAuditSink, private options: GatekeeperOptions = {}) {}

  /**
   * Store or replace a tool policy by reference.
   * @param toolName - Exact tool/skill identity used by validateCall.
   * @param policy - Role, risk and review policy; later external mutation changes future evaluations.
   * @returns No value; the policy has been replaced.
   * @throws Error when the declared AI risk tier is not 1, 2 or 3.
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * const gatekeeper = new McpGatekeeper();
   * gatekeeper.registerPolicy("notes.preview", { riskLevel: "low", requiredRole: "member" });
   * ```
   */
  registerPolicy(toolName: string, policy: ExtendedGatekeeperPolicy): void {
    resolveGatekeeperPolicy(policy)
    this.policies.set(toolName, policy)
  }

  /**
   * Evaluate role admission and derive risk/approval metadata without executing a tool.
   * @param params - Tool name, verified user roles and tenant/trace metadata; current evaluation uses toolName and roles only.
   * @returns Allowed/denied decision plus risk, required review flag and approval level. No policy means low/L1_AUTO allowed; role arrays mean any match and admin/SUPER_ADMIN bypass role restrictions.
   * @remarks No audit is automatically recorded. A caller must honor allowed and requireHumanApproval, and separately enforce tenant, entitlement and evidence policy.
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * const gatekeeper = new McpGatekeeper();
   * console.log(gatekeeper.validateCall({ toolName: "notes.preview", userRoles: ["member"], tenantId: "tenant-demo" }).allowed); // true
   * ```
   */
  validateCall(params: {
    
/** Registered tool identity used to resolve host execution policy. */
    toolName: string
    
    /** Verified host role claims passed to gatekeeper/runtime evaluation. */
    userRoles: string[]
    
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
    tenantId: string
    
/** Trace correlation identity propagated through host execution and audit paths. */
    traceId?: string
  }): {
    
    /** Admission/check decision; consumers must inspect it before using the associated result or performing an effect. */
    allowed: boolean
    
/** Human-readable explanation of the decision or requested action. */
    reason?: string
    
/** Whether execution must wait for an explicit host approval workflow. */
    requireHumanApproval: boolean
    
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
    riskLevel: RiskLevel
    
/** Required organizational review category; a level declaration is not proof of approval. */
    approvalLevel: ApprovalLevel
  } {
    const policy = this.policies.get(params.toolName)
    const { riskLevel, approvalLevel, requireHumanApproval } = resolveGatekeeperPolicy(policy)

    if (!policy || !policy.requiredRole) {
      return { allowed: true, requireHumanApproval, riskLevel, approvalLevel }
    }

    const requiredRoles = Array.isArray(policy.requiredRole)
      ? policy.requiredRole
      : [policy.requiredRole]

    const hasRole = requiredRoles.some((role) =>
      params.userRoles.includes(role) ||
      params.userRoles.includes('admin') ||
      params.userRoles.includes('SUPER_ADMIN')
    )

    if (!hasRole) {
      return {
        allowed: false,
        reason: `Role requirement failed for tool '${params.toolName}'. Required: ${requiredRoles.join(', ')}`,
        requireHumanApproval: false,
        riskLevel,
        approvalLevel,
      }
    }

    return { allowed: true, requireHumanApproval, riskLevel, approvalLevel }
  }

  /**
   * SHA-256 hash calculation for the local audit chain
   */
  private calculateHash(data: string): string {
    return createHash('sha256').update(data).digest('hex')
  }

  /**
   * Append a local audit entry and start best-effort configured persistence.
   * @param entry - Audit scope/outcome; ID, timestamp and hash links are generated, and approval level is derived from risk when omitted.
   * @returns The local audit entry reference, before any asynchronous persistence has completed.
   * @throws Error when requireDurableAudit is enabled, or JSON hashing fails.
   * @remarks Persistence failures are retained in a bounded 100-entry diagnostic list. Completion does not prove durable storage; use logCallDurably when persistence is required.
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * const gatekeeper = new McpGatekeeper();
   * console.log(gatekeeper.logCall({ toolName: "notes.preview", userId: "user-demo", tenantId: "tenant-demo", status: "ALLOWED", riskLevel: "low" }).hash);
   * ```
   */
  logCall(
    entry: Omit<GatekeeperAuditEntry, 'id' | 'timestamp' | 'hash' | 'previousHash' | 'approvalLevel'> & {
      
/** Required organizational review category; a level declaration is not proof of approval. */
      approvalLevel?: ApprovalLevel
    }
  ): GatekeeperAuditEntry {
    if (this.options.requireDurableAudit) throw new Error('Durable audit is required; use logCallDurably')
    const fullEntry = this.createEntry(entry)
    this.appendLocal(fullEntry)
    if (this.dbAdapter || this.auditSink) {
      void this.persist(fullEntry).catch((error: unknown) => {
        this.auditDeliveryFailures.push({ entryId: fullEntry.id, error: error instanceof Error ? error.message : String(error) })
        if (this.auditDeliveryFailures.length > 100) this.auditDeliveryFailures.shift()
      })
    }
    return fullEntry
  }

  /**
   * Serialize audit appends and add the local entry only after configured destinations accept it.
   * @param entry - Audit scope/outcome; generated identity/timestamp/hash and default approval level follow logCall semantics.
   * @returns The appended entry after all configured deliveries resolve.
   * @throws Rejects without a durable destination, on hashing errors, or when a configured database/sink write rejects.
   * @remarks Multiple sinks are not one transaction: one may accept before another rejects. The local chain hash is rolled back on failure, but accepted external writes are not undone; hosts must reconcile partial outcomes before retrying.
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * import type { GatekeeperAuditSink } from "@alneas/eaos-core/security/gatekeeper";
   * async function appendHostAudit(sink: GatekeeperAuditSink) {
   *  const gatekeeper = new McpGatekeeper(undefined, sink, { requireDurableAudit: true });
   *  return gatekeeper.logCallDurably({ toolName: "notes.preview", userId: "user-demo", tenantId: "tenant-demo", status: "ALLOWED", riskLevel: "low" });
   * }
   * ```
   */
  async logCallDurably(
    entry: Omit<GatekeeperAuditEntry, 'id' | 'timestamp' | 'hash' | 'previousHash' | 'approvalLevel'> & {
      
/** Required organizational review category; a level declaration is not proof of approval. */
      approvalLevel?: ApprovalLevel
    }
  ): Promise<GatekeeperAuditEntry> {
    if (!this.dbAdapter && !this.auditSink) throw new Error('Durable audit sink is not configured')
    const operation = this.durableTail.then(async () => {
      const fullEntry = this.createEntry(entry)
      try {
        await this.persist(fullEntry)
      } catch (error) {
        // A rejected durable write must not leave a hash for an entry that was
        // never accepted by the audit log.
        if (this.lastHash === fullEntry.hash) this.lastHash = fullEntry.previousHash ?? '00000000000000000000000000000000'
        throw error
      }
      this.appendLocal(fullEntry)
      return fullEntry
    })
    this.durableTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private createEntry(
    entry: Omit<GatekeeperAuditEntry, 'id' | 'timestamp' | 'hash' | 'previousHash' | 'approvalLevel'> & {
      approvalLevel?: ApprovalLevel
    }
  ): GatekeeperAuditEntry {
    const previousHash = this.lastHash
    const id = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    const timestamp = new Date().toISOString()

    let approvalLevel = entry.approvalLevel
    if (!approvalLevel) {
      if (entry.riskLevel === 'critical') approvalLevel = 'L4_EXECUTIVE'
      else if (entry.riskLevel === 'high') approvalLevel = 'L3_MANAGER'
      else if (entry.riskLevel === 'medium') approvalLevel = 'L2_LEAD'
      else approvalLevel = 'L1_AUTO'
    }

    const payloadToHash = JSON.stringify({ ...entry, id, timestamp, approvalLevel, previousHash })
    const currentHash = this.calculateHash(payloadToHash)
    this.lastHash = currentHash

    const fullEntry: GatekeeperAuditEntry = {
      ...entry,
      id,
      timestamp,
      approvalLevel,
      previousHash,
      hash: currentHash,
    }

    return fullEntry
  }

  private appendLocal(fullEntry: GatekeeperAuditEntry): void {
    this.auditLogs.push(fullEntry)
    if (this.auditLogs.length > 500) {
      this.auditLogs.shift()
    }
  }

  private async persist(fullEntry: GatekeeperAuditEntry): Promise<void> {
    const deliveries: Promise<void>[] = []
    if (this.dbAdapter) {
      deliveries.push(
        this.dbAdapter.withTenantConnection(
          'audit',
          async (conn) => {
            if (typeof conn?.execute === 'function') {
              await conn.execute(
                `INSERT INTO task_audit_logs (id, trace_id, tool_name, user_id, tenant_id, status, risk_level, approval_level, prev_hash, hash, created_at)
                 VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11)`,
                [
                  fullEntry.id,
                  fullEntry.traceId ?? null,
                  fullEntry.toolName,
                  fullEntry.userId,
                  fullEntry.tenantId,
                  fullEntry.status,
                  fullEntry.riskLevel,
                  fullEntry.approvalLevel,
                  fullEntry.previousHash,
                  fullEntry.hash,
                  fullEntry.timestamp,
                ]
              )
            }
          },
          { tenantId: fullEntry.tenantId, userId: fullEntry.userId }
        )
      )
    }
    if (this.auditSink) {
      deliveries.push(Promise.resolve(this.auditSink.append(structuredClone(fullEntry))))
    }
    await Promise.all(deliveries)
  }

  /**
   * Copy the bounded legacy persistence-failure diagnostics.
   * @returns New failure objects in a new array, up to the latest 100 legacy failures.
   * @remarks Local diagnostics are not a substitute for durable host audit storage.
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * const gatekeeper = new McpGatekeeper();
   * console.log(gatekeeper.getAuditDeliveryFailures()); // []
   * ```
   */
  getAuditDeliveryFailures(): readonly { 
/** Identity of the audit entry whose delivery failed. */
  entryId: string; 
/** Optional human-readable failure detail; absence does not independently establish success. */
  error: string }[] {
    return this.auditDeliveryFailures.map(failure => ({ ...failure }))
  }

  /**
   * Read the bounded local audit view, optionally filtering by tenant.
   * @param tenantId - Optional exact tenant key; omission or a falsy value exposes the full local array.
   * @returns A filtered array when tenantId is truthy, otherwise the internal mutable array; entries remain original references.
   * @remarks Local diagnostics are not a substitute for durable host audit storage.
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * const gatekeeper = new McpGatekeeper();
   * console.log(gatekeeper.getAuditLogs("tenant-demo")); // []
   * ```
   */
  getAuditLogs(tenantId?: string): GatekeeperAuditEntry[] {
    if (!tenantId) return this.auditLogs
    return this.auditLogs.filter((log) => log.tenantId === tenantId)
  }

  /**
   * Filter local audit entries by exact trace identity.
   * @param traceId - Trace correlation key.
   * @returns New array containing original matching entry references.
   * @remarks Local diagnostics are not a substitute for durable host audit storage.
   * @example
   * ```typescript
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * const gatekeeper = new McpGatekeeper();
   * console.log(gatekeeper.getTraceLogs("trace-1")); // []
   * ```
   */
  getTraceLogs(traceId: string): GatekeeperAuditEntry[] {
    return this.auditLogs.filter((log) => log.traceId === traceId)
  }
}

/**
 * Module-local gatekeeper singleton shared by imports in the same runtime.
 * @see {@link McpGatekeeper}
 */
export const globalGatekeeper = new McpGatekeeper()
