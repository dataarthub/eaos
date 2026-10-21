import * as pulumi from '@pulumi/pulumi'
import * as oci from '@pulumi/oci'
import type { OciResourceCustomization } from './index'

/**
 * One uniquely keyed TCP listener with its backend port, health check and optional resource overrides.
 * @see {@link createOciNetworkLoadBalancer} for the canonical usage example and runtime requirements.
 */
export interface OciNlbListenerConfig {
      /**
   * Stable unique lowercase listener key used for child resource names.
   */
  key: string
  
    /**
   * Unique integer listener port from 1 to 65535.
   */
  port: number
  
    /**
   * Optional backend port; defaults to the listener port.
   */
  backendPort?: number
  
    /**
   * Optional native health-check configuration; defaults to TCP on the backend port.
   */
  healthChecker?: oci.networkloadbalancer.BackendSetArgs['healthChecker']
  
    /**
   * Per-child shallow native overrides; review replaced nested arguments and resource options.
   */
  resources?: {
    /** Optional logical name, shallow native arguments, and resource options overriding this listener's backend set and health-check defaults. */
    backendSet?: OciResourceCustomization<oci.networkloadbalancer.BackendSetArgs>
    /** Optional logical name, shallow native arguments, and resource options overriding the listener target/backend-port resource. */
    backend?: OciResourceCustomization<oci.networkloadbalancer.BackendArgs>
    /** Optional logical name, shallow native arguments, and resource options overriding the TCP listener resource. */
    listener?: OciResourceCustomization<oci.networkloadbalancer.ListenerArgs>
  }
}
/**
 * Explicit subnet/target and optional listener/native customization for TCP NLB forwarding.
 * @see {@link createOciNetworkLoadBalancer} for the canonical usage example and runtime requirements.
 */
export interface OciNetworkLoadBalancerArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Explicit subnet ID/Input selected by the host.
   */
  subnetId: pulumi.Input<string>
      /**
   * Compute/private-IP resource target; one backend is registered per listener.
   */
  targetId: pulumi.Input<string>
      /**
   * Optional nonempty unique listener selections; defaults to TCP 80 and 443.
   */
  listeners?: readonly OciNlbListenerConfig[]
  
    /**
   * Optional native NLB logical name, shallow arguments and resource option overrides.
   */
  loadBalancer?: OciResourceCustomization<oci.networkloadbalancer.NetworkLoadBalancerArgs>
}
/**
 * Native resources registered for one load-balancer listener key.
 * @see {@link createOciNetworkLoadBalancer} for the canonical usage example and runtime requirements.
 */
export interface OciNlbListenerResources {
  
    /**
   * Native backend-set resource registered for this listener, with its configured health checker and routing policy.
   */
  backendSet: oci.networkloadbalancer.BackendSet
  
    /**
   * Native backend resource binding the selected target and backend port.
   */
  backend: oci.networkloadbalancer.Backend
  
    /**
   * Native TCP listener resource forwarding its port to this backend set.
   */
  listener: oci.networkloadbalancer.Listener
}

/**
 * Declare a TCP OCI network load balancer and one backend per uniquely named listener.
 * @param name - Default resource prefix.
 * @param args - Compartment, subnet, target ID and optional listener/resource overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The load balancer and listener resources keyed by listener key.
 * @throws Empty/duplicate/invalid listener keys or duplicate/out-of-range ports fail before resource registration; provider errors propagate.
 * @remarks Defaults to public TCP 80/443 forwarding and TCP backend health checks. TLS termination, client ingress policy and application authorization remain host-owned; native overrides are shallow. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciNetworkLoadBalancer } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciNetworkLoadBalancer>[1], options?: Parameters<typeof createOciNetworkLoadBalancer>[2]) { return createOciNetworkLoadBalancer('example', args, options) }
 */
export function createOciNetworkLoadBalancer(name: string, args: OciNetworkLoadBalancerArgs, options?: pulumi.CustomResourceOptions) {
  const configs = args.listeners ?? [{ key: 'http', port: 80 }, { key: 'https', port: 443 }]
  const keys = new Set<string>(), ports = new Set<number>()
  if (!configs.length) throw new Error('OCI NLB: at least one listener is required')
  // Validate the simple contract before registering any resource. Native overrides
  // deliberately remain the host's responsibility, as with the network factory.
  for (const config of configs) {
    if (!/^[a-z][a-z0-9-]*$/.test(config.key) || keys.has(config.key)) throw new Error('OCI NLB: listener keys must be unique lowercase labels')
    for (const port of [config.port, config.backendPort ?? config.port]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('OCI NLB: ports must be integers between 1 and 65535')
    }
    if (ports.has(config.port)) throw new Error('OCI NLB: listener ports must be unique')
    keys.add(config.key); ports.add(config.port)
  }
  const opts = (local?: pulumi.CustomResourceOptions) => ({ ...options, ...local })
  const lb = args.loadBalancer
  const loadBalancer = new oci.networkloadbalancer.NetworkLoadBalancer(lb?.name ?? name, {
    compartmentId: args.compartmentId, subnetId: args.subnetId, displayName: lb?.name ?? name,
    isPrivate: false, isPreserveSourceDestination: false, ...lb?.args,
  }, opts(lb?.options))
  const listeners: Record<string, OciNlbListenerResources> = Object.create(null)
  for (const config of configs) {
    const r = config.resources ?? {}, prefix = `${name}-${config.key}`
    const backendPort = config.backendPort ?? config.port
    const backendSet = new oci.networkloadbalancer.BackendSet(r.backendSet?.name ?? `${prefix}-backend-set`, {
      networkLoadBalancerId: loadBalancer.id, name: r.backendSet?.name ?? `${prefix}-backend-set`,
      policy: 'FIVE_TUPLE', isPreserveSource: false,
      healthChecker: config.healthChecker ?? { protocol: 'TCP', port: backendPort }, ...r.backendSet?.args,
    }, opts(r.backendSet?.options))
    const backend = new oci.networkloadbalancer.Backend(r.backend?.name ?? `${prefix}-backend`, {
      networkLoadBalancerId: loadBalancer.id, backendSetName: backendSet.name,
      targetId: args.targetId, port: backendPort, ...r.backend?.args,
    }, opts(r.backend?.options))
    const listener = new oci.networkloadbalancer.Listener(r.listener?.name ?? `${prefix}-listener`, {
      networkLoadBalancerId: loadBalancer.id, name: r.listener?.name ?? `${prefix}-listener`,
      defaultBackendSetName: backendSet.name, port: config.port, protocol: 'TCP', ...r.listener?.args,
    }, opts(r.listener?.options))
    listeners[config.key] = { backendSet, backend, listener }
  }
  return { loadBalancer, listeners }
}

