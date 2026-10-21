import * as pulumi from '@pulumi/pulumi'
import * as oci from '@pulumi/oci'

/**
 * Either the explicit new free-oltp database profile or complete native arguments with defaults disabled.
 * @see {@link createOciAutonomousDatabase} for the canonical usage example and runtime requirements.
 */
export type OciAutonomousDatabaseArgs = {
      /**
   * Omitted or free-oltp selects the new-database defaults; protection defaults on but host resource options can override it.
   */
  defaults?: 'free-oltp'
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Database name selected by the trusted host.
   */
  dbName: pulumi.Input<string>
      /**
   * Required explicit provider-supported Oracle database version for the new-database profile.
   */
  dbVersion: pulumi.Input<string>
  
    /**
   * Sensitive administrator password Input; the factory wraps it as a Pulumi secret.
   */
  adminPassword: pulumi.Input<string>
      /**
   * Explicit nonempty endpoint ACL of IP/CIDR or supported VCN references; no world-open default is inferred.
   */
  whitelistedIps: NonNullable<oci.database.AutonomousDatabaseArgs['whitelistedIps']>
      /**
   * Native OCI Autonomous Database arguments/overrides; defaults=none requires the complete native shape.
   */
  database?: Partial<oci.database.AutonomousDatabaseArgs>
} | {
      /**
   * Select none to require complete native database arguments and skip the free-oltp defaults and default resource protection.
   */
  defaults: 'none'
  
    /**
   * Native OCI Autonomous Database arguments/overrides; defaults=none requires the complete native shape.
   */
  database: oci.database.AutonomousDatabaseArgs
}

/**
 * Declare an OCI Autonomous Database with an explicit default profile or unchanged native arguments.
 * @param name - Exact Pulumi logical name.
 * @param args - Either explicit free-oltp settings including nonempty endpoint ACL, or defaults=none with full native arguments.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The native AutonomousDatabase resource.
 * @throws Unknown profiles or absent required version/password/ACL fail immediately; provider errors propagate.
 * @remarks New free-oltp declarations default to protection, server-auth TLS and disabled autoscaling. Password values are secret Outputs. No DDL, wallets, IAM configuration or implicit adoption; provider inputs/overrides must be reviewed by the host. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciAutonomousDatabase } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciAutonomousDatabase>[1], options?: Parameters<typeof createOciAutonomousDatabase>[2]) { return createOciAutonomousDatabase('example', args, options) }
 */
export function createOciAutonomousDatabase(name: string, args: OciAutonomousDatabaseArgs, options?: pulumi.CustomResourceOptions) {
  let database: oci.database.AutonomousDatabaseArgs
  if (args.defaults === 'none') {
    database = { ...args.database }
  } else {
    if (args.defaults !== undefined && args.defaults !== 'free-oltp') throw new Error('OCI ADB: unknown defaults profile')
    if (args.adminPassword == null) throw new Error('OCI ADB: adminPassword is required for the new database profile')
    if (args.dbVersion == null) throw new Error('OCI ADB: explicitly select dbVersion')
    if (args.whitelistedIps == null || (Array.isArray(args.whitelistedIps) && !args.whitelistedIps.length)) {
      throw new Error('OCI ADB: explicitly provide a non-empty endpoint ACL')
    }
    database = {
      compartmentId: args.compartmentId, dbName: args.dbName, dbVersion: args.dbVersion, displayName: args.dbName,
      adminPassword: args.adminPassword, whitelistedIps: args.whitelistedIps,
      dbWorkload: 'OLTP', isFreeTier: true, computeModel: 'ECPU', computeCount: 1,
      dataStorageSizeInTbs: 1, licenseModel: 'LICENSE_INCLUDED',
      isAutoScalingEnabled: false, isAutoScalingForStorageEnabled: false,
      isMtlsConnectionRequired: false, ...args.database,
    }
  }
  // Also protect a native override. Never unwrap secrets into strings or logs.
  if (database.adminPassword !== undefined) database.adminPassword = pulumi.secret(database.adminPassword)
  return new oci.database.AutonomousDatabase(name, database,
    args.defaults === 'none' ? options : { protect: true, ...options })
}

/**
 * Read an external Autonomous Database resource without importing it into managed state.
 * @param name - Pulumi logical lookup name.
 * @param id - Existing database resource ID supplied by the host; may be an Output.
 * @param options - Optional resource options excluding import.
 * @returns The referenced native AutonomousDatabase resource.
 * @throws Provider lookup errors propagate.
 * @remarks Requires Pulumi/OCI provider configuration. This lookup is not resource adoption, database migration or wallet creation.
 * @example
 * import { referenceOciAutonomousDatabase } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function referenceHost(id: Parameters<typeof referenceOciAutonomousDatabase>[1]) { return referenceOciAutonomousDatabase('existing-db', id) }
 */
export function referenceOciAutonomousDatabase(name: string, id: pulumi.Input<string>, options?: Omit<pulumi.CustomResourceOptions, 'import'>) {
  return oci.database.AutonomousDatabase.get(name, id, undefined, options)
}

/**
 * Exact provider connection-profile filters; unspecified filters use the documented default TCPS profile.
 * @see {@link selectAdbConnectionProfile} for the canonical usage example and runtime requirements.
 */
export interface OciAdbConnectionSelection {
  
    /**
   * Exact provider workload group; selection defaults to LOW.
   */
  consumerGroup?: 'LOW' | 'MEDIUM' | 'HIGH' | 'TP' | 'TPURGENT'
  
