import type { WorkflowCondition, WorkflowDefinition, WorkflowDefinitionEdge, WorkflowDefinitionNode, WorkflowGraphNodeInput } from '@alneas/eaos-core'
import { evaluateWorkflowCondition, validateWorkflowDefinition } from '@alneas/eaos-core'
import type { BaseCheckpointSaver, RetryPolicy } from '@langchain/langgraph'
import { AgentGraphEngine, type AgentGraphEngineOptions, type AgentGraphState, type GraphNodeHandler } from './graph'
import { WorkflowNodeCatalog } from './workflow-catalog'

/**
 * Trusted node catalog, checkpoint persistence, and live approval authority for {@link compileWorkflowDefinition}.
 */
export interface WorkflowCompilerOptions {
  /** Required host/plugin node resolver catalog. */
  catalog: WorkflowNodeCatalog
  /** Optional LangGraph saver; absent uses the graph engine default, which is not durable host storage. */
  checkpointer?: BaseCheckpointSaver
  /** Optional live host approval authorization forwarded to the graph engine. */
  authorizeResume?: AgentGraphEngineOptions['authorizeResume']
}

/**
 * Validated definition and configured graph produced by {@link compileWorkflowDefinition}.
 */
export interface CompiledWorkflow {
  /** Validated serializable workflow definition returned by core validation. */
  definition: WorkflowDefinition
  /** Newly assembled graph; compilation performs no workflow execution. */
  graph: AgentGraphEngine
}

/**
 * Validates a serializable workflow and resolves its catalog nodes into a LangGraph-backed runtime.
 * @param input - Unknown serialized definition accepted by core validateWorkflowDefinition.
 * @param options - Required catalog, optional saver, and live resume authorizer.
 * @returns Validated definition and newly configured graph with node retries, conditional routes, approval metadata, and subgraph mappings.
 * @throws Rejects definition validation, missing catalog/types/subgraph resolvers, invalid resolved handlers/graphs, or propagated resolver/graph construction errors.
 * @remarks Host resolvers may have setup side effects before a later node fails; no rollback/disposal protocol is provided. Node timeouts race the handler but do not cancel underlying work. Tool scopes are passed in workflow context; handlers must enforce them. Runtime conditional routing picks the first matching condition or first default/unconditional edge and throws if none match. Durable persistence, live authorization, and safe side-effect retry contracts remain host-owned.
 * @example
 * ```typescript
 * import { compileWorkflowDefinition, type WorkflowCompilerOptions } from "@alneas/eaos-server/agentic/workflow-compiler";
 * export async function compile(input: unknown, options: WorkflowCompilerOptions) {
 *   return compileWorkflowDefinition(input, options);
 * }
 * ```
 */
export async function compileWorkflowDefinition(input: unknown, options: WorkflowCompilerOptions): Promise<CompiledWorkflow> {
  const definition = validateWorkflowDefinition(input)
  if (!options?.catalog) throw new Error('Workflow node catalog is required')
  const graph = new AgentGraphEngine({
    checkpointer: options.checkpointer,
    authorizeResume: options.authorizeResume,
    workflowId: definition.workflowId,
    workflowVersion: definition.version,
  })

  for (const node of definition.nodes) {
    const registration = options.catalog.require(node.type)
    const visual = visualNode(node, registration.descriptor)
    if (node.subflow) {
      if (!registration.resolveSubgraph) throw new Error(`Workflow node '${node.id}' declares a subflow but '${node.type}' has no subgraph resolver`)
      const subgraph = await registration.resolveSubgraph({ definition, node })
      if (!subgraph || typeof subgraph.invoke !== 'function') throw new Error(`Workflow subflow '${node.id}' did not resolve to a compiled graph`)
      graph.addSubgraph(node.id, subgraph, {
        visual,
        mapInput: state => node.subflow?.inputPath ? valueAtPath(state, node.subflow.inputPath).value : state,
        mapOutput: (output, state) => ({ context: { ...(state.context ?? {}), [node.subflow?.outputKey ?? `${node.id}.output`]: structuredClone(output) } }),
      })
      continue
    }
    const handler = await registration.resolve({ definition, node })
    if (typeof handler !== 'function') throw new Error(`Workflow node '${node.id}' did not resolve to a handler`)
    graph.addNode(node.id, wrapNode(node, handler), { retryPolicy: retryPolicy(node), visual })
  }

  graph.setEntryPoint(definition.entryNode)
  for (const node of definition.nodes) {
    const outgoing = definition.edges.filter(edge => edge.from === node.id)
    if (!outgoing.length) continue
    for (const edge of outgoing) graph.addEdge(edge.from, edge.to, { visual: edgeVisual(edge) })
    if (outgoing.some(edge => edge.condition !== undefined)) {
      const destinations = [...new Set(outgoing.map(edge => edge.to))]
      graph.addConditionalEdges(node.id, state => routeDefinitionEdges(outgoing, state), destinations, {
        labels: Object.fromEntries(outgoing.map(edge => [edge.to, edge.label ?? (edge.condition ? '条件分岐' : '既定')])),
        visual: { kind: 'conditional' },
      })
    }
  }
  return { definition, graph }
}