/**
 * Bastion subnet and explicit client CIDR allowlist with optional native overrides.
 * @see {@link createOciBastion} for the canonical usage example and runtime requirements.
 */
export interface OciBastionArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
  /**
   * Host-selected private target subnet ID for the Bastion service.
   */
  targetSubnetId: pulumi.Input<string>
      /**
   * Explicit nonempty source CIDR allowlist for Bastion clients; no public default is provided.
   */
  clientCidrBlockAllowLists: NonNullable<oci.bastion.BastionArgs['clientCidrBlockAllowLists']>
  
    /**
   * Optional Bastion session TTL in seconds; defaults to 10800.
   */
  maxSessionTtlInSeconds?: pulumi.Input<number>
      /**
   * Shallow native Bastion arguments applied last, replacing nested defaults.
   */
  bastion?: Partial<oci.bastion.BastionArgs>
}
/**
 * Declare the OCI Bastion service with an explicit nonempty client CIDR allowlist.
 * @param name - Exact Pulumi logical name.
 * @param args - Compartment, target subnet, client allowlist and optional TTL/native overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The native Bastion resource.
 * @throws Missing or empty immediate allowlists fail; provider validation/errors propagate.
 * @remarks Default session TTL is 10800 seconds. Does not create sessions, IAM policies or SSH tunnels. Deferred Output allowlists are validated by the provider. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciBastion } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciBastion>[1], options?: Parameters<typeof createOciBastion>[2]) { return createOciBastion('example', args, options) }
 */
export function createOciBastion(name: string, args: OciBastionArgs, options?: pulumi.CustomResourceOptions) {
  if (args.clientCidrBlockAllowLists == null || (Array.isArray(args.clientCidrBlockAllowLists) && args.clientCidrBlockAllowLists.length === 0)) {
    throw new Error('OCI Bastion: explicitly provide a non-empty client CIDR allowlist')
  }
  return new oci.bastion.Bastion(name, {
    bastionType: 'STANDARD', name, compartmentId: args.compartmentId, targetSubnetId: args.targetSubnetId,
    clientCidrBlockAllowLists: args.clientCidrBlockAllowLists, maxSessionTtlInSeconds: args.maxSessionTtlInSeconds ?? 10800,
    ...args.bastion,
  }, options)
}

/**
 * Port and client-CIDR combinations to render as backend TCP ingress rules.
 * @see {@link createOciNlbIngressRules} for the canonical usage example and runtime requirements.
 */
export interface OciNlbIngressRulesOptions {
      /**
   * Target TCP ports; defaults to 80 and 443. This rendering helper does not validate them.
   */
  ports?: number[]
      /**
   * Client source CIDRs; defaults to 0.0.0.0/0. Review actual load-balancer source handling before adopting rules.
   */
  allowedCidrs?: string[]
  
    /**
   * Rule label prefix; defaults to NLB backend.
   */
  descriptionPrefix?: string
}

/**
 * Build backend TCP ingress rules for the selected NLB ports and client source CIDRs.
 * @param options - ports defaults to 80/443, allowedCidrs defaults to world IPv4, and descriptionPrefix labels the rules.
 * @returns One rule per selected port/CIDR pair.
 * @remarks This helper does not validate port/CIDR values or reconcile NLB source-preservation settings. Review those against the actual forwarding configuration; no security list is changed by rendering.
 * @example
 * import { createOciNlbIngressRules } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * const rules = createOciNlbIngressRules({ ports: [443], allowedCidrs: ['192.0.2.0/24'] })
 */
export function createOciNlbIngressRules(options: OciNlbIngressRulesOptions = {}): NonNullable<oci.core.SecurityListArgs['ingressSecurityRules']> {
  const ports = options.ports ?? [80, 443]
  const cidrs = options.allowedCidrs ?? ['0.0.0.0/0']
  const prefix = options.descriptionPrefix ?? 'NLB backend'

  return ports.flatMap(port =>
    cidrs.map(cidr => ({
      description: `Allow port ${port} from ${prefix} (Client IP preserved)`,
      protocol: '6',
      source: cidr,
      sourceType: 'CIDR_BLOCK',
      tcpOptions: { max: port, min: port },
    }))
  )
}