    /**
   * Exact provider TLS authentication mode; selection defaults to SERVER.
   */
  tlsAuthentication?: 'SERVER' | 'MUTUAL'
  
    /**
   * Exact provider hostname representation; selection defaults to FQDN.
   */
  hostFormat?: 'FQDN' | 'IP'
  
    /**
   * Optional exact DIRECT/REDIRECT filter; omission leaves both eligible.
   */
  sessionMode?: 'DIRECT' | 'REDIRECT'
  
    /**
   * Provider DSN syntax; selection defaults to LONG.
   */
  syntaxFormat?: 'LONG' | 'EZCONNECT' | 'EZCONNECTPLUS'
  
    /**
   * Optional exact regional-profile flag; omitted value does not filter it.
   */
  isRegional?: boolean
  
    /**
   * Optional exact display-name filter; omission does not filter profile display names.
   */
  displayName?: string
}
/**
 * Provider-supplied ADB connection profile fields used for deterministic DSN selection.
 * @see {@link selectAdbConnectionProfile} for the canonical usage example and runtime requirements.
 */
export interface AdbConnectionProfile {
  
    /**
   * Provider workload-group label compared against the selected consumerGroup filter.
   */
  consumerGroup: string
  
    /**
   * Provider TLS-authentication label compared against the selected tlsAuthentication filter.
   */
  tlsAuthentication: string
  
    /**
   * Provider connection protocol; DSN selection requires TCPS.
   */
  protocol: string
  
    /**
   * Provider hostname representation compared against the selected hostFormat filter.
   */
  hostFormat: string
  
    /**
   * Provider DSN syntax label compared against the selected syntaxFormat filter.
   */
  syntaxFormat: string
  
    /**
   * Optional provider DIRECT/REDIRECT session mode; checked only when selection.sessionMode is supplied.
   */
  sessionMode?: string
  
    /**
   * Optional provider regional-profile flag; checked only when selection.isRegional is supplied.
   */
  isRegional?: boolean
  
    /**
   * Optional provider display name; compared exactly only when selection.displayName is supplied.
   */
  displayName?: string
  
    /**
   * Provider-supplied connection string; selection requires exactly one nonblank match and never rewrites it.
   */
  value: string
}
/**
 * Select exactly one nonempty provider TCPS connection profile without modifying its DSN.
 * @param groups - Provider connection-string groups and profiles.
 * @param selection - Filters; defaults to LOW, SERVER, FQDN and LONG, with TCPS required; optional session/region/display-name filters narrow selection.
 * @returns The exact matching provider DSN string.
 * @throws When no profile or multiple profiles match, or the selected value is blank.
 * @remarks Diagnostics omit DSN contents. Selection does not validate live reachability, issue credentials or rewrite TLS options.
 * @example
 * import { selectAdbConnectionProfile } from '@alneas/eaos-cli/presets/oci-adb/infra/database'
 * export function connection(groups: Parameters<typeof selectAdbConnectionProfile>[0]) { return selectAdbConnectionProfile(groups) }
 */
export function selectAdbConnectionProfile(groups: readonly { 
/**
 * Optional provider connection profile list; an absent list contributes no candidates to exact TCPS selection.
 */
profiles?: readonly AdbConnectionProfile[] }[], selection: OciAdbConnectionSelection = {}): string {
  const filters = {
    consumerGroup: selection.consumerGroup ?? 'LOW', tlsAuthentication: selection.tlsAuthentication ?? 'SERVER',
    hostFormat: selection.hostFormat ?? 'FQDN', syntaxFormat: selection.syntaxFormat ?? 'LONG', protocol: 'TCPS',
    ...(selection.sessionMode !== undefined ? { sessionMode: selection.sessionMode } : {}),
    ...(selection.isRegional !== undefined ? { isRegional: selection.isRegional } : {}),
    ...(selection.displayName !== undefined ? { displayName: selection.displayName } : {}),
  }
  const matches = groups.flatMap(group => group.profiles ?? []).filter(profile =>
    Object.entries(filters).every(([key, value]) => profile[key as keyof AdbConnectionProfile] === value))
  if (matches.length !== 1 || !matches[0].value?.trim()) {
    // Never include DSNs or credential-bearing caller values in diagnostics.
    throw new Error('OCI ADB: connection profile must match exactly one non-empty TCPS connection string')
  }
  return matches[0].value
}

/**
 * Resolve the selected provider connection profile from an Autonomous Database Output.
 * @param database - Resource reference exposing provider-supplied connectionStrings.
 * @param selection - Copied filter settings; defaults are those of selectAdbConnectionProfile.
 * @returns A Pulumi Output resolving to the unchanged matching DSN.
 * @throws Provider Output failures and unmatched/ambiguous profiles reject during resolution.
 * @remarks Does not mark its return secret itself; hosts must wrap sensitive connection values when exporting or storing them.
 * @example
 * import { selectOciAdbConnectionString } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function connection(database: Parameters<typeof selectOciAdbConnectionString>[0]) { return selectOciAdbConnectionString(database) }
 */
export function selectOciAdbConnectionString(database: Pick<oci.database.AutonomousDatabase, 'connectionStrings'>, selection: OciAdbConnectionSelection = {}): pulumi.Output<string> {
  const selected = { ...selection }
  return database.connectionStrings.apply(groups => selectAdbConnectionProfile(groups, selected))
}
