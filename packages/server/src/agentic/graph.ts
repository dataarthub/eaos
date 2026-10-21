import { Command, END, interrupt, MemorySaver, START, StateGraph, Annotation, type BaseCheckpointSaver, type RetryPolicy } from '@langchain/langgraph'
import { createApprovalBinding, validateApprovalBinding, type ApprovalBinding, type ApprovalLevel, type RiskLevel, type WorkflowGraphDescription, type WorkflowGraphEdgeInput, type WorkflowGraphNodeInput, type WorkflowGraphRuntimeSnapshot, type WorkflowGraphVisualization } from '@alneas/eaos-core'
import { randomUUID } from 'node:crypto'

/**
 * Serializable workflow identity, history, context, and approval state persisted by the graph checkpointer.
 * @see AgentGraphEngine.runStep for a complete usage example.
 */
export interface AgentGraphState {
  /** Host-authorized checkpoint thread ID. */
  sessionId: string
  /** Verified tenant that owns this workflow. */
  tenantId: string
  /** Verified requesting user, bound into generated approvals. */
  userId: string
  /** Current node identifier used for display and approval continuation. */
  currentStep: string
  /** Ordered conversation/history entries; returned history replaces rather than appends automatically. */
  history: Array<{
    /** Speaker/category label supplied by the host or runtime. */
    role: string
    /** Human-readable history text. */
    content: string
    /** ISO timestamp for runtime-generated entries; host entries are not validated here. */
    timestamp: string
  }>
  /** Optional domain state merged by key; reserved __eaos keys belong to runtime internals. */
  context?: Record<string, unknown>
  /** Optional supporting source metadata carried through state. */
  citations?: Array<{
    /** Display title supplied by the citing node. */
    title: string
    /** Source identifier or URL supplied by the node. */
    source: string
    /** Host/model relevance score; this engine imposes no numeric range. */
    score: number
  }>
  /** Optional pending human decision, bound to tenant/user/operation before checkpointing. */
  pendingApproval?: {
    /** Optional ticket ID; generated when absent during binding. */
    approvalId?: string
    /** Operation name bound to the approval and requested permission by default. */
    toolName: string
    /** Required human-approval level for the operation. */
    approvalLevel: ApprovalLevel
    /** Risk label; generated binding normalizes unknown labels to high. */
    riskLevel: string
    /** Human-readable approval justification, visible in runtime overlays. */
    reason: string
    /** Operation input used to construct the approval binding. */
    args: Record<string, unknown>
    /** Optional prebuilt binding validated against workflow tenant/user/operation. */
    binding?: ApprovalBinding
    /** Optional resource identity and revision included in generated binding. */
    target?: {
      /** Resource category included in the approval binding. */
      type: string
      /** Resource identifier included in the approval binding. */
      id: string
      /** Optional expected resource revision for host approval/admission. */
      revision?: number
    }
    /** Optional generated binding contract version; defaults to 1.0.0. */
    contractVersion?: string
    /** Optional generated binding permission; defaults to toolName. */
    permission?: string
  }
  /** Optional host checkpoint revision metadata; this engine does not increment it itself. */
  checkpointRevision?: number
  /** Optional last decision plus approval ID, binding hash, and ISO decision timestamp. */
  lastApproval?: GraphApprovalDecision & { 
  /**
   * Identity of the pending review ticket consumed by this completed approval decision.
   */
  approvalId: string; 
  /**
   * Exact approved request/contract binding hash copied from the consumed pending approval.
   */
  bindingHash: string; 
  /**
   * ISO timestamp generated when the graph processes the resumed review decision.
   */
  decidedAt: string }
  /** True when execution has completed or a decision rejected the workflow. */
  isComplete: boolean
  /** Optional domain/runtime failure description included in runtime display overlays. */
  error?: string
}

/**
 * Async node operation receiving an isolated graph-state clone and returning partial state updates.
 * @param state - Current graph state; mutating it alone does not persist changes unless returned.
 * @returns Partial update; context is merged, while supplied history replaces the existing history.
 * @throws Handler failures propagate through LangGraph retry policy and graph execution.
 * @see AgentGraphEngine.addNode for a complete example.
 */
export type GraphNodeHandler = (state: AgentGraphState) => Promise<Partial<AgentGraphState>>
/**
 * Synchronous conditional route selector over a cloned graph state.
 * @param state - Current state after the source node has run.
 * @returns One exact declared destination name; undeclared destinations fail execution.
 * @see AgentGraphEngine.addConditionalEdges for a complete example.
 */
export type GraphRouter = (state: AgentGraphState) => string

/** Minimal boundary for a compiled LangGraph subgraph. The plugin owns its state schema.
 * @see AgentGraphEngine.addSubgraph for setup and usage.
 */
