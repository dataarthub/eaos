import { canonicalJsonHash } from '../serialization/index'
import type { ExecutionSideEffect } from '../agent/approved-execution'
import type { PluginManifest, McpToolDefinition, GatekeeperPolicy } from './types'
import type { ApprovalLevel } from '../security/gatekeeper'
import type { RiskLevel } from './types'

/**
 * Normalized tool schemas and execution policy captured with a deterministic content hash.
 * @see {@link createPluginContractSnapshot}
 */
export interface ToolContractSnapshot {
  
  /** Exact registered tool identity; parsing/discovery does not authorize its execution. */
  name: string
  
  /** Normalized operation contract version; defaults to 1.0.0 when tool metadata omits it. */
  version: string
  
/** JSON Schema describing admitted operation input. */
  inputSchema: Record<string, unknown>
  
/** Optional JSON Schema describing operation output; absent means no output contract is declared here. */
  outputSchema?: Record<string, unknown>
  
/** Host permission identity required for this operation. */
  permission: string
  
/** Classify whether the operation reads, writes local state or affects an external service. */
  sideEffect: ExecutionSideEffect
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel: RiskLevel
  
/** Required organizational review category; a level declaration is not proof of approval. */
  approvalLevel: ApprovalLevel
  
/** Whether execution must wait for an explicit host approval workflow. */
  requireHumanApproval: boolean
  
  /** Content integrity digest; hashes are unkeyed and do not establish authorization or writer authenticity. */
  hash: string
}

/**
 * Plugin version and ordered tool contracts captured for compatibility review.
 * @see {@link createPluginContractSnapshot}
 */
export interface PluginContractSnapshot {
  
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string
  
  /** Version of the plugin represented by the captured contract snapshot. */
  pluginVersion: string
  
  /** Ordered tool definitions used for discovery/compatibility; declaration does not execute them. */
  tools: ToolContractSnapshot[]
  
  /** Content integrity digest; hashes are unkeyed and do not establish authorization or writer authenticity. */
  hash: string
}

/**
 * One removed tool, schema incompatibility or execution-policy change.
 * @see {@link createPluginContractSnapshot}
 */
export interface ContractCompatibilityIssue {
  
/** Registered tool identity used to resolve host execution policy. */
  toolName: string
  
  /** Checked incompatibility category: removal, input/output schema break or policy change. */
  kind: 'removed' | 'input-breaking' | 'output-breaking' | 'policy-change'
  
  /** Human-readable provider/failure explanation; do not include secrets in surfaced diagnostics. */
  message: string
}

/**
 * Compatibility decision and its detailed tool-level issues.
 * @see {@link createPluginContractSnapshot}
 */
export interface ContractCompatibilityReport {
  
  /** Whether the supported compatibility checks found no issues; this is not a full JSON Schema proof. */
  compatible: boolean
  
  /** Detailed validation or compatibility problems, empty when the corresponding check reports success. */
  issues: ContractCompatibilityIssue[]
}

function risk(policy: GatekeeperPolicy | undefined): RiskLevel {
  return policy?.riskLevel ?? 'low'
}

function approvalLevel(policy: GatekeeperPolicy | undefined, level?: ApprovalLevel): ApprovalLevel {
  if (level) return level
  const value = risk(policy)
  return value === 'critical' ? 'L4_EXECUTIVE' : value === 'high' ? 'L3_MANAGER' : value === 'medium' ? 'L2_LEAD' : 'L1_AUTO'
}

function required(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : []
}

function properties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const value = schema.properties
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === 'object' && !Array.isArray(item)) as [string, Record<string, unknown>][])
}

/**
 * Returns only input changes that can break an existing caller. Optional additions are compatible.
 * @param previous - Previously captured object schema.
 * @param current - Replacement object schema.
 * @returns Human-readable issues for removed properties, new required properties, changed explicit types or narrowed enums; empty means no checked break was found.
 * @remarks Checks direct properties/required/type/enum only, not general JSON Schema compatibility. Optional additions are accepted.
 * @example
 * ```typescript
 * import { compareInputSchemaCompatibility } from "@alneas/eaos-core/plugin-sdk/contract-compatibility";
 * console.log(compareInputSchemaCompatibility({ properties: { title: { type: "string" } } }, { properties: { title: { type: "number" } } }));
 * ```
 */
export function compareInputSchemaCompatibility(previous: Record<string, unknown>, current: Record<string, unknown>): string[] {
  const issues: string[] = []
  const oldProperties = properties(previous), nextProperties = properties(current)
  for (const field of required(previous)) if (!Object.hasOwn(nextProperties, field)) issues.push(`required input '${field}' was removed`)
  for (const field of required(current)) if (!required(previous).includes(field)) issues.push(`new required input '${field}' was added`)
  for (const [field, oldSchema] of Object.entries(oldProperties)) {
    const nextSchema = nextProperties[field]
    if (!nextSchema) {
      issues.push(`input property '${field}' was removed`)
      continue
    }
    if (oldSchema.type !== undefined && nextSchema.type !== undefined && oldSchema.type !== nextSchema.type) issues.push(`input property '${field}' changed type`)
    const oldEnum = Array.isArray(oldSchema.enum) ? oldSchema.enum : undefined
    const nextEnum = Array.isArray(nextSchema.enum) ? nextSchema.enum : undefined
    if (oldEnum && nextEnum && oldEnum.some(value => !nextEnum.includes(value))) issues.push(`input property '${field}' narrowed its enum`)
  }
  return issues
}

