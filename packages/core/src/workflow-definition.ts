import type { ApprovalLevel } from './security/gatekeeper'
import type { RiskLevel } from './plugin-sdk/types'

/**
 * Semantic categories used by workflow editors and host compilers.
 * @see {@link validateWorkflowDefinition}
 */
export type WorkflowDefinitionNodeKind = 'trigger' | 'task' | 'agent' | 'human_review' | 'approval' | 'effect' | 'subgraph' | 'wait' | 'system' | 'custom'
/**
 * Safe data comparison operators supported by condition evaluation.
 * @see {@link validateWorkflowDefinition}
 */
export type WorkflowConditionOperator = 'equals' | 'not_equals' | 'in' | 'not_in' | 'exists' | 'truthy' | 'falsy' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'

/**
 * Own-property path predicate and optional comparison operand.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowLeafCondition {
  
  /** Dot-separated own-property state path; arrays are not traversed by evaluateWorkflowCondition. */
  path: string
  
/** Safe comparison operation; exists/truthy/falsy forbid an operand, others require value. */
  operator: WorkflowConditionOperator
  
  
  /** Comparison operand; required except for exists/truthy/falsy, which forbid this field. */
  value?: unknown
}

/**
 * Recursive leaf, conjunction, disjunction or negation predicate without executable expressions.
 * @see {@link validateWorkflowDefinition}
 */
export type WorkflowCondition = WorkflowLeafCondition | { 
/** Nonempty conjunction of up to 32 child conditions; all must match. */
  all: readonly WorkflowCondition[] } | { 
/** Nonempty disjunction of up to 32 child conditions; at least one must match. */
  any: readonly WorkflowCondition[] } | { 
/** Single nested condition whose result is inverted. */
  not: WorkflowCondition }

/**
 * Declared operation/risk/review metadata for an approval node.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowApprovalDefinition {
  
/** Registered tool identity used to resolve host execution policy. */
  toolName: string
  
/** Required organizational review category; a level declaration is not proof of approval. */
  approvalLevel: ApprovalLevel
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel: RiskLevel
  
/** Human-readable explanation of the decision or requested action. */
  reason: string
  /** State path containing the operation arguments, for example context.approvalArgs. */
  argsPath?: string
  
/** Host permission identity required for this operation. */
  permission?: string
  
/** Optional version of the operation meaning used by the host approval path. */
  contractVersion?: string
}

/**
 * Host retry settings validated as bounded counts and millisecond delays.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowRetryDefinition {
  
/** Maximum intended attempt count; delay calculators validate it but do not themselves stop retries. */
  maxAttempts: number
  
/** Optional base retry delay in milliseconds, validated from 0 to 300000. */
  backoffMs?: number
  
/** Optional maximum retry delay in milliseconds, validated from 0 to 3600000. */
  maxBackoffMs?: number
  
/** Optional host retry-jitter selection; definition validation does not schedule retries. */
  jitter?: boolean
}

/**
 * Referenced workflow/version with optional state mapping paths.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowSubflowDefinition {
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string
  
  /** Referenced workflow release version, up to 64 nonblank characters. */
  version: string
  
/** Optional dotted input-state path used by a host subflow compiler. */
  inputPath?: string
  
/** Optional output-state key used by a host subflow compiler. */
  outputKey?: string
}

/**
 * Declared agent tool mode and explicit allowed tool names.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowToolScopeDefinition {
  
  /** Selected operation/storage/execution variant; the owning discriminated union determines applicable fields. */
  mode: 'read' | 'preview' | 'action'
  
/** Explicit tool-name allowlist to enforce at the host execution boundary. */
  allowedToolNames: readonly string[]
}

/**
 * Serializable node type, host configuration and optional execution policies.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowDefinitionNode {
  
  /** Unique lowercase graph node identity referenced by entryNode and edges. */
  id: string
  
  /** Host-registered node handler/compiler type; structural validation does not prove the handler exists. */
  type: string
  
  /** Semantic workflow node category; definition omission leaves interpretation to the host. */
  kind?: WorkflowDefinitionNodeKind
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label?: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description?: string
  
/** Owning plugin identity used for capability scope and discovery. */
  pluginId?: string
  