export interface GraphSubgraph {
  /**
   * Invokes the compiled child graph.
   * @param input - Host-mapped child input.
   * @param config - Parent-supplied checkpoint thread/namespace configuration.
   * @returns Child output, interpreted by the parent mapOutput callback.
   * @throws Child execution/checkpoint failures propagate or can be mapped for recognized interrupts.
   
   * @example
   * ```typescript
   * import type { GraphSubgraph } from "@alneas/eaos-server";
   * export async function invokeHostSubgraph(
   *   subgraph: GraphSubgraph,
   *   input: Parameters<GraphSubgraph["invoke"]>[0],
   *   config: Parameters<GraphSubgraph["invoke"]>[1],
   * ) {
   *   // Supply the host's admitted input and checkpoint/thread configuration.
   *   return await subgraph.invoke(input, config);
   * }
   * ```
   */
  invoke(input: unknown, config?: unknown): Promise<unknown>
  /**
 * Inspects child state when a recognized interrupt needs mapping.
 * @param config - Child checkpoint thread/namespace configuration.
 * @returns Host-specific child checkpoint state.
 * @throws Inspection failures propagate to parent execution.
 
   * @example
   * ```typescript
   * import type { GraphSubgraph } from "@alneas/eaos-server";
   * export async function inspectHostSubgraph(
   *   subgraph: GraphSubgraph, config: Parameters<NonNullable<GraphSubgraph["getState"]>>[0],
   * ) {
   *   if (!subgraph.getState) throw new Error("Subgraph state inspection is unavailable");
   *   return await subgraph.getState(config);
   * }
   * ```
   */
  getState?(config?: unknown): Promise<unknown>
  /**
 * Continues a child after a verified parent approval.
 * @param input - Host-mapped child input.
 * @param decision - Parent-approved human decision.
 * @param config - Child checkpoint thread/namespace configuration.
 * @returns Resumed child output.
 * @throws Child execution/checkpoint failures propagate.
 
   * @example
   * ```typescript
   * import type { GraphSubgraph } from "@alneas/eaos-server";
   * export async function resumeHostSubgraph(
   *   subgraph: GraphSubgraph,
   *   input: Parameters<NonNullable<GraphSubgraph["resume"]>>[0],
   *   verifiedDecision: Parameters<NonNullable<GraphSubgraph["resume"]>>[1],
   *   config: Parameters<NonNullable<GraphSubgraph["resume"]>>[2],
   * ) {
   *   if (!subgraph.resume) throw new Error("Subgraph resumption is unavailable");
   *   // The host authenticates/authorizes this decision before entering the subgraph.
   *   return await subgraph.resume(input, verifiedDecision, config);
   * }
   * ```
   */
  resume?(input: unknown, decision: GraphApprovalDecision, config?: unknown): Promise<unknown>
}

/**
 * Host-verified human decision supplied to a pending graph approval.
 * @see AgentGraphEngine.resumeAfterApproval.
 */
export interface GraphApprovalDecision {
  /** True to continue; false to finish with a rejection error. */
  approved: boolean
  /** Authenticated human approver identifier. */
  approverId: string
  /** Verified role associated with the decision. */
  approverRole: string
  /** Optional human note; rejection uses a default description when blank. */
  comment?: string
}

/**
 * Explicit state mapping, child-thread identity, and interrupt translation for {@link AgentGraphEngine.addSubgraph}.
 */
export interface GraphSubgraphOptions {
  /** Optional synchronous parent-state to child-input mapping; defaults to passing parent state. */
  mapInput?: (state: AgentGraphState) => unknown
  /** Optional synchronous child-output/parent-state to update mapping; absent treats output as a partial parent state. */
  mapOutput?: (output: unknown, state: AgentGraphState) => Partial<AgentGraphState>
  /** Optional synchronous child thread ID builder; defaults to sessionId:name and must be nonblank. */
  threadId?: (state: AgentGraphState) => string
  /** Called for a recognized nested LangGraph interrupt with error, parent state, and optional child checkpoint; resolves a parent update, normally pendingApproval. Errors propagate. */
  mapInterrupted?: (error: unknown, state: AgentGraphState, subgraphState: unknown) => Partial<AgentGraphState> | Promise<Partial<AgentGraphState>>
  /** Serializable metadata used by workflow viewers; never executed. */
  visual?: WorkflowGraphNodeInput
}

/**
 * Checkpoint persistence, live approval authority, and workflow metadata for {@link AgentGraphEngine}.
 */
export interface AgentGraphEngineOptions {
  /** Host-owned live membership/lifecycle/resource re-check at resume time. */
  authorizeResume?: (state: AgentGraphState, input: {
  /**
   * Nonblank authenticated approver identifier supplied by the host.
   */
  approverId: string;
  /**
   * Nonblank verified role associated with this human decision.
   */
  approverRole: string;
  /**
   * True requests continuation and requires a current authorizer; false rejects the workflow but is also checked when an authorizer exists.
   */
  approved: boolean }) => Promise<boolean>
  /** Official LangGraph checkpointer. MemorySaver is local/test-only when omitted. */
  checkpointer?: BaseCheckpointSaver
  /** Stable identity shown by workflow viewers and exported graph documents. */
  workflowId?: string
  /** Optional workflow version included in graph descriptions. */
  workflowVersion?: string
}

/**
 * Execution retry and display settings for {@link AgentGraphEngine.addNode}.
 */
