export { initializePreset, renderOciAdbTemplate } from './template'
import * as pulumi from '@pulumi/pulumi'
import * as oci from '@pulumi/oci'
import { createOciPrivateNetwork, createOciCompute, createOciAutonomousDatabase, createOciVault, createOciVaultKey, selectOciAdbConnectionString, lookupOciAllServicesNetwork } from './infra'

/**
 * Explicit host inputs for declaring the OCI edge/worker, database and storage preset.
 * @see {@link createOciAdbPreset} for the canonical usage example and runtime requirements.
 */
export interface OciAdbPresetArgs {
  
    /**
   * Host-selected OCI compartment for preset resources.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Reviewed availability domain for edge/worker Compute.
   */
  availabilityDomain: pulumi.Input<string>
      /**
   * Reviewed image ID compatible with the edge host architecture.
   */
  edgeImageId: pulumi.Input<string>
  
    /**
   * Reviewed image ID compatible with the worker host architecture.
   */
  workerImageId: pulumi.Input<string>
  
    /**
   * Host-authorized SSH public keys for newly declared instances.
   */
  sshAuthorizedKeys: pulumi.Input<string>
      /**
   * Explicit restricted IPv4 client CIDR; /0 is rejected.
   */
  sshCidr: string
  
    /**
   * Explicit database name selected by the host.
   */
  dbName: pulumi.Input<string>
  
    /**
   * Supported database version selected explicitly by the host.
   */
  dbVersion: pulumi.Input<string>
  
    /**
   * Sensitive database administrator password Input; preserve Pulumi secrecy.
   */
  adminPassword: pulumi.Input<string>
  
    /**
   * OCI Object Storage namespace selected by the host.
   */
  objectStorageNamespace: pulumi.Input<string>
  
    /**
   * Optional worker shape; defaults to VM.Standard.A1.Flex.
   */
  workerShape?: pulumi.Input<string>
  
    /**
   * Optional worker resources; defaults to 2 OCPUs and 12 GiB memory.
   */
  workerShapeConfig?: oci.core.InstanceArgs['shapeConfig']
}
/**
 * Declare the OCI edge/worker network, ADB, private object storage and KMS resources for a trusted host stack.
 * @param name - Preset resource prefix; must match the lowercase naming grammar.
 * @param args - Explicit OCI compartment, reviewed images, SSH CIDR, database version/password and object namespace.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The network, edge/worker resources, database, Vault/key, bucket and binding Outputs.
 * @throws Invalid prefix or unrestricted/invalid SSH CIDR fails immediately; provider/resource registration and apply errors propagate.
 * @remarks Registers real Pulumi resources when invoked. Requires @pulumi/pulumi and @pulumi/oci; state, credentials, IAM, DNS and adoption remain host-owned. No DDL or tenant activation is performed. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciAdbPreset } from '@alneas/eaos-cli/presets/oci-adb'
 * export function defineHostResource(args: Parameters<typeof createOciAdbPreset>[1], options?: Parameters<typeof createOciAdbPreset>[2]) { return createOciAdbPreset('example', args, options) }
 */
export function createOciAdbPreset(name: string, args: OciAdbPresetArgs, options?: pulumi.CustomResourceOptions) {
  if (!/^[a-z][a-z0-9-]{0,48}$/.test(name)) throw new Error('OCI preset: invalid resource prefix')
  const [address, prefix] = args.sshCidr.split('/')
  const octets = address?.split('.') ?? []
  if (octets.length !== 4 || octets.some(n => !/^\d{1,3}$/.test(n) || Number(n) > 255) || !/^\d{1,2}$/.test(prefix ?? '') || Number(prefix) < 1 || Number(prefix) > 32) throw new Error('OCI preset: provide a restricted IPv4 SSH CIDR')
  const network = createOciPrivateNetwork(name, {
    compartmentId: args.compartmentId,
    serviceNetwork: lookupOciAllServicesNetwork(options),
    publicIngress: [
      ...[80, 443].map(port => ({ protocol: '6', source: '0.0.0.0/0', sourceType: 'CIDR_BLOCK', tcpOptions: { min: port, max: port } })),
      { protocol: '6', source: args.sshCidr, sourceType: 'CIDR_BLOCK', tcpOptions: { min: 22, max: 22 } },
      // Private host calls: never expose the Kratos admin endpoint on the Internet.
      ...[4433, 4434].map(port => ({ protocol: '6', source: '10.0.1.0/24', sourceType: 'CIDR_BLOCK', tcpOptions: { min: port, max: port } })),
    ],
    privateIngress: [
      ...[22, 3000].map(port => ({ protocol: '6', source: '10.0.0.0/24', sourceType: 'CIDR_BLOCK', tcpOptions: { min: port, max: port } })),
    ],
  }, options)
  const common = { compartmentId: args.compartmentId, availabilityDomain: args.availabilityDomain, sshAuthorizedKeys: args.sshAuthorizedKeys }
  const edge = createOciCompute(`${name}-edge`, { ...common, subnetId: network.publicSubnet.id, imageId: args.edgeImageId,
    instance: { createVnicDetails: { subnetId: network.publicSubnet.id, assignPublicIp: 'true' } },
  }, options)
  const worker = createOciCompute(`${name}-worker`, { ...common, subnetId: network.privateSubnet.id, imageId: args.workerImageId,
    shape: args.workerShape ?? 'VM.Standard.A1.Flex', shapeConfig: args.workerShapeConfig ?? { ocpus: 2, memoryInGbs: 12 },
  }, options)
  const database = createOciAutonomousDatabase(`${name}-db`, {
    compartmentId: args.compartmentId, dbName: args.dbName, dbVersion: args.dbVersion,
    adminPassword: args.adminPassword, whitelistedIps: [network.vcn.id],
  }, options)
  const vault = createOciVault(`${name}-vault`, { compartmentId: args.compartmentId }, { ...options, protect: true })
  const key = createOciVaultKey(`${name}-key`, { compartmentId: args.compartmentId, managementEndpoint: vault.managementEndpoint }, { ...options, protect: true })
  const bucket = new oci.objectstorage.Bucket(`${name}-objects`, {
    compartmentId: args.compartmentId, namespace: args.objectStorageNamespace, name: `${name}-objects`,
    accessType: 'NoPublicAccess', versioning: 'Enabled', storageTier: 'Standard',
  }, { ...options, protect: true })
  return { network, edge, worker, database, vault, key, bucket,
    /** Binding metadata only. Passwords, wallets and Vault payloads are never exported. */
    bindings: { edgeHost: edge.publicIp, edgePrivateAddress: edge.privateIp, workerPrivateAddress: worker.privateIp,
      databaseId: database.id, databaseConnection: pulumi.secret(selectOciAdbConnectionString(database)),
      vaultId: vault.id, keyId: key.id, bucket: bucket.name, namespace: bucket.namespace },
  }
}