/** Host configuration metadata; plugin/node configuration is data and does not execute code by itself. */
  config?: Record<string, unknown>
  
  /** Optional host review metadata; an approved value must be established by a trusted host, never by model output. */
  approval?: WorkflowApprovalDefinition
  
/** Optional bounded retry metadata interpreted by the host workflow compiler/runtime. */
  retry?: WorkflowRetryDefinition
  
/** Optional execution deadline in milliseconds; enforcement belongs to the API/runtime consuming this metadata. */
  timeoutMs?: number
  
/** Optional referenced workflow version and state mapping; no subflow is run during validation. */
  subflow?: WorkflowSubflowDefinition
  
  /** Requested tool mode and exact allowed names; enforcement is host/runtime-owned. */
  toolScope?: WorkflowToolScopeDefinition
}

/**
 * Directed edge with an optional data-only condition or explicit fallback marker.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowDefinitionEdge {
  
  
  /** Existing source node ID; outgoing fallback/conditional consistency is validated per source. */
  from: string
  
  
  /** Existing destination node ID; unknown endpoints are rejected during definition validation. */
  to: string
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label?: string
  
  /** Data-only routing predicate or host-reviewed instruction; no expression string is executed by Core. */
  condition?: WorkflowCondition
  
/** Optional fallback edge marker; at most one per source node. */
  default?: boolean
}

/**
 * Versioned serializable workflow graph validated before host compilation.
 * @see {@link validateWorkflowDefinition}
 */
export interface WorkflowDefinition {
  
  /** Envelope format discriminator accepted by the corresponding parser/validator. */
  schemaVersion: '1.0'
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string
  
  /** Host workflow version text, up to 64 nonblank characters; runtime validation does not require semver. */
  version: string
  
/** Identity of the graph node where host execution/display begins. */
  entryNode: string
  
  /** Graph vertices in supplied order; this metadata does not execute node handlers. */
  nodes: readonly WorkflowDefinitionNode[]
  
  /** Directed graph relationships in supplied order; validation/rendering behavior follows the owning graph contract. */
  edges: readonly WorkflowDefinitionEdge[]
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Record<string, unknown>
}

/**
 * Publication stages for a host-managed workflow definition.
 * @see {@link validateWorkflowDefinition}
 */
export type WorkflowDefinitionLifecycle = 'draft' | 'validated' | 'approved' | 'published' | 'retired'

const idPattern = '^[a-z0-9][a-z0-9._-]{0,127}$'
const conditionSchema = { $ref: '#/$defs/workflowCondition' } as const

/**
 * JSON Schema consumed by visual editors and host-side validators.
 * @see {@link validateWorkflowDefinition}
 */