export interface GraphNodeOptions {
  /** Optional LangGraph retry settings; retries can repeat handler side effects and must be safe by host design. */
  retryPolicy?: RetryPolicy
  /** Serializable metadata used by workflow viewers; never executed. */
  visual?: WorkflowGraphNodeInput
}

/**
 * Serializable display metadata for {@link AgentGraphEngine.addEdge}.
 */
export interface GraphEdgeOptions {
  /** Serializable metadata used by workflow viewers; never executed. */
  visual?: WorkflowGraphEdgeInput
}

/**
 * Display metadata for declared branches in {@link AgentGraphEngine.addConditionalEdges}.
 */
export interface GraphConditionalEdgeOptions extends GraphEdgeOptions {
  /** Per-destination labels such as `approved` or `needs_correction`. */
  labels?: Readonly<Record<string, string>>
}

interface ConditionalRoute {
  router: GraphRouter
  destinations: string[]
  visual?: GraphConditionalEdgeOptions
}

type RuntimeState = AgentGraphState

const GraphState = Annotation.Root({
  sessionId: Annotation<string>,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  currentStep: Annotation<string>,
  history: Annotation<AgentGraphState['history']>({ reducer: (_left, right) => right, default: () => [] }),
  context: Annotation<Record<string, unknown> | undefined>({
    reducer: (left, right) => {
      if (right === undefined) return left
      const merged = { ...left, ...right }
      if (merged.__eaosSubgraphResume === null) delete merged.__eaosSubgraphResume
      return merged
    },
    default: () => undefined,
  }),
  citations: Annotation<AgentGraphState['citations']>,
  pendingApproval: Annotation<AgentGraphState['pendingApproval']>,
  checkpointRevision: Annotation<number | undefined>,
  lastApproval: Annotation<AgentGraphState['lastApproval']>,
  isComplete: Annotation<boolean>,
  error: Annotation<string | undefined>,
})

/**
 * EAOS workflow runtime backed by the official LangGraph StateGraph.
 * EAOS remains responsible for authorization, approval bindings and side effects.
 * @remarks The default MemorySaver is process-local/test storage. Production hosts must supply durable, tenant-scoped checkpoint persistence, verified initial identity, live resume authorization, and writer serialization. This class does not serialize concurrent calls for the same session or implement transactional side effects. Mutating topology invalidates the compiled graph; configure it before starting workflow sessions.
 * @example
 * ```typescript
 * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
 * const graph = new AgentGraphEngine();
 * graph.addNode("start", async () => ({ isComplete: true }));
 * console.log(graph.describe().entryNode); // "start"
 * ```
 */
export class AgentGraphEngine {
  private readonly nodes = new Map<string, GraphNodeHandler>()
  private readonly edges = new Map<string, string[]>()
  private readonly edgeVisuals = new Map<string, WorkflowGraphEdgeInput[]>()
  private readonly nodeOptions = new Map<string, GraphNodeOptions>()
  private readonly conditionalRoutes = new Map<string, ConditionalRoute>()
  private readonly checkpointer: BaseCheckpointSaver
  private readonly authorizeResume?: AgentGraphEngineOptions['authorizeResume']
  private readonly workflowId?: string
  private readonly workflowVersion?: string
  private entryNode = 'start'
  private compiled?: ReturnType<StateGraph<typeof GraphState, RuntimeState, Partial<RuntimeState>, string>['compile']>
  private graphVersion = 0
  private compiledVersion = -1

  /**
   * Creates a graph builder with a host saver or options; compilation is deferred until execution/checkpoint reads.
   * @param checkpointerOrOptions - LangGraph saver or options; omission uses an independent MemorySaver.
   * @param options - Additional options used only when the first argument is a saver; otherwise ignored.
   */
  constructor(
    checkpointerOrOptions: BaseCheckpointSaver | AgentGraphEngineOptions = {},
    options: AgentGraphEngineOptions = {},
  ) {
    const supplied = isCheckpointSaver(checkpointerOrOptions)
      ? { ...options, checkpointer: checkpointerOrOptions }
      : checkpointerOrOptions
    this.checkpointer = supplied.checkpointer ?? new MemorySaver()
    this.authorizeResume = supplied.authorizeResume
    this.workflowId = supplied.workflowId
    this.workflowVersion = supplied.workflowVersion
  }

  /**
   * Registers or replaces a named handler and invalidates compiled topology.
   * @param name - Nonblank node name; __eaos_approval__ is reserved. Names are retained without trimming.
   * @param handler - Async callback receiving a cloned state and resolving partial state updates.
   * @param options - Optional LangGraph retry policy and serializable display metadata.
   * @returns This builder for chaining.
   * @throws For blank/reserved names; handler failures occur later during execution.
   * @example
   * ```typescript
   * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * const graph = new AgentGraphEngine();
   * graph.addNode("start", async () => ({ isComplete: true }));
   * graph.addNode("finish", async () => ({ isComplete: true }));
   * ```
   */
  addNode(name: string, handler: GraphNodeHandler, options: GraphNodeOptions = {}): this {
    if (!name.trim() || name === '__eaos_approval__') throw new Error('Invalid workflow node name')
    this.nodes.set(name, handler)
    this.nodeOptions.set(name, options)
    this.invalidate()
    return this
  }

