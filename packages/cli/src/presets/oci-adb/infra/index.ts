import * as pulumi from '@pulumi/pulumi'
import * as oci from '@pulumi/oci'
export { createOciAutonomousDatabase, referenceOciAutonomousDatabase, selectOciAdbConnectionString } from './database'
export type { OciAutonomousDatabaseArgs, OciAdbConnectionSelection } from './database'
export { createOciNetworkLoadBalancer, createOciBastion, createOciNlbIngressRules } from './access'
export type { OciNetworkLoadBalancerArgs, OciNlbListenerConfig, OciNlbListenerResources, OciBastionArgs, OciNlbIngressRulesOptions } from './access'
export { createOciVault, createOciVaultKey, createOciAuthToken, createOciVaultSecret } from './vault'
export type { OciVaultArgs, OciVaultKeyArgs, OciAuthTokenArgs, OciVaultSecretArgs } from './vault'
export { lookupOciImage, lookupOciAllServicesNetwork } from './lookups'
export type { OciImageLookupArgs, OciServiceNetwork } from './lookups'
import type { OciServiceNetwork } from './lookups'

/**
 * Shallow native resource overrides applied after the preset defaults.
 * @typeParam T - Native provider argument shape whose selected top-level fields may be replaced by the host.
 * @see {@link createOciPrivateNetwork} for the canonical usage example and runtime requirements.
 */
export interface OciResourceCustomization<T> {
  
    /**
   * Optional replacement logical resource name; omission keeps the factory default.
   */
  name?: string
  
    /**
   * Shallow native argument overrides; nested objects and arrays replace the default values.
   */
  args?: Partial<T>
  
    /**
   * Optional native Pulumi resource options, merged after parent defaults.
   */
  options?: pulumi.CustomResourceOptions
}
/**
 * Per-resource native overrides for the two-subnet OCI network.
 * @see {@link createOciPrivateNetwork} for the canonical usage example and runtime requirements.
 */
export interface OciNetworkCustomizations {
  
    /**
   * Optional VCN logical name, shallow arguments and resource option overrides.
   */
  vcn?: OciResourceCustomization<oci.core.VcnArgs>
  
    /**
   * Optional DHCP resource logical name, shallow arguments and resource option overrides.
   */
  dhcpOptions?: OciResourceCustomization<oci.core.DhcpOptionsArgs>
  
    /**
   * Optional internet gateway logical name, shallow arguments and resource option overrides.
   */
  internetGateway?: OciResourceCustomization<oci.core.InternetGatewayArgs>
  
    /**
   * Optional NAT gateway logical name, shallow arguments and resource option overrides.
   */
  natGateway?: OciResourceCustomization<oci.core.NatGatewayArgs>
  
    /**
   * Optional service gateway logical name, shallow arguments and resource option overrides.
   */
  serviceGateway?: OciResourceCustomization<oci.core.ServiceGatewayArgs>
  
    /**
   * Optional public route-table overrides; nested route arrays are replaced, not merged.
   */
  publicRoutes?: OciResourceCustomization<oci.core.RouteTableArgs>
  
    /**
   * Optional private route-table overrides; nested route arrays are replaced, not merged.
   */
  privateRoutes?: OciResourceCustomization<oci.core.RouteTableArgs>
  
    /**
   * Optional public security-list overrides; replaced rules need independent review.
   */
  publicSecurityList?: OciResourceCustomization<oci.core.SecurityListArgs>
  
    /**
   * Optional private security-list overrides; replaced rules need independent review.
   */
  privateSecurityList?: OciResourceCustomization<oci.core.SecurityListArgs>
  
    /**
   * Optional public subnet logical name, shallow arguments and resource option overrides.
   */
  publicSubnet?: OciResourceCustomization<oci.core.SubnetArgs>
  
    /**
   * Optional private subnet logical name, shallow arguments and resource option overrides.
   */
  privateSubnet?: OciResourceCustomization<oci.core.SubnetArgs>
}
/**
 * Host network ranges, security rules and optional regional service-network routing.
 * @see {@link createOciPrivateNetwork} for the canonical usage example and runtime requirements.
 */