function wrapNode(node: WorkflowDefinitionNode, handler: GraphNodeHandler): GraphNodeHandler {
  return async state => {
    const handlerState = node.toolScope
      ? { ...structuredClone(state), context: { ...(state.context ?? {}), __eaosWorkflowToolScope: structuredClone(node.toolScope) } }
      : structuredClone(state)
    const update = await withTimeout(handler(handlerState), node.timeoutMs, node.id)
    if (!node.approval) return update
    const existing = update.pendingApproval
    const args = existing?.args ?? (node.approval.argsPath ? valueAtPath({ ...state, ...update }, node.approval.argsPath).value : {})
    if (!isRecord(args)) throw new Error(`Workflow approval node '${node.id}' args must be an object`)
    return {
      ...update,
      pendingApproval: {
        ...(existing ?? {}),
        toolName: existing?.toolName ?? node.approval.toolName,
        approvalLevel: existing?.approvalLevel ?? node.approval.approvalLevel,
        riskLevel: existing?.riskLevel ?? node.approval.riskLevel,
        reason: existing?.reason ?? node.approval.reason,
        args: structuredClone(args),
        ...(node.approval.permission === undefined ? {} : { permission: existing?.permission ?? node.approval.permission }),
        ...(node.approval.contractVersion === undefined ? {} : { contractVersion: existing?.contractVersion ?? node.approval.contractVersion }),
      },
    }
  }
}

function retryPolicy(node: WorkflowDefinitionNode): RetryPolicy | undefined {
  if (!node.retry) return undefined
  return { maxAttempts: node.retry.maxAttempts, initialInterval: node.retry.backoffMs, maxInterval: node.retry.maxBackoffMs, jitter: node.retry.jitter }
}

function visualNode(node: WorkflowDefinitionNode, descriptor: { label: string; description?: string; pluginId?: string; kind: WorkflowDefinitionNode['kind']; canRequestApproval?: boolean }): WorkflowGraphNodeInput {
  return {
    kind: node.kind ?? descriptor.kind ?? 'task',
    label: node.label ?? descriptor.label,
    ...(node.description ?? descriptor.description ? { description: node.description ?? descriptor.description } : {}),
    ...(node.pluginId ?? descriptor.pluginId ? { pluginId: node.pluginId ?? descriptor.pluginId } : {}),
    ...(node.approval ? { approvalLevel: node.approval.approvalLevel, riskLevel: node.approval.riskLevel, toolName: node.approval.toolName, canRequestApproval: true } : { canRequestApproval: descriptor.canRequestApproval ?? true }),
    ...(node.retry ? { retryable: node.retry.maxAttempts > 1 } : {}),
    ...(node.subflow ? { subgraphId: node.subflow.workflowId, subgraphVersion: node.subflow.version } : {}),
  }
}

function edgeVisual(edge: WorkflowDefinitionEdge) {
  return {
    kind: edge.condition ? 'conditional' as const : edge.default ? 'system' as const : 'normal' as const,
    ...(edge.label === undefined ? {} : { label: edge.label }),
    ...(edge.condition === undefined ? {} : { condition: conditionLabel(edge.condition) }),
  }
}

function conditionLabel(condition: WorkflowCondition): string {
  if ('all' in condition) return condition.all.map(conditionLabel).join(' AND ')
  if ('any' in condition) return condition.any.map(conditionLabel).join(' OR ')
  if ('not' in condition) return `NOT (${conditionLabel(condition.not)})`
  return `${condition.path} ${condition.operator}${'value' in condition ? ` ${JSON.stringify(condition.value)}` : ''}`
}

function routeDefinitionEdges(edges: readonly WorkflowDefinitionEdge[], state: AgentGraphState): string {
  const fallback = edges.find(edge => edge.default === true || edge.condition === undefined)
  const match = edges.find(edge => edge.condition !== undefined && evaluateWorkflowCondition(edge.condition, state))
  return (match ?? fallback)?.to ?? (() => { throw new Error(`No workflow edge condition matched from '${state.currentStep}'`) })()
}

function valueAtPath(input: unknown, path: string): { exists: boolean; value: unknown } {
  let current: unknown = input
  for (const part of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) return { exists: false, value: undefined }
    current = current[part]
  }
  return { exists: true, value: current }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, nodeId: string): Promise<T> {
  if (timeoutMs === undefined) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Workflow node '${nodeId}' timed out after ${timeoutMs}ms`)), timeoutMs) })
  try { return await Promise.race([promise, timeout]) } finally { if (timer !== undefined) clearTimeout(timer) }
}