  /**
   * Mount a plugin-owned compiled LangGraph as one parent-graph node.
   * Input/output mapping is explicit so plugin state does not silently leak into
   * the EAOS state, while the nested graph still gets its own checkpoint thread.
   * @param name - Parent node identifier, subject to addNode validation.
   * @param subgraph - Compiled graph with invoke and optional state/resume capabilities.
   * @param options - Input/output mapping and child-thread identity; defaults pass state/output through and use sessionId:name as thread ID.
   * @returns This graph builder.
   * @throws If subgraph lacks invoke or the name is invalid. Execution propagates mapping/subgraph errors except recognized interrupts handled by mapInterrupted.
   * @remarks Child config uses checkpoint_ns=name. A mapped interrupt stores resume metadata in context; host mappings must preserve tenant boundaries and avoid leaking child state.
   * @example
   * ```typescript
   * import { AgentGraphEngine, type GraphSubgraph } from "@alneas/eaos-server/agentic/graph";
   * export function nested(subgraph: GraphSubgraph) {
   *   return new AgentGraphEngine().addSubgraph("start", subgraph, { mapOutput: output => ({ context: { child: output } }) });
   * }
   * ```
   */
  addSubgraph(name: string, subgraph: GraphSubgraph, options: GraphSubgraphOptions = {}): this {
    if (!subgraph || typeof subgraph.invoke !== 'function') throw new Error('Compiled workflow subgraph is required')
    return this.addNode(name, async state => {
      const input = options.mapInput ? options.mapInput(state) : state
      const threadId = options.threadId?.(state) ?? `${state.sessionId}:${name}`
      if (!threadId.trim()) throw new Error('Subgraph thread id is required')
      const config = { configurable: { thread_id: threadId, checkpoint_ns: name } }
      const resume = state.context?.__eaosSubgraphResume as { node?: string; decision?: GraphApprovalDecision } | undefined
      let output: unknown
      try {
        output = resume?.node === name && resume.decision && subgraph.resume
          ? await subgraph.resume(input, resume.decision, config)
          : await subgraph.invoke(input, config)
      } catch (error) {
        if (!options.mapInterrupted || !isLangGraphInterrupt(error)) throw error
        const subgraphState = subgraph.getState ? await subgraph.getState(config) : undefined
        const mapped = await options.mapInterrupted(error, state, subgraphState)
        return { ...mapped, context: { ...mapped.context, __eaosSubgraphResume: { node: name } } }
      }
      const context = { ...(state.context ?? {}) }
      if (context.__eaosSubgraphResume) context.__eaosSubgraphResume = null
      const mapped = options.mapOutput ? options.mapOutput(output, state) : (output as Partial<AgentGraphState>)
      return { ...mapped, context: { ...context, ...(mapped.context ?? {}) } }
    }, { visual: options.visual ?? { kind: 'subgraph', label: name } })
  }

  /**
   * Adds a declared edge and its display metadata.
   * @param from - Nonblank source node name.
   * @param to - Nonblank destination node name.
   * @param options - Optional serializable display metadata, cloned on insertion.
   * @returns This graph builder.
   * @throws For blank endpoints or uncloneable display metadata. Missing node references can fail compilation later.
   * @remarks Without conditional routing, execution follows only the first declared outgoing edge; describe may list additional declared edges.
   * @example
   * ```typescript
   * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * const graph = new AgentGraphEngine();
   * graph.addNode("start", async () => ({ isComplete: true }));
   * graph.addNode("finish", async () => ({}));
   * graph.addEdge("start", "finish");
   * ```
   */
  addEdge(from: string, to: string, options: GraphEdgeOptions = {}): this {
    if (!from.trim() || !to.trim()) throw new Error('Invalid workflow edge')
    this.edges.set(from, [...this.edges.get(from) ?? [], to])
    this.edgeVisuals.set(from, [...this.edgeVisuals.get(from) ?? [], structuredClone(options.visual ?? {})])
    this.invalidate()
    return this
  }

  /**
 * Sets a source node's conditional router and complete allowed destination set.
 * @param from - Nonblank source node name.
 * @param router - Called synchronously after the node with a state clone; must return one declared destination.
 * @param destinations - Nonempty list of nonblank destination names; duplicates are collapsed.
 * @param options - Cloned optional edge metadata and destination labels.
 * @returns This graph builder.
 * @throws For invalid source/destinations or uncloneable options; runtime routing rejects undeclared destinations and callback errors.
 * @remarks A pending approval overrides conditional routing and enters the approval node. This replaces an existing conditional route for from.
 * @example
 * ```typescript
 * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
 * const graph = new AgentGraphEngine();
 * graph.addNode("start", async () => ({ isComplete: true }));
 * graph.addNode("finish", async () => ({}));
 * graph.addConditionalEdges("start", () => "finish", ["finish"]);
 * ```
 */
  addConditionalEdges(from: string, router: GraphRouter, destinations: string[], options: GraphConditionalEdgeOptions = {}): this {
    if (!from.trim() || !destinations.length || destinations.some(destination => !destination.trim())) throw new Error('Invalid conditional workflow route')
    this.conditionalRoutes.set(from, { router, destinations: [...new Set(destinations)], visual: structuredClone(options) })
    this.invalidate()
    return this
  }

