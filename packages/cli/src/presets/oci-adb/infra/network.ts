import * as pulumi from '@pulumi/pulumi'
import * as oci from '@pulumi/oci'

/**
 * Compartment, CIDR ranges and explicit ingress for the simple public-network factory.
 * @see {@link createOciNetwork} for the canonical usage example and runtime requirements.
 */
export interface OciNetworkArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * VCN address range; defaults to 10.0.0.0/16.
   */
  cidrBlock?: pulumi.Input<string>
  
    /**
   * Optional simple public subnet range; defaults to 10.0.1.0/24.
   */
  subnetCidrBlock?: pulumi.Input<string>
  
    /**
   * Explicit ingress rules; the simple network has no inbound rules when omitted.
   */
  ingress?: oci.core.SecurityListArgs['ingressSecurityRules']
}
/**
 * Declare a public OCI VCN/subnet with internet egress and explicitly supplied ingress rules.
 * @param name - Resource prefix for the network child resources.
 * @param args - Compartment and optional VCN/subnet ranges and ingress rules.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The VCN, internet gateway, route table, security list and public subnet.
 * @throws Provider/resource registration errors propagate.
 * @remarks Defaults to VCN 10.0.0.0/16 and public subnet 10.0.1.0/24, allows all outbound traffic and no inbound rules unless supplied. Does not implement the separate two-subnet private-network preset. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciNetwork } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciNetwork>[1], options?: Parameters<typeof createOciNetwork>[2]) { return createOciNetwork('example', args, options) }
 */
export function createOciNetwork(name: string, args: OciNetworkArgs, options?: pulumi.CustomResourceOptions) {
  const vcn = new oci.core.Vcn(`${name}-vcn`, {
    compartmentId: args.compartmentId, cidrBlock: args.cidrBlock ?? '10.0.0.0/16',
  }, options)
  const gateway = new oci.core.InternetGateway(`${name}-ig`, {
    compartmentId: args.compartmentId, vcnId: vcn.id, enabled: true,
  }, options)
  const routes = new oci.core.RouteTable(`${name}-rt`, {
    compartmentId: args.compartmentId, vcnId: vcn.id,
    routeRules: [{ destination: '0.0.0.0/0', destinationType: 'CIDR_BLOCK', networkEntityId: gateway.id }],
  }, options)
  const securityList = new oci.core.SecurityList(`${name}-sl`, {
    compartmentId: args.compartmentId, vcnId: vcn.id,
    egressSecurityRules: [{ destination: '0.0.0.0/0', protocol: 'all' }],
    ingressSecurityRules: args.ingress ?? [],
  }, options)
  const subnet = new oci.core.Subnet(`${name}-public-subnet`, {
    compartmentId: args.compartmentId, vcnId: vcn.id,
    cidrBlock: args.subnetCidrBlock ?? '10.0.1.0/24',
    routeTableId: routes.id, securityListIds: [securityList.id],
  }, options)
  return { vcn, gateway, routes, securityList, subnet }
}

