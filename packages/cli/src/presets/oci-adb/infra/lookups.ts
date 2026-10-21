import * as pulumi from '@pulumi/pulumi'
import * as oci from '@pulumi/oci'

/**
 * Matching regional Oracle service-network resource identity and route CIDR label.
 * @see {@link lookupOciAllServicesNetwork} for the canonical usage example and runtime requirements.
 */
export interface OciServiceNetwork { 
    /**
   * Provider identity of the selected regional All Services network.
   */
  id: string; 
    /**
   * Regional service-network route CIDR label returned with that same provider identity.
   */
  cidrBlock: string }
/**
 * Available image query with a mandatory exact-name or latest selection decision.
 * @see {@link lookupOciImage} for the canonical usage example and runtime requirements.
 */
export type OciImageLookupArgs = {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Required host-reviewed instance shape used to filter compatible images.
   */
  shape: pulumi.Input<string>
  
    /**
   * Host-reviewed OCI image operating-system name.
   */
  operatingSystem: pulumi.Input<string>
  
    /**
   * Host-reviewed OCI image operating-system release.
   */
  operatingSystemVersion: pulumi.Input<string>
} & ({
    /** Explicit selection policy: exact requires one matching displayName; latest chooses newest creation time with ascending ID as a deterministic tie-breaker. */
selection: 'exact';
    /** Exact provider display name required for exact selection; the latest variant forbids this property. */
displayName: pulumi.Input<string> } | {
    /** Explicit selection policy: exact requires one matching displayName; latest chooses newest creation time with ascending ID as a deterministic tie-breaker. */
selection: 'latest';
    /** Exact provider display name required for exact selection; the latest variant forbids this property. */
displayName?: never })

interface ImageCandidate { id: string; displayName: string; timeCreated: string }
/**
 * Select one exact display-name image or deterministically choose the newest compatible image.
 * @param images - Candidate IDs, display names and creation timestamps from the provider.
 * @param selection - exact requires exactly one named candidate; latest sorts descending by parsed creation time and then ID.
 * @param displayName - Required nonempty name for exact selection; ignored for latest selection.
 * @returns Selected nonempty image ID.
 * @throws If selection is invalid, candidates are absent/ambiguous, latest timestamps are invalid or the selected ID is empty.
 * @example
 * import { selectImage } from '@alneas/eaos-cli/presets/oci-adb/infra/lookups'
 * const imageId = selectImage([{ id: 'example-image', displayName: 'reviewed', timeCreated: '2026-01-01T00:00:00Z' }], 'exact', 'reviewed')
 */
export function selectImage(images: readonly ImageCandidate[], selection: 'exact' | 'latest', displayName?: string): string {
  if (selection !== 'exact' && selection !== 'latest') throw new Error('OCI image: explicit exact or latest selection is required')
  const candidates = selection === 'exact' ? images.filter(image => image.displayName === displayName) : [...images]
  if (candidates.length === 0) throw new Error('OCI image: no compatible images found')
  if (selection === 'exact') {
    if (!displayName || candidates.length !== 1) throw new Error('OCI image: exact displayName must resolve to one image')
  } else {
    if (candidates.some(image => !Number.isFinite(Date.parse(image.timeCreated)))) throw new Error('OCI image: invalid creation time')
    candidates.sort((a, b) => Date.parse(b.timeCreated) - Date.parse(a.timeCreated) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  if (!candidates[0].id) throw new Error('OCI image: missing image ID')
  return candidates[0].id
}
/**
 * Select exactly one regional All Services Oracle network from provider results.
 * @param services - Provider service records with ID, display name and CIDR label.
 * @returns The matching network ID and regional CIDR label.
 * @throws When there is not exactly one matching network with a nonempty ID and CIDR label.
 * @example
 * import { selectServiceNetwork } from '@alneas/eaos-cli/presets/oci-adb/infra/lookups'
 * const network = selectServiceNetwork([{ id: 'example-service', name: 'All Example Services In Oracle Services Network', cidrBlock: 'example-services' }])
 */
export function selectServiceNetwork(services: readonly { 
/**
 * Provider service network identity returned when this is the unique matching regional All Services entry.
 */
id: string; 
/**
 * Provider display name matched against the regional All Services In Oracle Services Network pattern.
 */
name: string; 
/**
 * Provider regional service-network CIDR label retained exactly in the selected result.
 */
cidrBlock: string }[]): OciServiceNetwork {
  const matches = services.filter(service => /^All .+ Services In Oracle Services Network$/i.test(service.name))
  if (matches.length !== 1 || !matches[0].id || !matches[0].cidrBlock) throw new Error('OCI service: expected exactly one All Services network')
  return { id: matches[0].id, cidrBlock: matches[0].cidrBlock }
}

/**
 * Look up available OCI images and apply an explicit exact-name or latest selection policy.
 * @param args - Compartment, shape, OS/version and explicit exact/latest selection; exact additionally requires displayName.
 * @param options - Optional host-selected Pulumi invoke provider/parent settings.
 * @returns A Pulumi Output resolving to the selected image ID.
 * @throws Invalid immediate selection fails synchronously; provider query, ambiguity and Output selection errors reject during resolution.
 * @remarks Makes a real provider lookup when used in a host stack; latest can select a newer image on a later update. Pin reviewed IDs where replacement control is required.
 * @example
 * import { lookupOciImage } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function reviewedImage(args: Parameters<typeof lookupOciImage>[0]) { return lookupOciImage(args) }
 */
export function lookupOciImage(args: OciImageLookupArgs, options?: pulumi.InvokeOutputOptions): pulumi.Output<string> {
  if (args.selection !== 'exact' && args.selection !== 'latest') throw new Error('OCI image: explicit exact or latest selection is required')
  if (args.selection === 'exact' && args.displayName === undefined) throw new Error('OCI image: exact selection requires displayName')
  const result = oci.core.getImagesOutput({
    compartmentId: args.compartmentId, shape: args.shape, operatingSystem: args.operatingSystem,
    operatingSystemVersion: args.operatingSystemVersion, displayName: args.selection === 'exact' ? args.displayName : undefined,
    state: 'AVAILABLE', sortBy: 'TIMECREATED', sortOrder: 'DESC',
  }, options)
  return pulumi.all([result, pulumi.output(args.displayName)]).apply(([images, displayName]) => selectImage(images.images, args.selection, displayName))
}
/**
 * Look up the regional All Services network and retain its matching route CIDR label.
 * @param options - Optional host-selected Pulumi invoke provider/parent settings.
 * @returns A Pulumi Output with the unique network ID and CIDR label.
 * @throws Provider query errors and absent/ambiguous results reject during Output resolution.
 * @remarks The host supplies provider region and credentials; no network resource or route is created by this lookup.
 * @example
 * import { lookupOciAllServicesNetwork } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function regionalServices(options: Parameters<typeof lookupOciAllServicesNetwork>[0]) { return lookupOciAllServicesNetwork(options) }
 */
export function lookupOciAllServicesNetwork(options?: pulumi.InvokeOutputOptions): pulumi.Output<OciServiceNetwork> {
  return oci.core.getServicesOutput({}, options).apply(result => selectServiceNetwork(result.services))
}