  /**
   * Selects the registered node where future graph execution starts.
   * @param nodeName - Nonblank node name; existence is checked on deferred compilation.
   * @returns This builder after invalidating compiled topology.
   * @throws For a blank name; missing entry registration fails later on compilation.
   * @example
   * ```typescript
   * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * const graph = new AgentGraphEngine();
   * graph.addNode("start", async () => ({ isComplete: true }));
   * graph.setEntryPoint("start");
   * ```
   */
  setEntryPoint(nodeName: string): this {
    if (!nodeName.trim()) throw new Error('Invalid workflow entry node')
    this.entryNode = nodeName
    this.invalidate()
    return this
  }

  /**
   * Reads the first statically declared outgoing edge without evaluating conditional routing.
   * @param fromNode - Exact source node identifier.
   * @returns First declared destination, or undefined when no static edge exists.
   * @example
   * ```typescript
   * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * const graph = new AgentGraphEngine();
   * graph.addNode("start", async () => ({ isComplete: true }));
   * console.log(graph.getNextNode("start")); // undefined
   * ```
   */
  getNextNode(fromNode: string): string | undefined {
    return this.edges.get(fromNode)?.[0]
  }

  /**
   * Return a serializable graph description for UI/API/diagram consumers.
   * Handlers and router functions are intentionally omitted: this is metadata,
   * not a remotely executable workflow definition.
   * @returns A structured clone of versioned node/edge display metadata in insertion order; may describe an incomplete graph before compilation.
   * @throws If retained metadata has become uncloneable.
   * @example
   * ```typescript
   * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * const graph = new AgentGraphEngine();
   * graph.addNode("start", async () => ({ isComplete: true }));
   * console.log(graph.describe().nodes.length); // 1
   * ```
   */
  describe(): WorkflowGraphDescription {
    const nodes = [...this.nodes.keys()].map(id => {
      const visual = this.nodeOptions.get(id)?.visual ?? {}
      return {
        id,
        kind: visual.kind ?? 'task',
        label: visual.label?.trim() || id,
        ...(visual.description === undefined ? {} : { description: visual.description }),
        ...(visual.pluginId === undefined ? {} : { pluginId: visual.pluginId }),
        ...(visual.approvalLevel === undefined ? {} : { approvalLevel: visual.approvalLevel }),
        ...(visual.riskLevel === undefined ? {} : { riskLevel: visual.riskLevel }),
        ...(visual.toolName === undefined ? {} : { toolName: visual.toolName }),
        canRequestApproval: visual.canRequestApproval ?? true,
        ...(visual.retryable === undefined ? {} : { retryable: visual.retryable }),
        ...(visual.subgraphId === undefined ? {} : { subgraphId: visual.subgraphId }),
        ...(visual.subgraphVersion === undefined ? {} : { subgraphVersion: visual.subgraphVersion }),
      }
    })
    const edges = [] as WorkflowGraphDescription['edges'][number][]
    for (const [from, destinations] of this.edges) {
      if (this.conditionalRoutes.has(from)) continue
      destinations.forEach((to, index) => {
        const visual = this.edgeVisuals.get(from)?.[index] ?? {}
        edges.push({ from, to, kind: visual.kind ?? 'normal', ...(visual.label === undefined ? {} : { label: visual.label }), ...(visual.condition === undefined ? {} : { condition: visual.condition }) })
      })
    }
    for (const [from, route] of this.conditionalRoutes) {
      for (const to of route.destinations) {
        const visual = route.visual?.visual ?? {}
        const label = route.visual?.labels?.[to] ?? visual.label
        edges.push({ from, to, kind: visual.kind ?? 'conditional', ...(label === undefined ? {} : { label }), ...(visual.condition === undefined ? {} : { condition: visual.condition }) })
      }
    }
    return structuredClone({ schemaVersion: '1.0' as const, ...(this.workflowId ? { workflowId: this.workflowId } : {}), ...(this.workflowVersion ? { workflowVersion: this.workflowVersion } : {}), entryNode: this.entryNode, nodes, edges })
  }

  /**
 * Extracts runtime status and approval display metadata without history, context, or approval args.
 * @param state - Authorized checkpoint state to summarize.
 * @returns Status prioritized as waiting_approval, failed, completed, running, then idle, plus current node/revision and optional error/approval display details.
 * @remarks Reasons and errors remain visible; the host must control their content and authorize access to this overlay.
 * @example
 * ```typescript
 * import { AgentGraphEngine, type AgentGraphState } from "@alneas/eaos-server/agentic/graph";
 * export function overlay(state: AgentGraphState) {
 *   return new AgentGraphEngine().describeRuntime(state);
 * }
 * ```
 */
  describeRuntime(state: AgentGraphState): WorkflowGraphRuntimeSnapshot {
    const status: WorkflowGraphRuntimeSnapshot['status'] = state.pendingApproval ? 'waiting_approval' : state.error ? 'failed' : state.isComplete ? 'completed' : state.currentStep ? 'running' : 'idle'
    return {
      status,
      ...(state.currentStep && state.currentStep !== END ? { currentNodeId: state.currentStep } : {}),
      ...(state.checkpointRevision === undefined ? {} : { checkpointRevision: state.checkpointRevision }),
      ...(state.pendingApproval ? {
        pendingApproval: {
          ...(state.pendingApproval.approvalId === undefined ? {} : { approvalId: state.pendingApproval.approvalId }),
          toolName: state.pendingApproval.toolName,
          approvalLevel: state.pendingApproval.approvalLevel,
          riskLevel: state.pendingApproval.riskLevel,
          reason: state.pendingApproval.reason,
        },
      } : {}),
      ...(state.error === undefined ? {} : { error: state.error }),
    }
  }