export const WORKFLOW_DEFINITION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://eaos.dev/schemas/workflow-definition-1.0.json',
  title: 'EAOS Workflow Definition',
  type: 'object',
  $defs: {
    workflowCondition: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'operator'],
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_.-]+$' },
            operator: { enum: ['equals', 'not_equals', 'in', 'not_in', 'exists', 'truthy', 'falsy', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal'] },
            value: {},
          },
        },
        { type: 'object', additionalProperties: false, required: ['all'], properties: { all: { type: 'array', minItems: 1, maxItems: 32, items: conditionSchema } } },
        { type: 'object', additionalProperties: false, required: ['any'], properties: { any: { type: 'array', minItems: 1, maxItems: 32, items: conditionSchema } } },
        { type: 'object', additionalProperties: false, required: ['not'], properties: { not: conditionSchema } },
      ],
    },
  },
  additionalProperties: false,
  required: ['schemaVersion', 'workflowId', 'version', 'entryNode', 'nodes', 'edges'],
  properties: {
    schemaVersion: { const: '1.0' },
    workflowId: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
    version: { type: 'string', minLength: 1, maxLength: 64 },
    entryNode: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
    nodes: {
      type: 'array', minItems: 1, maxItems: 200, items: {
        type: 'object', additionalProperties: false, required: ['id', 'type'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
          type: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
          kind: { enum: ['trigger', 'task', 'agent', 'human_review', 'approval', 'effect', 'subgraph', 'wait', 'system', 'custom'] },
          label: { type: 'string', minLength: 1, maxLength: 256 },
          description: { type: 'string', maxLength: 2_000 },
          pluginId: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
          config: { type: 'object', additionalProperties: true, maxProperties: 100 },
          approval: {
            type: 'object', additionalProperties: false, required: ['toolName', 'approvalLevel', 'riskLevel', 'reason'],
            properties: {
              toolName: { type: 'string', minLength: 1, maxLength: 256 },
              approvalLevel: { enum: ['L1_AUTO', 'L2_LEAD', 'L3_MANAGER', 'L4_EXECUTIVE'] },
              riskLevel: { enum: ['low', 'medium', 'high', 'critical'] },
              reason: { type: 'string', minLength: 1, maxLength: 2_000 },
              argsPath: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_.-]+$' },
              permission: { type: 'string', minLength: 1, maxLength: 256 },
              contractVersion: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
          retry: {
            type: 'object', additionalProperties: false, required: ['maxAttempts'],
            properties: {
              maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
              backoffMs: { type: 'integer', minimum: 0, maximum: 300_000 },
              maxBackoffMs: { type: 'integer', minimum: 0, maximum: 3_600_000 },
              jitter: { type: 'boolean' },
            },
          },
          timeoutMs: { type: 'integer', minimum: 1, maximum: 3_600_000 },
          subflow: {
            type: 'object', additionalProperties: false, required: ['workflowId', 'version'],
            properties: {
              workflowId: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
              version: { type: 'string', minLength: 1, maxLength: 64 },
              inputPath: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_.-]+$' },
              outputKey: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
            },
          },
          toolScope: {
            type: 'object', additionalProperties: false, required: ['mode', 'allowedToolNames'],
            properties: {
              mode: { enum: ['read', 'preview', 'action'] },
              allowedToolNames: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 256 } },
            },
          },
        },
      },
    },
    edges: {
      type: 'array', maxItems: 500, items: {
        type: 'object', additionalProperties: false, required: ['from', 'to'],
        properties: {
          from: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
          to: { type: 'string', minLength: 1, maxLength: 128, pattern: idPattern },
          label: { type: 'string', maxLength: 256 },
          condition: conditionSchema,
          default: { type: 'boolean' },
        },
      },
    },
    metadata: { type: 'object', additionalProperties: true, maxProperties: 100 },
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid workflow ${name}`)
  return value
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Invalid workflow ${name}`)
}

function finiteJson(value: unknown, name: string): void {
  if (value === undefined) return
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new Error(`Invalid workflow ${name}`)
  }
  if (Array.isArray(value)) {
    value.forEach(item => finiteJson(item, name))
    return
  }
  if (isRecord(value)) {
    Object.values(value).forEach(item => finiteJson(item, name))
    return
  }
  throw new Error(`Invalid workflow ${name}`)
}

function validId(value: unknown, name: string): string {
  const result = text(value, name, 128)
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) throw new Error(`Invalid workflow ${name}`)
  return result
}