/**
 * Returns only output changes that can break an existing consumer. Optional additions are compatible.
 * @param previous - Previous output schema; undefined disables comparison.
 * @param current - Replacement output schema; undefined disables comparison.
 * @returns Human-readable issues; empty when either schema is absent or no checked break exists.
 * @remarks Checks removed required properties and explicit type changes only; not a full JSON Schema substitutability check.
 * @example
 * ```typescript
 * import { compareOutputSchemaCompatibility } from "@alneas/eaos-core/plugin-sdk/contract-compatibility";
 * console.log(compareOutputSchemaCompatibility(undefined, { type: "object" })); // []
 * ```
 */
export function compareOutputSchemaCompatibility(previous: Record<string, unknown> | undefined, current: Record<string, unknown> | undefined): string[] {
  if (!previous || !current) return []
  const oldProperties = properties(previous), nextProperties = properties(current), issues: string[] = []
  for (const field of required(previous)) if (!Object.hasOwn(nextProperties, field)) issues.push(`required output '${field}' was removed`)
  for (const [field, oldSchema] of Object.entries(oldProperties)) {
    const nextSchema = nextProperties[field]
    if (!nextSchema) continue
    if (oldSchema.type !== undefined && nextSchema.type !== undefined && oldSchema.type !== nextSchema.type) issues.push(`output property '${field}' changed type`)
  }
  return issues
}

function toolContract(tool: McpToolDefinition, policy: GatekeeperPolicy | undefined): ToolContractSnapshot {
  const contract = tool.contract
  const normalized = {
    name: tool.name,
    version: contract?.version ?? '1.0.0',
    inputSchema: structuredClone(tool.parameters),
    ...(contract?.outputSchema ? { outputSchema: structuredClone(contract.outputSchema) } : {}),
    permission: contract?.permission ?? tool.name,
    sideEffect: contract?.sideEffect ?? 'write' as const,
    riskLevel: risk(policy),
    approvalLevel: approvalLevel(policy),
    requireHumanApproval: policy?.requireHumanApproval ?? risk(policy) !== 'low',
  }
  return { ...normalized, hash: canonicalJsonHash(normalized) }
}

/**
 * Normalize advertised tool schemas/policies into a deterministic plugin snapshot.
 * @param manifest - Plugin discovery manifest; tools default to empty and are sorted by name. Missing tool contracts use version 1.0.0, permission equal to tool name and sideEffect write.
 * @returns A new snapshot with cloned schemas, normalized policy fields and SHA-256 tool/plugin hashes.
 * @throws Cloning or strict canonical JSON hashing errors propagate.
 * @remarks Requires node:crypto. Missing risk defaults to low; approval level derives from risk and human-review default is risk != low. The snapshot does not authorize execution.
 * @example
 * ```typescript
 * import { createPluginContractSnapshot } from "@alneas/eaos-core/plugin-sdk/contract-compatibility";
 * import type { PluginManifest } from "@alneas/eaos-core/plugin-sdk/types";
 * function captureHostManifest(manifest: PluginManifest) { return createPluginContractSnapshot(manifest); }
 * ```
 */
export function createPluginContractSnapshot(manifest: PluginManifest): PluginContractSnapshot {
  const policies = manifest.agentCapabilities?.gatekeeperPolicies ?? {}
  const tools = [...(manifest.mcp?.tools ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map(tool => toolContract(tool, policies[tool.name]))
  const identity = { pluginId: manifest.id, pluginVersion: manifest.version, tools }
  return { ...identity, hash: canonicalJsonHash(identity) }
}

/**
 * Report removed tools, checked schema breaks and policy changes between snapshots.
 * @param previous - Previously admitted snapshot.
 * @param current - Candidate replacement snapshot; tool matching uses exact names.
 * @returns Compatibility plus detailed issues; newly added tools and unexamined schema changes produce no issue.
 * @remarks Does not verify hashes, compare plugin identities or enforce migration. Policy changes invalidate reuse of approvals at the host boundary.
 * @example
 * ```typescript
 * import { comparePluginContractSnapshots } from "@alneas/eaos-core/plugin-sdk/contract-compatibility";
 * const previous = { pluginId: "notes", pluginVersion: "1.0.0", tools: [], hash: "unused-for-comparison" };
 * console.log(comparePluginContractSnapshots(previous, { ...previous, pluginVersion: "1.1.0" }).compatible); // true
 * ```
 */
export function comparePluginContractSnapshots(previous: PluginContractSnapshot, current: PluginContractSnapshot): ContractCompatibilityReport {
  const issues: ContractCompatibilityIssue[] = []
  const newTools = new Map(current.tools.map(tool => [tool.name, tool]))
  for (const oldTool of previous.tools) {
    const nextTool = newTools.get(oldTool.name)
    if (!nextTool) { issues.push({ toolName: oldTool.name, kind: 'removed', message: `Tool '${oldTool.name}' was removed` }); continue }
    for (const message of compareInputSchemaCompatibility(oldTool.inputSchema, nextTool.inputSchema)) issues.push({ toolName: oldTool.name, kind: 'input-breaking', message })
    for (const message of compareOutputSchemaCompatibility(oldTool.outputSchema, nextTool.outputSchema)) issues.push({ toolName: oldTool.name, kind: 'output-breaking', message })
    if (oldTool.permission !== nextTool.permission || oldTool.sideEffect !== nextTool.sideEffect || oldTool.riskLevel !== nextTool.riskLevel || oldTool.approvalLevel !== nextTool.approvalLevel || oldTool.requireHumanApproval !== nextTool.requireHumanApproval) issues.push({ toolName: oldTool.name, kind: 'policy-change', message: `Execution policy for '${oldTool.name}' changed; existing approvals must not be reused` })
  }
  return { compatible: issues.length === 0, issues }
}