  /**
 * Reads a session checkpoint and combines its display overlay with the current static graph.
 * @param sessionId - Authorized host session/thread identifier.
 * @returns Graph description and runtime overlay when a checkpoint exists, or only graph metadata otherwise.
 * @throws Rejects compilation, saver, or description failures.
 * @remarks This method does not authenticate the caller or authorize session access.
 * @example
 * ```typescript
 * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
 * const graph = new AgentGraphEngine();
 * graph.addNode("start", async () => ({ isComplete: true }));
 * const visualization = await graph.getVisualization("example-session");
 * console.log(visualization.graph.nodes.length);
 * ```
 */
  async getVisualization(sessionId: string): Promise<WorkflowGraphVisualization> {
    const state = await this.getCheckpoint(sessionId)
    return { graph: this.describe(), ...(state ? { runtime: this.describeRuntime(state) } : {}) }
  }

  /**
   * Reads the current saved state for one graph session.
   * @param sessionId - Authorized LangGraph thread ID.
   * @returns A structured clone of persisted state, or null when no session state exists.
   * @throws Rejects deferred compilation, saver, or clone failures.
   * @remarks The host authorizes tenant/session access; sessionId alone is not an authentication claim.
   * @example
   * ```typescript
   * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * const graph = new AgentGraphEngine();
   * graph.addNode("start", async () => ({ isComplete: true }));
   * console.log(await graph.getCheckpoint("example-session")); // null
   * ```
   */
  async getCheckpoint(sessionId: string): Promise<AgentGraphState | null> {
    const snapshot = await this.ensureCompiled().getState(this.config(sessionId))
    return snapshot.values && typeof snapshot.values === 'object' && 'sessionId' in snapshot.values
      ? toAgentState(snapshot.values as RuntimeState)
      : null
  }

  /**
 * Runs the graph until completion or a LangGraph approval interrupt.
 * @param initialState - Verified host session/tenant/user state; a nonblank sessionId is required. Existing pendingApproval returns an immediate clone without invoking the graph.
 * @returns Latest checkpoint state after execution, interrupted approval state, or the supplied initial state when no checkpoint is available.
 * @throws Rejects invalid sessionId, compilation, handler/retry, saver, binding, or clone errors except recognized approval interrupts.
 * @remarks This method runs multiple nodes, despite its name. The host must serialize writers and make retried handlers safe for side effects. It installs no timeout or cancellation itself.
 * @example
 * ```typescript
 * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
 * const graph = new AgentGraphEngine();
 * graph.addNode("start", async () => ({ isComplete: true }));
 * const state = await graph.runStep({ sessionId: "example-session", tenantId: "example", userId: "example-user", currentStep: "start", history: [], isComplete: false });
 * console.log(state.isComplete); // true
 * ```
 */
  async runStep(initialState: AgentGraphState): Promise<AgentGraphState> {
    if (!initialState?.sessionId?.trim()) throw new Error('Workflow sessionId is required')
    if (initialState.pendingApproval) return structuredClone(initialState)
    try {
      await this.ensureCompiled().invoke(initialState as RuntimeState, this.config(initialState.sessionId))
    } catch (error) {
      const interrupted = await this.getCheckpoint(initialState.sessionId)
      if (interrupted?.pendingApproval && isLangGraphInterrupt(error)) return interrupted
      throw error
    }
    return (await this.getCheckpoint(initialState.sessionId)) ?? initialState
  }