export interface OciPrivateNetworkArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
      /**
   * Optional separate compartment for network children; defaults to the VCN compartment.
   */
  resourceCompartmentId?: pulumi.Input<string>
  
    /**
   * VCN address range; defaults to 10.0.0.0/16 before native VCN overrides.
   */
  cidrBlock?: pulumi.Input<string>
  
    /**
   * Optional public subnet range; defaults to 10.0.0.0/24.
   */
  publicSubnetCidrBlock?: pulumi.Input<string>
  
    /**
   * Optional private subnet range; defaults to 10.0.1.0/24.
   */
  privateSubnetCidrBlock?: pulumi.Input<string>
  
    /**
   * Optional DNS label used by the VCN declaration.
   */
  vcnDnsLabel?: pulumi.Input<string>
  
    /**
   * Explicit ingress rules attached to the public subnet security list.
   */
  publicIngress?: oci.core.SecurityListArgs['ingressSecurityRules']
  
    /**
   * Explicit ingress rules attached to the private subnet security list.
   */
  privateIngress?: oci.core.SecurityListArgs['ingressSecurityRules']
      /**
   * Optional reviewed Oracle service-network ID/CIDR pair; omission means no implicit provider lookup or service route.
   */
  serviceNetwork?: pulumi.Input<OciServiceNetwork>
  
    /**
   * Per-child shallow native overrides; review replaced nested arguments and resource options.
   */
  resources?: OciNetworkCustomizations
}

/**
 * Build the private Kratos and worker API TCP ingress rules for the default EAOS layout.
 * @param source - Source CIDR/Input; defaults to the VCN range 10.0.0.0/16.
 * @param callers - Optional per-service source overrides for Kratos public and worker API traffic.
 * @returns Rules for TCP 4434, 4433 and 3000 using the supplied source scopes.
 * @remarks Pure rule construction; it does not attach security lists or validate whether caller-supplied CIDRs are private. Hosts must avoid exposing administrative ports publicly.
 * @example
 * import { defaultEoasPrivateIngressRules } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * const rules = defaultEoasPrivateIngressRules('10.0.0.0/16')
 */
export function defaultEoasPrivateIngressRules(source: pulumi.Input<string> = '10.0.0.0/16', callers: { 
/**
 * Optional CIDR/Input overriding the common source for TCP 4433 Kratos public API traffic; omitted uses source.
 */
kratosPublicSource?: pulumi.Input<string>; 
/**
 * Optional CIDR/Input overriding the common source for TCP 3000 worker API traffic; omitted uses source.
 */
workerApiSource?: pulumi.Input<string> } = {}): NonNullable<oci.core.SecurityListArgs['ingressSecurityRules']> {
  return [
    { description: 'Allow Kratos admin API from VCN workers', protocol: '6', source, sourceType: 'CIDR_BLOCK', tcpOptions: { min: 4434, max: 4434 } },
    { description: 'Allow Kratos public API from VCN workers', protocol: '6', source: callers.kratosPublicSource ?? source, sourceType: 'CIDR_BLOCK', tcpOptions: { min: 4433, max: 4433 } },
    { description: 'Allow Platform worker API from VCN ingress', protocol: '6', source: callers.workerApiSource ?? source, sourceType: 'CIDR_BLOCK', tcpOptions: { min: 3000, max: 3000 } },
  ]
}

/**
 * Declare a two-subnet OCI network with separate public and private egress/security configuration.
 * @param name - Resource prefix for the network and its child resources.
 * @param args - Compartment, address ranges, ingress rules, optional service network and per-resource shallow overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The VCN, subnets, gateways, routes and security resources.
 * @throws Provider/resource registration errors propagate.
 * @remarks No service-network lookup is implicit; omit it for NAT-only private egress. Overrides replace nested values, so the host must review routing and security effects. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciPrivateNetwork } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciPrivateNetwork>[1], options?: Parameters<typeof createOciPrivateNetwork>[2]) { return createOciPrivateNetwork('example', args, options) }
 */
