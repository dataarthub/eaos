import type { ApprovalLevel } from './security/gatekeeper'
import type { RiskLevel } from './plugin-sdk/types'

/**
 * Display categories for non-executable workflow graph nodes.
 * @see {@link renderWorkflowMermaid}
 */
export type WorkflowGraphNodeKind = 'trigger' | 'task' | 'agent' | 'human_review' | 'approval' | 'effect' | 'subgraph' | 'wait' | 'system' | 'custom'
/**
 * Display categories for workflow graph connections.
 * @see {@link renderWorkflowMermaid}
 */
export type WorkflowGraphEdgeKind = 'normal' | 'conditional' | 'approval' | 'system'

/**
 * Serializable, non-executable metadata for displaying an EAOS workflow.
 * @see {@link renderWorkflowMermaid}
 */
export interface WorkflowGraphNodeInput {
  
  /** Semantic workflow node category; definition omission leaves interpretation to the host. */
  kind?: WorkflowGraphNodeKind
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label?: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description?: string
  
/** Owning plugin identity used for capability scope and discovery. */
  pluginId?: string
  
/** Required organizational review category; a level declaration is not proof of approval. */
  approvalLevel?: ApprovalLevel
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel?: RiskLevel
  
/** Registered tool identity used to resolve host execution policy. */
  toolName?: string
  
/** Whether the display metadata advertises a possible approval request; not an approval grant. */
  canRequestApproval?: boolean
  
/** Whether the recorded failure permits a host retry; callers must still account for possible completed effects. */
  retryable?: boolean
  
/** Optional nested workflow identity displayed by the graph viewer. */
  subgraphId?: string
  
/** Optional nested workflow version displayed by the graph viewer. */
  subgraphVersion?: string
}

/**
 * Display node with resolved identity, kind, label and approval-request flag.
 * @see {@link renderWorkflowMermaid}
 */
export interface WorkflowGraphNode extends WorkflowGraphNodeInput {
  
  /** Display node identity used to map edges and runtime highlighting. */
  id: string
  
  /** Semantic workflow node category; definition omission leaves interpretation to the host. */
  kind: WorkflowGraphNodeKind
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label: string
  
/** Whether the display metadata advertises a possible approval request; not an approval grant. */
  canRequestApproval: boolean
}

/**
 * Optional display category, label and condition description for an edge.
 * @see {@link renderWorkflowMermaid}
 */
export interface WorkflowGraphEdgeInput {
  
  /** Display connection category; it has no executable routing effect by itself. */
  kind?: WorkflowGraphEdgeKind
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label?: string
  
  /** Data-only routing predicate or host-reviewed instruction; no expression string is executed by Core. */
  condition?: string
}

/**
 * Display connection with endpoint IDs and a resolved category.
 * @see {@link renderWorkflowMermaid}
 */
export interface WorkflowGraphEdge extends WorkflowGraphEdgeInput {
  
  
  /** Display source node ID; renderers omit edges with unknown endpoints. */
  from: string
  
  
  /** Display destination node ID; renderers omit edges with unknown endpoints. */
  to: string
  
  /** Display connection category; it has no executable routing effect by itself. */
  kind: WorkflowGraphEdgeKind
}

/**
 * Versioned graph metadata with entry node and ordered nodes/edges.
 * @see {@link renderWorkflowMermaid}
 */
export interface WorkflowGraphDescription {
  
  /** Envelope format discriminator accepted by the corresponding parser/validator. */
  schemaVersion: '1.0'
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId?: string
  
/** Version of the workflow definition pinned to this runtime/display record. */
  workflowVersion?: string
  
/** Identity of the graph node where host execution/display begins. */
  entryNode: string
  
  /** Graph vertices in supplied order; this metadata does not execute node handlers. */
  nodes: readonly WorkflowGraphNode[]
  
  /** Directed graph relationships in supplied order; validation/rendering behavior follows the owning graph contract. */
  edges: readonly WorkflowGraphEdge[]
}

/**
 * Display statuses for runtime progress snapshots.
 * @see {@link renderWorkflowMermaid}
 */
export type WorkflowGraphRuntimeStatus = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed'

/**
 * Current display state with optional node, pending approval or failure.
 * @see {@link renderWorkflowMermaid}
 */
export interface WorkflowGraphRuntimeSnapshot {
  