  /**
 * Validates a pending approval binding and host authority before resuming its LangGraph thread.
 * @param input - Session ID, verified approver ID/role, boolean decision, optional comment, optional expected approvalId/bindingHash, and optional live authorizer overriding constructor settings.
 * @returns Resumed state on success, or resumed:false with an error for absent/mismatched approval, denied authorization, or normalized invocation failure. A denial decision completes the graph as rejected.
 * @throws Can reject saver/compilation errors, live authorizer rejection, or post-resume checkpoint failures.
 * @remarks An approved decision requires a live authorizer returning exactly true; a supplied authorizer also checks rejection decisions. Host writer serialization is required: this method does not acquire an independent lock or compare-and-swap checkpoint revisions. Missing optional expected IDs skip those comparisons. Resume failures can follow side effects; no rollback or automatic retry occurs.
 * @example
 * ```typescript
 * import { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
 * export async function decide(graph: AgentGraphEngine, input: Parameters<AgentGraphEngine["resumeAfterApproval"]>[0]) {
 *   // Authenticate the approver and supply live authorization before approving.
 *   return graph.resumeAfterApproval(input);
 * }
 * ```
 */
  async resumeAfterApproval(input: {
    
    /**
     * LangGraph thread/session identity whose saved pending approval is loaded and resumed.
     */
    sessionId: string
    
    /**
     * Optional expected ticket identity; when truthy it must equal the saved pending ticket, while omission skips this comparison.
     */
    approvalId?: string
    
    /**
     * Optional expected request/contract binding hash; when truthy it must match the saved binding, while omission skips this comparison.
     */
    bindingHash?: string
    
    /**
     * Verified review decision; true requires live authorization returning exactly true, while false resumes the graph as rejected.
     */
    approved: boolean
    
    /**
     * Nonblank host-verified reviewer identity supplied to the live authorizer and recorded in lastApproval.
     */
    approverId: string
    
    /**
     * Nonblank host-verified reviewer role supplied to the live authorizer and recorded in lastApproval.
     */
    approverRole: string
    
    /**
     * Optional reviewer comment retained in the graph decision; the host owns content/privacy policy.
     */
    comment?: string
    
    /**
     * Optional live reviewer-authority callback overriding the constructor authorizer for this resume attempt.
     * @remarks Uses AgentGraphEngineOptions.authorizeResume: receives a cloned checkpoint and reviewer/decision metadata, resolves exactly true to permit resumption, and may reject. Required from either source for approved=true; when supplied it also checks rejected decisions. Omission uses the constructor callback.
     * @see {@link AgentGraphEngineOptions.authorizeResume}
     */
    authorizeResume?: AgentGraphEngineOptions['authorizeResume']
  }): Promise<{ 
  /** True when verification/resumption reaches a readable checkpoint, including a resumed rejection decision; false on normalized failures and not proof that no side effect occurred. */
  resumed: boolean; 
  /** Graph state loaded after resumption when available; may represent completion, rejection or another pending interrupt rather than final workflow success. */
  state?: AgentGraphState; 
  /** Optional explanation for a missing/mismatched approval, denied authority, invocation failure or disappeared checkpoint; some saver/authorizer errors reject instead. */
  error?: string }> {
    const graph = this.ensureCompiled()
    const checkpoint = await this.getCheckpoint(input.sessionId)
    if (!checkpoint) return { resumed: false, error: `Workflow session '${input.sessionId}' not found` }
    const pending = checkpoint.pendingApproval
    if (!pending) return { resumed: false, error: 'Workflow is not awaiting approval' }
    try {
      if (input.approvalId && input.approvalId !== pending.approvalId) return { resumed: false, error: 'Approval ticket does not match workflow state' }
      if (!pending.binding || (input.bindingHash && input.bindingHash !== pending.binding.bindingHash)) return { resumed: false, error: 'Approval binding does not match workflow state' }
      validateApprovalBinding(pending.binding)
    } catch (error) {
      return { resumed: false, error: error instanceof Error ? error.message : 'Invalid approval binding' }
    }
    if (!input.approverId.trim() || !input.approverRole.trim()) return { resumed: false, error: 'Approver identity is required' }
    const authorizeResume = input.authorizeResume ?? this.authorizeResume
    if (input.approved && !authorizeResume) return { resumed: false, error: 'Current authorization verifier is required before workflow resume' }
    if (authorizeResume && await authorizeResume(structuredClone(checkpoint), { approverId: input.approverId, approverRole: input.approverRole, approved: input.approved }) !== true) return { resumed: false, error: 'Current authorization no longer permits workflow resume' }

    const decision: GraphApprovalDecision = { approved: input.approved, approverId: input.approverId, approverRole: input.approverRole, comment: input.comment }
    try {
      await graph.invoke(new Command({ resume: decision }), this.config(input.sessionId))
    } catch (error) {
      if (!isLangGraphInterrupt(error)) return { resumed: false, error: error instanceof Error ? error.message : 'Workflow resume failed' }
    }
    const state = await this.getCheckpoint(input.sessionId)
    return state ? { resumed: true, state } : { resumed: false, error: 'Workflow checkpoint disappeared after resume' }
  }

  private invalidate() {
    this.graphVersion += 1
    this.compiled = undefined
  }

  private config(sessionId: string) {
    return { configurable: { thread_id: sessionId } }
  }

