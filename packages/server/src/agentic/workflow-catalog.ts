import type { WorkflowDefinition, WorkflowDefinitionNode, WorkflowDefinitionNodeKind, WorkflowToolScopeDefinition } from '@alneas/eaos-core'
import type { AgentGraphState, GraphNodeHandler, GraphSubgraph } from './graph'

/**
 * Serializable node metadata exposed to workflow editors by {@link WorkflowNodeCatalog}.
 */
export interface WorkflowNodeDescriptor {
  /** Unique lowercase catalog type identifier, at most 128 characters. */
  type: string
  /** Editor label, trimmed and required during registration. */
  label: string
  /** Optional human-readable editor description. */
  description?: string
  /** Optional owning plugin ID included in visual metadata. */
  pluginId?: string
  /** Workflow node category used unless a definition overrides it. */
  kind: WorkflowDefinitionNodeKind
  /** Optional declared tool-scope metadata; execution enforcement belongs to the host handler. */
  toolScope?: WorkflowToolScopeDefinition
  /** Optional visual capability flag; compilation defaults to true when no node approval is declared. */
  canRequestApproval?: boolean
}

/**
 * Definition and node context supplied when compiling a registered workflow node.
 * @see WorkflowNodeRegistration.
 */
export interface WorkflowNodeResolverInput {
  /** Validated serializable workflow definition being compiled. */
  definition: WorkflowDefinition
  /** Specific definition node being resolved. */
  node: WorkflowDefinitionNode
  /** Optional runtime state for host-specific resolution; the standard compiler omits it. */
  state?: AgentGraphState
}

/**
 * Trusted host/plugin handler and optional subgraph resolution for one catalog node type.
 * @see WorkflowNodeCatalog.register.
 */
export interface WorkflowNodeRegistration {
  /** Serializable editor metadata cloned at registration. */
  descriptor: WorkflowNodeDescriptor
  /**
 * Resolves a plugin/host handler while preserving the Effect/Receipt boundary.
 * @param input - Validated definition and node being compiled.
 * @returns A graph handler, synchronously or asynchronously; the compiler rejects nonfunctions.
 * @throws Resolver failures reject compilation.
 
   * @example
   * ```typescript
   * import type { WorkflowNodeRegistration } from "@alneas/eaos-server";
   * export async function resolveHostNode(
   *   registration: WorkflowNodeRegistration,
   *   validatedInput: Parameters<WorkflowNodeRegistration["resolve"]>[0],
   * ) {
   *   const handler = await registration.resolve(validatedInput);
   *   return handler; // Resolving a handler does not execute its effects.
   * }
   * ```
   */
  resolve(input: WorkflowNodeResolverInput): GraphNodeHandler | Promise<GraphNodeHandler>
  /**
 * Resolves a compiled LangGraph subgraph for a definition declaring subflow.
 * @param input - Validated definition and subflow node.
 * @returns A graph exposing invoke, synchronously or asynchronously.
 * @throws Resolver failures reject compilation.
 
   * @example
   * ```typescript
   * import type { WorkflowNodeRegistration } from "@alneas/eaos-server";
   * export async function resolveHostSubflow(
   *   registration: WorkflowNodeRegistration,
   *   validatedInput: Parameters<NonNullable<WorkflowNodeRegistration["resolveSubgraph"]>>[0],
   * ) {
   *   if (!registration.resolveSubgraph) throw new Error("This node has no subgraph resolver");
   *   return await registration.resolveSubgraph(validatedInput);
   * }
   * ```
   */
  resolveSubgraph?(input: WorkflowNodeResolverInput): GraphSubgraph | Promise<GraphSubgraph>
}

/**
 * Registers trusted host/plugin node resolvers and cloned descriptors for workflow compilation and editors.
 * @remarks Storage is process-local; no persistence or authorization is supplied.
 * @example
 * ```typescript
 * import { WorkflowNodeCatalog } from "@alneas/eaos-server/agentic/workflow-catalog";
 * const catalog = new WorkflowNodeCatalog();
 * const unregister = catalog.register({ descriptor: { type: "example.task", label: "Example", kind: "task" }, resolve: () => async () => ({}) });
 * console.log(catalog.list().length); // 1
 * unregister();
 * ```
 */