export function createOciPrivateNetwork(name: string, args: OciPrivateNetworkArgs, options?: pulumi.CustomResourceOptions) {
  const r = args.resources || {}
  if (r.serviceGateway && !args.serviceNetwork) throw new Error('OCI network: serviceGateway customization requires serviceNetwork')
  const compartmentId = args.resourceCompartmentId ?? args.compartmentId
  const opts = (local?: pulumi.CustomResourceOptions) => ({ ...options, ...local })
  const vcn = new oci.core.Vcn(r.vcn?.name ?? `${name}-vcn`, {
    compartmentId: args.compartmentId, cidrBlock: args.cidrBlock ?? '10.0.0.0/16', dnsLabel: args.vcnDnsLabel ?? 'eaosvcn',
    ...r.vcn?.args,
  }, opts(r.vcn?.options))
  const base = { compartmentId, vcnId: vcn.id }
  const dhcpOptions = new oci.core.DhcpOptions(r.dhcpOptions?.name ?? `${name}-dhcp-options`, {
    ...base, options: [{ type: 'DomainNameServer', serverType: 'VcnLocalPlusInternet' }], ...r.dhcpOptions?.args,
  }, opts(r.dhcpOptions?.options))
  const internetGateway = new oci.core.InternetGateway(r.internetGateway?.name ?? `${name}-internet-gateway`, {
    ...base, ...r.internetGateway?.args,
  }, opts(r.internetGateway?.options))
  const natGateway = new oci.core.NatGateway(r.natGateway?.name ?? `${name}-nat-gateway`, {
    ...base, ...r.natGateway?.args,
  }, opts(r.natGateway?.options))
  const serviceNetwork = args.serviceNetwork === undefined ? undefined : pulumi.output(args.serviceNetwork)
  const serviceGateway = serviceNetwork ? new oci.core.ServiceGateway(r.serviceGateway?.name ?? `${name}-service-gateway`, {
    ...base, services: [{ serviceId: serviceNetwork.id }], ...r.serviceGateway?.args,
  }, opts(r.serviceGateway?.options)) : undefined
  const publicRoutes = new oci.core.RouteTable(r.publicRoutes?.name ?? `${name}-public-routes`, {
    ...base, routeRules: [{ destination: '0.0.0.0/0', destinationType: 'CIDR_BLOCK', networkEntityId: internetGateway.id, routeType: 'STATIC' }],
    ...r.publicRoutes?.args,
  }, opts(r.publicRoutes?.options))
  const privateRoutes = new oci.core.RouteTable(r.privateRoutes?.name ?? `${name}-private-routes`, {
    ...base, routeRules: [
      { destination: '0.0.0.0/0', destinationType: 'CIDR_BLOCK', networkEntityId: natGateway.id, routeType: 'STATIC' },
      ...(serviceGateway && serviceNetwork ? [{ destination: serviceNetwork.cidrBlock, destinationType: 'SERVICE_CIDR_BLOCK', networkEntityId: serviceGateway.id, routeType: 'STATIC' }] : []),
    ], ...r.privateRoutes?.args,
  }, opts(r.privateRoutes?.options))
  const publicSecurityList = new oci.core.SecurityList(r.publicSecurityList?.name ?? `${name}-public-security-list`, {
    ...base, ingressSecurityRules: args.publicIngress ?? [], egressSecurityRules: [{ destination: '0.0.0.0/0', protocol: 'all' }], ...r.publicSecurityList?.args,
  }, opts(r.publicSecurityList?.options))
  const privateSecurityList = new oci.core.SecurityList(r.privateSecurityList?.name ?? `${name}-private-security-list`, {
    ...base, ingressSecurityRules: args.privateIngress ?? defaultEoasPrivateIngressRules(args.cidrBlock ?? '10.0.0.0/16'), egressSecurityRules: [{ destination: '0.0.0.0/0', protocol: 'all' }], ...r.privateSecurityList?.args,
  }, opts(r.privateSecurityList?.options))
  const publicSubnet = new oci.core.Subnet(r.publicSubnet?.name ?? `${name}-public-subnet`, {
    ...base, cidrBlock: args.publicSubnetCidrBlock ?? '10.0.0.0/24', dnsLabel: 'public', dhcpOptionsId: dhcpOptions.id,
    routeTableId: publicRoutes.id, securityListIds: [publicSecurityList.id], ...r.publicSubnet?.args,
  }, opts(r.publicSubnet?.options))
  const privateSubnet = new oci.core.Subnet(r.privateSubnet?.name ?? `${name}-private-subnet`, {
    ...base, cidrBlock: args.privateSubnetCidrBlock ?? '10.0.1.0/24', dnsLabel: 'private', dhcpOptionsId: dhcpOptions.id,
    routeTableId: privateRoutes.id, securityListIds: [privateSecurityList.id], prohibitInternetIngress: true, prohibitPublicIpOnVnic: true,
    ...r.privateSubnet?.args,
  }, opts(r.privateSubnet?.options))
  return { vcn, dhcpOptions, internetGateway, natGateway, serviceGateway, publicRoutes, privateRoutes, publicSecurityList, privateSecurityList, publicSubnet, privateSubnet }
}

/**
 * Reviewed image, subnet and instance/bootstrap customization for one OCI host.
 * @see {@link createOciCompute} for the canonical usage example and runtime requirements.
 */
