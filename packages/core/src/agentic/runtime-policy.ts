/**
 * Host-neutral resource and placement policy for the three-host runtime.
 *
 * This is a reviewable default contract, not a Docker/systemd executor. Hosts
 * translate it to cgroups, container options or service units and may tighten
 * it after measuring the target machine.
 * @see {@link defaultRuntimePlacementPolicy}
 */
export const AGENT_RUNTIME_POLICY_VERSION = 1 as const

/**
 * Host-enforced temporary mount size and execution/privilege restrictions.
 * @see {@link defaultRuntimePlacementPolicy}
 */
export interface AgentTmpfsPolicy {
  
  /** Temporary mount path fixed to /tmp. */
  path: '/tmp'
  
  
  /** Host-enforced temporary filesystem byte ceiling; default policy sets 67108864 (64 MiB). */
  maxBytes: number
  
/** Host mount restriction forbidding execution from the temporary filesystem. */
  noexec: true
  
/** Host mount restriction disabling set-user-ID/set-group-ID privilege elevation. */
  nosuid: true
  
/** Host mount restriction disabling device-file interpretation. */
  nodev: true
}

/**
 * Ephemeral workspace placement and capacity configuration.
 * @see {@link defaultRuntimePlacementPolicy}
 */
export interface AgentWorkspacePolicy {
  /** quota-volume is the safer default when Ruri shares the AI host's RAM. */
  mode: 'quota-volume' | 'tmpfs'
  
  /** Ephemeral working mount path fixed to /workspace. */
  path: '/workspace'
  
  
  /** Host-enforced ephemeral workspace byte ceiling; default policy sets 1073741824 (1 GiB). */
  maxBytes: number
  
  /** Whether auth cookies persist, or whether a workspace survives execution; cookie default is true and runtime workspace is always false. */
  persistent: false
}

/**
 * AI-host runtime concurrency, duration, resource and isolation requirements.
 * @see {@link defaultRuntimePlacementPolicy}
 */
export interface AgentRuntimeResourcePolicy {
  
/** Host role on which the runtime must be enforced; the default places it on ai. */
  placement: 'ai'
  
/** Maximum concurrent agent runtimes; the default policy uses one. */
  maxConcurrent: number
  
/** Maximum runtime duration in milliseconds; the default policy uses 900000. */
  maxRuntimeMs: number
  
/** Host-enforced memory ceiling in megabytes; the default policy uses 2048. */
  memoryLimitMb: number
  
/** Host-enforced process count limit; the default policy uses 100. */
  pidsLimit: number
  
/** Read-only root-filesystem requirement to translate into host/container policy. */
  rootFilesystem: 'read-only'
  
/** Private-network-only runtime policy; the host must enforce network isolation. */
  network: 'private-only'
  
/** Temporary-filesystem size and mount restrictions supplied to the host. */
  tmpfs: AgentTmpfsPolicy
  
  
  /** Ephemeral workspace capacity/mount policy the host must enforce and clean up after execution. */
  workspace: AgentWorkspacePolicy
}

/**
 * Responsibilities and restrictions for edge, application worker and AI hosts.
 * @see {@link defaultRuntimePlacementPolicy}
 */
export interface RuntimePlacementPolicy {
  
  /** Resource/placement contract version fixed to AGENT_RUNTIME_POLICY_VERSION. */
  version: typeof AGENT_RUNTIME_POLICY_VERSION
  
/** Public edge placement restrictions; agent runtimes and model inference are forbidden. */
  edge: {
    
    /** Role-specific permission or AI-host resource policy for running agents; configuration alone does not enforce it. */
    agentRuntime: 'forbidden'
    
/** Whether the host role may execute model inference. */
    modelInference: 'forbidden'
    
    /** Whether this host role may accept public traffic; the default permits edge and forbids AI ingress. */
    publicIngress: 'allowed'
  }
  
/** Application-host dispatch, durable queue and workflow-state responsibilities. */
  applicationWorker: {
    
    /** Role-specific permission or AI-host resource policy for running agents; configuration alone does not enforce it. */
    agentRuntime: 'dispatch-only'
    
/** Host durable queue boundary; outbox or another host queue must back dispatch. */
    durableQueue: 'outbox-or-host-queue'
    
/** Host location for durable workflow state. */
    workflowState: 'shared-control-database'
  }
  
/** AI host placement and resource requirements. */
  ai: {
    
    /** Whether this host role may accept public traffic; the default permits edge and forbids AI ingress. */
    publicIngress: 'forbidden'
    
    /** Role-specific permission or AI-host resource policy for running agents; configuration alone does not enforce it. */
    agentRuntime: AgentRuntimeResourcePolicy
    
/** Host retrieval capability or placement binding; indexing remains host-owned. */
    retrieval: 'ruri-adapter'
  }
}

const defaultPolicy: RuntimePlacementPolicy = {
  version: AGENT_RUNTIME_POLICY_VERSION,
  edge: { agentRuntime: 'forbidden', modelInference: 'forbidden', publicIngress: 'allowed' },
  applicationWorker: { agentRuntime: 'dispatch-only', durableQueue: 'outbox-or-host-queue', workflowState: 'shared-control-database' },
  ai: {
    publicIngress: 'forbidden',
    retrieval: 'ruri-adapter',
    agentRuntime: {
      placement: 'ai',
      maxConcurrent: 1,
      maxRuntimeMs: 900_000,
      memoryLimitMb: 2_048,
      pidsLimit: 100,
      rootFilesystem: 'read-only',
      network: 'private-only',
      tmpfs: { path: '/tmp', maxBytes: 64 * 1024 * 1024, noexec: true, nosuid: true, nodev: true },
      workspace: { mode: 'quota-volume', path: '/workspace', maxBytes: 1_024 * 1024 * 1024, persistent: false },
    },
  },
}

/**
 * Return a detached policy so a host cannot mutate the shared defaults.
 * @returns A detached policy with one concurrent AI runtime, 900000 ms limit, 2048 MB memory, 100 PIDs, 64 MiB /tmp and 1 GiB ephemeral workspace.
 * @remarks This is configuration data. The host must translate and enforce it; no resources, filesystem mounts or processes are created.
 * @example
 * ```typescript
 * import { defaultRuntimePlacementPolicy } from "@alneas/eaos-core/agentic/runtime-policy";
 * console.log(defaultRuntimePlacementPolicy().ai.agentRuntime.maxConcurrent); // 1
 * ```
 */
export function defaultRuntimePlacementPolicy(): RuntimePlacementPolicy {
  return structuredClone(defaultPolicy)
}