export class WorkflowNodeCatalog {
  private readonly registrations = new Map<string, WorkflowNodeRegistration>()

  /**
   * Registers a unique node type and returns a safe unregister callback.
   * @param registration - Descriptor with nonblank label and type matching lowercase letters/digits/dot/underscore/hyphen up to 128 characters, plus a handler resolver.
   * @returns A no-argument callback returning no value; it removes only this registration and does not remove a later replacement.
   * @throws Invalid type/label, duplicate type, missing resolver, or descriptor clone failure.
   * @remarks The descriptor is cloned and its label trimmed; resolver function references are retained.
   * @example
   * ```typescript
   * import { WorkflowNodeCatalog } from "@alneas/eaos-server/agentic/workflow-catalog";
   * const catalog = new WorkflowNodeCatalog();
   * const dispose = catalog.register({ descriptor: { type: "example.task", label: "Example", kind: "task" }, resolve: () => async () => ({}) });
   * dispose();
   * ```
   */
  register(registration: WorkflowNodeRegistration): () => void {
    const type = registration?.descriptor?.type
    if (!type || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(type)) throw new Error('Invalid workflow node catalog type')
    if (this.registrations.has(type)) throw new Error(`Workflow node type '${type}' is already registered`)
    if (!registration.resolve || typeof registration.resolve !== 'function') throw new Error(`Workflow node '${type}' must provide a resolver`)
    const descriptor = structuredClone({ ...registration.descriptor, type, label: registration.descriptor.label?.trim() })
    if (!descriptor.label) throw new Error(`Workflow node '${type}' must provide a label`)
    this.registrations.set(type, { ...registration, descriptor })
    return () => {
      if (this.registrations.get(type)?.descriptor === descriptor) this.registrations.delete(type)
    }
  }

  /**
   * Reads a registered resolver by exact node type.
   * @param type - Case-sensitive catalog type identifier.
   * @returns The retained registration, or undefined; mutation is not isolated by cloning.
   * @example
   * ```typescript
   * import { WorkflowNodeCatalog } from "@alneas/eaos-server/agentic/workflow-catalog";
   * console.log(new WorkflowNodeCatalog().get("example.task")); // undefined
   * ```
   */
  get(type: string): WorkflowNodeRegistration | undefined { return this.registrations.get(type) }

  /**
   * Reads a registered resolver or fails if the type is unavailable.
   * @param type - Exact catalog node type required by a workflow definition.
   * @returns The retained registration.
   * @throws If no registration exists for type.
   * @example
   * ```typescript
   * import { WorkflowNodeCatalog, type WorkflowNodeRegistration } from "@alneas/eaos-server/agentic/workflow-catalog";
   * export function registered(registration: WorkflowNodeRegistration) {
   *   const catalog = new WorkflowNodeCatalog();
   *   catalog.register(registration);
   *   return catalog.require(registration.descriptor.type);
   * }
   * ```
   */
  require(type: string): WorkflowNodeRegistration {
    const registration = this.get(type)
    if (!registration) throw new Error(`Workflow node type '${type}' is not registered`)
    return registration
  }

  /**
   * Lists cloned descriptors in registration insertion order.
   * @returns A new descriptor array, empty for an empty catalog; caller changes do not affect stored descriptors.
   * @throws If descriptors were externally mutated to contain uncloneable values.
   * @example
   * ```typescript
   * import { WorkflowNodeCatalog } from "@alneas/eaos-server/agentic/workflow-catalog";
   * console.log(new WorkflowNodeCatalog().list()); // []
   * ```
   */
  list(): readonly WorkflowNodeDescriptor[] {
    return structuredClone([...this.registrations.values()].map(item => item.descriptor))
  }
}