  /** Display-only runtime lifecycle used by viewers. */
  status: WorkflowGraphRuntimeStatus
  
/** Optional node identity highlighted as the current runtime location. */
  currentNodeId?: string
  
/** Optional host checkpoint revision used for optimistic runtime progress. */
  checkpointRevision?: number
  
/** Optional display-only review request awaiting host decision. */
  pendingApproval?: {
    
    /** Host identity for the review request/decision associated with this operation. */
    approvalId?: string
    
/** Registered tool identity used to resolve host execution policy. */
    toolName: string
    
/** Required organizational review category; a level declaration is not proof of approval. */
    approvalLevel: ApprovalLevel
    
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
    riskLevel: string
    
/** Human-readable explanation of the decision or requested action. */
    reason: string
  }
  
/** Optional human-readable failure detail; absence does not independently establish success. */
  error?: string
}

/**
 * Graph description and optional runtime overlay rendered as a diagram.
 * @see {@link renderWorkflowMermaid}
 */
export interface WorkflowGraphVisualization {
  
/** Serializable non-executable workflow graph description. */
  graph: WorkflowGraphDescription
  
/** Optional display overlay of current progress or pending approval. */
  runtime?: WorkflowGraphRuntimeSnapshot
}

function escapeMermaid(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br/>')
}

function escapeDot(value: string): string {
  return JSON.stringify(value.replaceAll('\n', '\\n'))
}

/**
 * Render a safe Mermaid flowchart without executing any workflow metadata.
 * @param visualization - Graph nodes/edges with optional runtime current-node marker; edges with unknown endpoints are omitted.
 * @returns The diagram source as text; labels are escaped for the target format.
 * @remarks No renderer is invoked and no workflow executes; the caller chooses where to render/export the returned text.
 * @example
 * ```typescript
 * import { renderWorkflowMermaid } from "@alneas/eaos-core/workflow-visualization";
 * const visualization = { graph: { schemaVersion: "1.0", entryNode: "start", nodes: [{ id: "start", kind: "task", label: "Start", canRequestApproval: false }], edges: [] } } as const;
 * console.log(renderWorkflowMermaid(visualization));
 * ```
 */
export function renderWorkflowMermaid(visualization: WorkflowGraphVisualization): string {
  const ids = new Map(visualization.graph.nodes.map((node, index) => [node.id, `n${index}`]))
  const lines = ['flowchart TD']
  for (const node of visualization.graph.nodes) {
    const id = ids.get(node.id)
    if (!id) continue
    const marker = visualization.runtime?.currentNodeId === node.id ? ' ◀ 現在位置' : ''
    lines.push(`  ${id}["${escapeMermaid(`${node.label} (${node.kind})${marker}`)}"]`)
  }
  for (const edge of visualization.graph.edges) {
    const from = ids.get(edge.from), to = ids.get(edge.to)
    if (!from || !to) continue
    const label = edge.label ?? edge.condition
    lines.push(label ? `  ${from} -->|${escapeMermaid(label)}| ${to}` : `  ${from} --> ${to}`)
  }
  if (visualization.runtime?.currentNodeId && ids.has(visualization.runtime.currentNodeId)) {
    lines.push('  classDef current fill:#fff3cd,stroke:#d39e00,stroke-width:3px')
    lines.push(`  class ${ids.get(visualization.runtime.currentNodeId)} current`)
  }
  return lines.join('\n')
}

/**
 * Render a safe Graphviz DOT document for exports and server-side diagrams.
 * @param visualization - Graph nodes/edges with optional runtime current-node marker; edges with unknown endpoints are omitted.
 * @returns The diagram source as text; labels are escaped for the target format.
 * @remarks No renderer is invoked and no workflow executes; the caller chooses where to render/export the returned text.
 * @example
 * ```typescript
 * import { renderWorkflowDot } from "@alneas/eaos-core/workflow-visualization";
 * const visualization = { graph: { schemaVersion: "1.0", entryNode: "start", nodes: [{ id: "start", kind: "task", label: "Start", canRequestApproval: false }], edges: [] } } as const;
 * console.log(renderWorkflowDot(visualization));
 * ```
 */
export function renderWorkflowDot(visualization: WorkflowGraphVisualization): string {
  const ids = new Map(visualization.graph.nodes.map((node, index) => [node.id, `n${index}`]))
  const lines = ['digraph workflow {', '  rankdir=LR;']
  for (const node of visualization.graph.nodes) {
    const id = ids.get(node.id)
    if (!id) continue
    const marker = visualization.runtime?.currentNodeId === node.id ? ' [current]' : ''
    lines.push(`  ${id} [label=${escapeDot(`${node.label} (${node.kind})${marker}`)}];`)
  }
  for (const edge of visualization.graph.edges) {
    const from = ids.get(edge.from), to = ids.get(edge.to)
    if (!from || !to) continue
    const label = edge.label ?? edge.condition
    lines.push(`  ${from} -> ${to}${label ? ` [label=${escapeDot(label)}]` : ''};`)
  }
  lines.push('}')
  return lines.join('\n')
}