function validateCondition(value: unknown, name = 'condition'): asserts value is WorkflowCondition {
  if (!isRecord(value)) throw new Error(`Invalid workflow ${name}`)
  const keys = Object.keys(value)
  if ('path' in value) {
    if (keys.some(key => !['path', 'operator', 'value'].includes(key))) throw new Error(`Invalid workflow ${name}`)
    text(value.path, `${name} path`, 256)
    if (!['equals', 'not_equals', 'in', 'not_in', 'exists', 'truthy', 'falsy', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal'].includes(String(value.operator))) throw new Error(`Invalid workflow ${name} operator`)
    if (['exists', 'truthy', 'falsy'].includes(String(value.operator)) && 'value' in value) throw new Error(`Workflow ${name} does not accept a value for this operator`)
    if (!['exists', 'truthy', 'falsy'].includes(String(value.operator)) && !('value' in value)) throw new Error(`Workflow ${name} requires a value`)
    if ('value' in value) finiteJson(value.value, `${name} value`)
    return
  }
  if ('all' in value || 'any' in value) {
    if (keys.length !== 1) throw new Error(`Invalid workflow ${name}`)
    const items = value.all ?? value.any
    if (!Array.isArray(items) || items.length < 1 || items.length > 32) throw new Error(`Invalid workflow ${name} branches`)
    items.forEach((item, index) => validateCondition(item, `${name}[${index}]`))
    return
  }
  if ('not' in value && keys.length === 1) {
    validateCondition(value.not, `${name}.not`)
    return
  }
  throw new Error(`Invalid workflow ${name}`)
}

/**
 * Validate and clone a definition before it reaches a compiler or registry.
 * @param input - Version 1.0 data-only definition with 1–200 nodes and up to 500 edges; IDs must match the schema, references must resolve and routing fallbacks must be unambiguous.
 * @returns A fresh normalized definition containing cloned configuration, conditions and metadata.
 * @throws Error for malformed fields, duplicate/missing nodes, invalid condition/approval/retry/tool scope or conflicting outgoing edges; clone failures propagate.
 * @remarks This checks the implemented structural constraints, not executability, authorization or handler availability. Cyclic workflows are not rejected; no workflow is started.
 * @example
 * ```typescript
 * import { validateWorkflowDefinition } from "@alneas/eaos-core/workflow-definition";
 * const definition = validateWorkflowDefinition({ schemaVersion: "1.0", workflowId: "demo", version: "1.0.0", entryNode: "start", nodes: [{ id: "start", type: "task" }], edges: [] });
 * console.log(definition.nodes.length); // 1
 * ```
 */
export function validateWorkflowDefinition(input: unknown): WorkflowDefinition {
  if (!isRecord(input) || input.schemaVersion !== '1.0') throw new Error('Invalid workflow schemaVersion')
  keysOnly(input, ['schemaVersion', 'workflowId', 'version', 'entryNode', 'nodes', 'edges', 'metadata'], 'definition fields')
  const workflowId = validId(input.workflowId, 'workflowId')
  const version = text(input.version, 'version', 64)
  const entryNode = validId(input.entryNode, 'entryNode')
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > 200) throw new Error('Invalid workflow nodes')
  if (!Array.isArray(input.edges) || input.edges.length > 500) throw new Error('Invalid workflow edges')

  const nodeIds = new Set<string>()
  const nodes: WorkflowDefinitionNode[] = input.nodes.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Invalid workflow node at index ${index}`)
    keysOnly(raw, ['id', 'type', 'kind', 'label', 'description', 'pluginId', 'config', 'approval', 'retry', 'timeoutMs', 'subflow', 'toolScope'], `node ${index} fields`)
    const id = validId(raw.id, `node ${index} id`)
    if (nodeIds.has(id)) throw new Error(`Duplicate workflow node '${id}'`)
    nodeIds.add(id)
    const type = validId(raw.type, `node ${id} type`)
    const node: WorkflowDefinitionNode = {
      id,
      type,
      ...(raw.kind === undefined ? {} : { kind: raw.kind as WorkflowDefinitionNodeKind }),
      ...(raw.label === undefined ? {} : { label: text(raw.label, `node ${id} label`, 256) }),
      ...(raw.description === undefined ? {} : { description: text(raw.description, `node ${id} description`, 2_000) }),
      ...(raw.pluginId === undefined ? {} : { pluginId: validId(raw.pluginId, `node ${id} pluginId`) }),
      ...(raw.config === undefined ? {} : { config: structuredClone(raw.config) as Record<string, unknown> }),
      ...(raw.approval === undefined ? {} : { approval: structuredClone(raw.approval) as WorkflowApprovalDefinition }),
      ...(raw.retry === undefined ? {} : { retry: structuredClone(raw.retry) as WorkflowRetryDefinition }),
      ...(raw.timeoutMs === undefined ? {} : { timeoutMs: raw.timeoutMs as number }),
      ...(raw.subflow === undefined ? {} : { subflow: structuredClone(raw.subflow) as WorkflowSubflowDefinition }),
      ...(raw.toolScope === undefined ? {} : { toolScope: structuredClone(raw.toolScope) as WorkflowToolScopeDefinition }),
    }
    if (node.kind !== undefined && !['trigger', 'task', 'agent', 'human_review', 'approval', 'effect', 'subgraph', 'wait', 'system', 'custom'].includes(node.kind)) throw new Error(`Invalid workflow node ${id} kind`)
    if (node.kind === 'approval' && !node.approval) throw new Error(`Approval workflow node '${id}' requires approval configuration`)
    if (raw.config !== undefined && !isRecord(raw.config)) throw new Error(`Invalid workflow node ${id} config`)
    if (raw.approval !== undefined && !isRecord(raw.approval)) throw new Error(`Invalid workflow node ${id} approval`)
    if (raw.retry !== undefined && !isRecord(raw.retry)) throw new Error(`Invalid workflow node ${id} retry`)
    if (raw.subflow !== undefined && !isRecord(raw.subflow)) throw new Error(`Invalid workflow node ${id} subflow`)
    if (raw.toolScope !== undefined && !isRecord(raw.toolScope)) throw new Error(`Invalid workflow node ${id} toolScope`)
    if (node.approval) {
      keysOnly(raw.approval as Record<string, unknown>, ['toolName', 'approvalLevel', 'riskLevel', 'reason', 'argsPath', 'permission', 'contractVersion'], `node ${id} approval fields`)
      text(node.approval.toolName, `node ${id} approval toolName`, 256)
      text(node.approval.reason, `node ${id} approval reason`, 2_000)
      if (!['L1_AUTO', 'L2_LEAD', 'L3_MANAGER', 'L4_EXECUTIVE'].includes(node.approval.approvalLevel)) throw new Error(`Invalid workflow node ${id} approvalLevel`)
      if (!['low', 'medium', 'high', 'critical'].includes(node.approval.riskLevel)) throw new Error(`Invalid workflow node ${id} riskLevel`)
      if (node.approval.argsPath !== undefined) text(node.approval.argsPath, `node ${id} approval argsPath`, 256)
    }
    if (node.retry) {
      keysOnly(raw.retry as Record<string, unknown>, ['maxAttempts', 'backoffMs', 'maxBackoffMs', 'jitter'], `node ${id} retry fields`)
      if (!Number.isSafeInteger(node.retry.maxAttempts) || node.retry.maxAttempts < 1 || node.retry.maxAttempts > 10) throw new Error(`Invalid workflow node ${id} retry maxAttempts`)
      for (const [key, max] of [['backoffMs', 300_000] as const, ['maxBackoffMs', 3_600_000] as const]) {
        const value = node.retry[key as 'backoffMs' | 'maxBackoffMs']
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > max)) throw new Error(`Invalid workflow node ${id} retry ${key}`)
      }
      if (node.retry.jitter !== undefined && typeof node.retry.jitter !== 'boolean') throw new Error(`Invalid workflow node ${id} retry jitter`)
    }
    if (node.timeoutMs !== undefined && (!Number.isSafeInteger(node.timeoutMs) || node.timeoutMs < 1 || node.timeoutMs > 3_600_000)) throw new Error(`Invalid workflow node ${id} timeoutMs`)
    if (node.subflow) {
      keysOnly(raw.subflow as Record<string, unknown>, ['workflowId', 'version', 'inputPath', 'outputKey'], `node ${id} subflow fields`)
      validId(node.subflow.workflowId, `node ${id} subflow workflowId`)
      text(node.subflow.version, `node ${id} subflow version`, 64)
    }
    if (node.toolScope) {
      if (!['read', 'preview', 'action'].includes(node.toolScope.mode) || !Array.isArray(node.toolScope.allowedToolNames) || node.toolScope.allowedToolNames.length > 100 || node.toolScope.allowedToolNames.some(tool => typeof tool !== 'string' || !tool.trim() || tool.length > 256)) throw new Error(`Invalid workflow node ${id} toolScope`)
    }
    finiteJson(node.config, `node ${id} config`)
    return node
  })
  if (!nodeIds.has(entryNode)) throw new Error(`Workflow entry node '${entryNode}' is not registered`)

  const edges: WorkflowDefinitionEdge[] = input.edges.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Invalid workflow edge at index ${index}`)
    keysOnly(raw, ['from', 'to', 'label', 'condition', 'default'], `edge ${index} fields`)
    const from = validId(raw.from, `edge ${index} from`)
    const to = validId(raw.to, `edge ${index} to`)
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error(`Workflow edge '${from}' -> '${to}' references an unknown node`)
    if (raw.condition !== undefined) validateCondition(raw.condition, `edge ${index} condition`)
    if (raw.default !== undefined && typeof raw.default !== 'boolean') throw new Error(`Invalid workflow edge ${index} default`)
    return {
      from,
      to,
      ...(raw.label === undefined ? {} : { label: text(raw.label, `edge ${index} label`, 256) }),
      ...(raw.condition === undefined ? {} : { condition: structuredClone(raw.condition) as WorkflowCondition }),
      ...(raw.default === undefined ? {} : { default: raw.default as boolean }),
    }
  })
  for (const node of nodes) {
    const outgoing = edges.filter(edge => edge.from === node.id)
    const defaults = outgoing.filter(edge => edge.default === true)
    if (defaults.length > 1) throw new Error(`Workflow node '${node.id}' has multiple default edges`)
    if (outgoing.filter(edge => edge.condition === undefined).length > 1) throw new Error(`Workflow node '${node.id}' has multiple unconditional edges`)
    if (outgoing.some(edge => edge.condition !== undefined) && outgoing.some(edge => edge.condition === undefined && edge.default !== true)) throw new Error(`Workflow node '${node.id}' must mark its fallback edge as default`)
    if (node.approval && outgoing.some(edge => edge.condition !== undefined)) throw new Error(`Approval workflow node '${node.id}' cannot use conditional outgoing edges`)
  }
  if (input.metadata !== undefined && !isRecord(input.metadata)) throw new Error('Invalid workflow metadata')
  const metadata = input.metadata === undefined ? undefined : structuredClone(input.metadata) as Record<string, unknown>
  finiteJson(metadata, 'metadata')
  return structuredClone({ schemaVersion: '1.0' as const, workflowId, version, entryNode, nodes, edges, ...(metadata === undefined ? {} : { metadata }) })
}