export interface OciComputeArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Reviewed OCI availability domain for the selected resource.
   */
  availabilityDomain: pulumi.Input<string>
  
    /**
   * Explicit subnet ID/Input selected by the host.
   */
  subnetId: pulumi.Input<string>
      /**
   * Explicit reviewed image ID; the factory does not perform a newest-image lookup.
   */
  imageId: pulumi.Input<string>
  
    /**
   * Optional host-selected OCI instance shape.
   */
  shape?: pulumi.Input<string>
  
    /**
   * Optional shape resource allocation; provider shape compatibility remains host-owned.
   */
  shapeConfig?: oci.core.InstanceArgs['shapeConfig']
  
    /**
   * SSH public keys admitted by the host; never a private key.
   */
  sshAuthorizedKeys?: pulumi.Input<string>
  
    /**
   * Boot volume size in GiB as an OCI string Input; defaults to 50.
   */
  bootVolumeSizeInGbs?: pulumi.Input<string>
      /**
   * Optional first-boot container runtime selection; generated Docker cloud-init is disabled by none.
   */
  bootstrap?: {
    /** Defaults to Docker cloud-init; none suppresses the generated Docker user_data, while explicit native metadata may still supply host bootstrap code. */
    containerRuntime?: 'docker' | 'none'
  }
      /**
   * Shallow native OCI Instance overrides applied after host defaults; nested metadata/source details follow the factory merge policy.
   */
  instance?: Partial<oci.core.InstanceArgs>
}
/**
 * Declare an OCI instance using an explicit image and host-controlled customization.
 * @param name - Exact Pulumi logical resource name.
 * @param args - Compartment, domain, subnet, image and optional shape/storage/bootstrap overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The native OCI Instance resource.
 * @throws Provider/resource registration errors propagate.
 * @remarks Defaults to a 50 GiB disposable boot volume and Docker cloud-init unless bootstrap.containerRuntime=none. Explicit instance metadata/user_data takes precedence; existing host adoption and replacement policy remain host-owned. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciCompute } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciCompute>[1], options?: Parameters<typeof createOciCompute>[2]) { return createOciCompute('example', args, options) }
 */
export function createOciCompute(name: string, args: OciComputeArgs, options?: pulumi.CustomResourceOptions) {
  const defaultSourceDetails = { sourceType: 'image', sourceId: args.imageId, bootVolumeSizeInGbs: args.bootVolumeSizeInGbs ?? '50', isPreserveBootVolumeEnabled: false }
  const sourceDetails = args.instance?.sourceDetails === undefined
    ? defaultSourceDetails
    : pulumi.output(args.instance.sourceDetails).apply(value => ({
      ...defaultSourceDetails,
      ...(value ?? {}),
      // A host may opt into preservation explicitly, but the framework default
      // is disposable infrastructure. Application images are redeployed by
      // the host's delivery system and durable data belongs outside the VM.
      isPreserveBootVolumeEnabled: value?.isPreserveBootVolumeEnabled ?? false,
    }))

  // OCI expects user_data to be base64-encoded. Keep this bootstrap small and
  // deterministic so it only changes when the framework's standard runtime
  // contract changes. `ignoreChanges` remains the consumer's adoption tool for
  // existing hosts that predate this default; replacements still receive it.
  const dockerUserData = Buffer.from(`#cloud-config
package_update: true
packages:
  - docker.io
runcmd:
  - [systemctl, enable, --now, docker]
  - [usermod, -aG, docker, ubuntu]
`).toString('base64')
  const { sourceDetails: _instanceSourceDetails, metadata: instanceMetadata, ...instanceOverrides } = args.instance ?? {}
  const defaultMetadata = {
    ...(args.sshAuthorizedKeys !== undefined ? { ssh_authorized_keys: args.sshAuthorizedKeys } : {}),
    ...(args.bootstrap?.containerRuntime === 'none' ? {} : { user_data: dockerUserData }),
  }
  // `metadata` accepts a Pulumi Input, so do not spread an Output as if it
  // were a plain object. Secret taint is preserved by the Output apply.
  const metadata = instanceMetadata === undefined
    ? defaultMetadata
    : pulumi.output(instanceMetadata).apply(value => ({ ...defaultMetadata, ...(value ?? {}) }))
  const hasMetadata = args.sshAuthorizedKeys !== undefined
    || args.bootstrap?.containerRuntime !== 'none'
    || instanceMetadata !== undefined
  return new oci.core.Instance(name, {
    compartmentId: args.compartmentId, availabilityDomain: args.availabilityDomain,
    shape: args.shape ?? 'VM.Standard.E2.1.Micro', shapeConfig: args.shapeConfig,
    createVnicDetails: { subnetId: args.subnetId, assignPublicIp: 'false' },
    sourceDetails,
    instanceOptions: { areLegacyImdsEndpointsDisabled: true },
    ...instanceOverrides,
    ...(hasMetadata ? { metadata } : {}),
  }, options)
}

export * from './network'