  private ensureCompiled() {
    if (this.compiled && this.compiledVersion === this.graphVersion) return this.compiled
    if (!this.nodes.has(this.entryNode)) throw new Error(`Workflow entry node '${this.entryNode}' is not registered`)

    const builder = new StateGraph<typeof GraphState, RuntimeState, Partial<RuntimeState>, string>(GraphState)
    for (const [name, handler] of this.nodes) {
      builder.addNode(name, async (state) => this.runNode(name, handler, state as RuntimeState), this.nodeOptions.get(name))
    }
    builder.addNode('__eaos_approval__', async (state) => this.runApprovalNode(state as RuntimeState))
    builder.addEdge(START, this.entryNode)

    for (const name of this.nodes.keys()) {
      const route = this.conditionalRoutes.get(name)
      const next = this.edges.get(name)?.[0] ?? END
      if (route) {
        const destinations = [...new Set([...route.destinations, '__eaos_approval__'])]
        builder.addConditionalEdges(
          name,
          state => state.pendingApproval ? '__eaos_approval__' : routeToDestination(route, state as RuntimeState),
          destinations,
        )
      } else {
        const destinations = next === END ? [END, '__eaos_approval__'] : [next, '__eaos_approval__']
        builder.addConditionalEdges(name, state => (state.pendingApproval ? '__eaos_approval__' : next), destinations)
      }
    }
    const approvalDestinations = [...this.nodes.keys(), END, '__eaos_approval__']
    builder.addConditionalEdges('__eaos_approval__', state => state.pendingApproval ? '__eaos_approval__' : (state.currentStep || END), approvalDestinations)

    this.compiled = builder.compile({ checkpointer: this.checkpointer })
    this.compiledVersion = this.graphVersion
    return this.compiled
  }

  private async runNode(name: string, handler: GraphNodeHandler, state: RuntimeState) {
    const update = await handler(toAgentState(state))
    const nextState: Partial<RuntimeState> = { ...update, currentStep: update.currentStep ?? name }
    if (nextState.pendingApproval) {
      nextState.pendingApproval = this.bindApproval(state, nextState.pendingApproval)
      nextState.isComplete = false
    } else if (!this.edges.get(name)?.length && !this.conditionalRoutes.has(name)) {
      nextState.isComplete = true
    }
    return nextState
  }

  private runApprovalNode(state: RuntimeState) {
    if (!state.pendingApproval) return { currentStep: END, isComplete: true }
    const decision = interrupt({ type: 'approval', pendingApproval: state.pendingApproval }) as { approved?: boolean; approverId?: string; approverRole?: string; comment?: string }
    if (!decision || typeof decision.approved !== 'boolean' || !decision.approverId || !decision.approverRole) throw new Error('Invalid approval decision')
    const lastApproval = { ...decision, approvalId: state.pendingApproval.approvalId!, bindingHash: state.pendingApproval.binding!.bindingHash, decidedAt: new Date().toISOString() }
    if (!decision.approved) {
      return {
        pendingApproval: undefined,
        lastApproval,
        currentStep: END,
        isComplete: true,
        error: `Rejected by ${decision.approverRole} (${decision.approverId}): ${decision.comment || 'No reason provided'}`,
      }
    }
    const next = this.edges.get(state.currentStep)?.[0] ?? END
    return {
      pendingApproval: undefined,
      lastApproval,
        currentStep: state.context?.__eaosSubgraphResume ? state.currentStep : next,
        isComplete: state.context?.__eaosSubgraphResume ? false : next === END,
        context: state.context?.__eaosSubgraphResume ? { ...state.context, __eaosSubgraphResume: { ...state.context.__eaosSubgraphResume as object, decision } } : state.context,
      history: [...state.history, { role: 'human_approver', content: `Approved by ${decision.approverRole} (${decision.approverId})`, timestamp: new Date().toISOString() }],
    }
  }

  private bindApproval(state: RuntimeState, pending: NonNullable<AgentGraphState['pendingApproval']>) {
    const approvalId = pending.approvalId ?? randomUUID()
    const binding = pending.binding ? validateApprovalBinding(pending.binding) : createApprovalBinding({
      tenantId: state.tenantId,
      requestedBy: state.userId,
      operation: pending.toolName,
      ...(pending.target ? { target: pending.target } : {}),
      input: pending.args,
      contract: {
        operation: pending.toolName,
        version: pending.contractVersion ?? '1.0.0',
        /** Optional generated binding permission; defaults to toolName. */
    permission: pending.permission ?? pending.toolName,
        sideEffect: 'external',
        riskLevel: (['low', 'medium', 'high', 'critical'].includes(pending.riskLevel) ? pending.riskLevel : 'high') as RiskLevel,
        approvalLevel: pending.approvalLevel,
        inputSchema: { type: 'object', additionalProperties: true },
      },
    })
    if (binding.tenantId !== state.tenantId || binding.requestedBy !== state.userId || binding.operation !== pending.toolName) throw new Error('Approval binding does not match workflow state')
    return { ...pending, approvalId, binding }
  }
}

function isCheckpointSaver(value: BaseCheckpointSaver | AgentGraphEngineOptions): value is BaseCheckpointSaver {
  return typeof value === 'object' && value !== null && 'getTuple' in value && 'put' in value
}

function routeToDestination(route: ConditionalRoute, state: RuntimeState): string {
  const destination = route.router(toAgentState(state))
  if (!route.destinations.includes(destination)) throw new Error(`Workflow router returned undeclared destination '${destination}'`)
  return destination
}

function toAgentState(value: RuntimeState): AgentGraphState {
  return structuredClone(value)
}

function isLangGraphInterrupt(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && ('lc_error_code' in error && (error as { lc_error_code?: unknown }).lc_error_code === 'GRAPH_INTERRUPT' || error.constructor?.name === 'GraphInterrupt'))
}