function valueAtPath(input: unknown, path: string): { exists: boolean; value: unknown } {
  let current: unknown = input
  for (const part of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) return { exists: false, value: undefined }
    current = current[part]
  }
  return { exists: true, value: current }
}

/**
 * Evaluate the safe, data-only condition language used by compiled workflows.
 * @param condition - Validated condition; all/any/not recurse, dotted paths use own properties and equality uses Object.is.
 * @param input - State to inspect; arrays and nonobjects cannot be traversed as path containers.
 * @returns Whether the condition matches. Missing paths fail positive comparisons but satisfy not_equals/not_in and falsy.
 * @remarks Does not validate the condition first or execute expression strings. Validate untrusted definitions with validateWorkflowDefinition.
 * @example
 * ```typescript
 * import { evaluateWorkflowCondition } from "@alneas/eaos-core/workflow-definition";
 * console.log(evaluateWorkflowCondition({ path: "amount", operator: "greater_than", value: 10 }, { amount: 12 })); // true
 * ```
 */
export function evaluateWorkflowCondition(condition: WorkflowCondition, input: unknown): boolean {
  if ('all' in condition) return condition.all.every(item => evaluateWorkflowCondition(item, input))
  if ('any' in condition) return condition.any.some(item => evaluateWorkflowCondition(item, input))
  if ('not' in condition) return !evaluateWorkflowCondition(condition.not, input)
  const actual = valueAtPath(input, condition.path)
  switch (condition.operator) {
    case 'exists': return actual.exists
    case 'truthy': return Boolean(actual.value)
    case 'falsy': return !actual.value
    case 'equals': return actual.exists && Object.is(actual.value, condition.value)
    case 'not_equals': return !actual.exists || !Object.is(actual.value, condition.value)
    case 'in': return actual.exists && Array.isArray(condition.value) && condition.value.some(item => Object.is(item, actual.value))
    case 'not_in': return !actual.exists || !Array.isArray(condition.value) || !condition.value.some(item => Object.is(item, actual.value))
    case 'greater_than': return actual.exists && typeof actual.value === 'number' && typeof condition.value === 'number' && actual.value > condition.value
    case 'greater_or_equal': return actual.exists && typeof actual.value === 'number' && typeof condition.value === 'number' && actual.value >= condition.value
    case 'less_than': return actual.exists && typeof actual.value === 'number' && typeof condition.value === 'number' && actual.value < condition.value
    case 'less_or_equal': return actual.exists && typeof actual.value === 'number' && typeof condition.value === 'number' && actual.value <= condition.value
  }
}
