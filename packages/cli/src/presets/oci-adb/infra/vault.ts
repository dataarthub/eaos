import * as pulumi from '@pulumi/pulumi'
import * as oci from '@pulumi/oci'

/**
 * KMS Vault compartment, display and type settings with shallow native overrides.
 * @see {@link createOciVault} for the canonical usage example and runtime requirements.
 */
export interface OciVaultArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Optional provider display name; defaults to the factory's logical resource name unless native vault overrides replace it.
   */
  displayName?: pulumi.Input<string>
  
    /**
   * Optional DEFAULT or VIRTUAL_PRIVATE Vault kind; defaults to DEFAULT.
   */
  vaultType?: pulumi.Input<'DEFAULT' | 'VIRTUAL_PRIVATE'>
      /**
   * Shallow native KMS Vault arguments applied last.
   */
  vault?: Partial<oci.kms.VaultArgs>
}

/**
 * Declare an OCI KMS Vault with optional native argument overrides.
 * @param name - Logical name and default display name.
 * @param args - Compartment and optional display name, vault type or shallow native overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The native KMS Vault resource.
 * @throws Provider/resource registration errors propagate.
 * @remarks Defaults to DEFAULT vault type. Credentials/state and protection/retention settings remain host-owned; the factory itself does not populate secrets. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciVault } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciVault>[1], options?: Parameters<typeof createOciVault>[2]) { return createOciVault('example', args, options) }
 */
export function createOciVault(name: string, args: OciVaultArgs, options?: pulumi.CustomResourceOptions) {
  return new oci.kms.Vault(name, {
    compartmentId: args.compartmentId,
    displayName: args.displayName ?? name,
    vaultType: args.vaultType ?? 'DEFAULT',
    ...args.vault,
  }, options)
}

/**
 * Vault management endpoint and encryption key settings with shallow native overrides.
 * @see {@link createOciVaultKey} for the canonical usage example and runtime requirements.
 */
export interface OciVaultKeyArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Vault management endpoint Input supplied by the selected provider resource.
   */
  managementEndpoint: pulumi.Input<string>
  
    /**
   * Optional provider display name; defaults to the factory's logical resource name unless native key overrides replace it.
   */
  displayName?: pulumi.Input<string>
  
    /**
   * Key algorithm; defaults to AES. Supply a provider-compatible explicit length when selecting another algorithm.
   */
  algorithm?: 'AES' | 'RSA' | 'ECDSA'
  
    /**
   * Key length in bytes; defaults to 32 for AES/ECDSA or 256 for RSA. Explicit native keyShape overrides take precedence.
   */
  length?: number
  
    /**
   * SOFTWARE by default, or explicitly selected HSM protection.
   */
  protectionMode?: 'SOFTWARE' | 'HSM'
      /**
   * Shallow native KMS Key arguments applied last; nested keyShape values are replaced.
   */
  key?: Partial<oci.kms.KeyArgs>
}

/**
 * Declare an OCI KMS master encryption key for a supplied Vault management endpoint.
 * @param name - Logical name and default display name.
 * @param args - Compartment, management endpoint, optional algorithm/length/protection and shallow overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The native KMS Key resource.
 * @throws Provider/resource registration errors propagate; provider validation owns algorithm/length compatibility.
 * @remarks Defaults to AES and SOFTWARE protection. Length defaults are 32 bytes for AES/ECDSA and 256 bytes for RSA; callers select other provider-supported lengths or curves explicitly through the native shape. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciVaultKey } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciVaultKey>[1], options?: Parameters<typeof createOciVaultKey>[2]) { return createOciVaultKey('example', args, options) }
 */
export function createOciVaultKey(name: string, args: OciVaultKeyArgs, options?: pulumi.CustomResourceOptions) {
  const algorithm = args.algorithm ?? 'AES'
  const length = args.length ?? (algorithm === 'RSA' ? 256 : 32)
  const keyShape: oci.kms.KeyArgs['keyShape'] = {
    algorithm,
    length,
  }

  return new oci.kms.Key(name, {
    compartmentId: args.compartmentId,
    displayName: args.displayName ?? name,
    managementEndpoint: args.managementEndpoint,
    keyShape,
    protectionMode: args.protectionMode ?? 'SOFTWARE',
    ...args.key,
  }, options)
}

/**
 * User identity and description for creation of an OCI registry authentication token.
 * @see {@link createOciAuthToken} for the canonical usage example and runtime requirements.
 */
export interface OciAuthTokenArgs {
  
    /**
   * Existing OCI user identity for which an authentication token is declared.
   */
  userId: pulumi.Input<string>
  
    /**
   * Provider-visible description; defaults to AuthToken for followed by the factory's logical name, unless native authToken overrides replace it.
   */
  description?: pulumi.Input<string>
      /**
   * Shallow native AuthToken arguments applied last.
   */
  authToken?: Partial<oci.identity.AuthTokenArgs>
}

/**
 * Declare an OCI user authentication token and expose its value as a Pulumi secret Output.
 * @param name - Logical resource name.
 * @param args - User identity, optional description and shallow native overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The AuthToken resource and secret-wrapped token Output.
 * @throws Provider/resource registration errors propagate.
 * @remarks Creation can issue real credentials during Pulumi apply. The host owns rotation, distribution and access; never unwrap the token into logs or public outputs. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciAuthToken } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciAuthToken>[1], options?: Parameters<typeof createOciAuthToken>[2]) { return createOciAuthToken('example', args, options) }
 */
export function createOciAuthToken(name: string, args: OciAuthTokenArgs, options?: pulumi.CustomResourceOptions) {
  const authToken = new oci.identity.AuthToken(name, {
    userId: args.userId,
    description: args.description ?? `AuthToken for ${name}`,
    ...args.authToken,
  }, options)

  return {
    authToken,
    token: pulumi.secret(authToken.token),
  }
}

/**
 * Vault/key destination and secret-wrapped content used for an OCI secret declaration.
 * @see {@link createOciVaultSecret} for the canonical usage example and runtime requirements.
 */
export interface OciVaultSecretArgs {
  
    /**
   * OCI compartment ID supplied through the host provider context.
   */
  compartmentId: pulumi.Input<string>
  
    /**
   * Explicit Vault identity for secret storage.
   */
  vaultId: pulumi.Input<string>
  
    /**
   * Explicit KMS key identity used to encrypt the secret.
   */
  keyId: pulumi.Input<string>
  
    /**
   * Provider-visible secret name selected by the host.
   */
  secretName: pulumi.Input<string>
  
    /**
   * Provider-visible description; defaults to Encrypted Secret for followed by the factory's logical name, unless native secret overrides replace it.
   */
  description?: pulumi.Input<string>
      /**
   * Sensitive raw UTF-8 or already-base64 Input; wrapped as a secret before conversion.
   */
  secretContent: pulumi.Input<string>
      /**
   * False by default; true preserves supplied base64 bytes without encoding them again.
   */
  isAlreadyBase64?: boolean
      /**
   * Shallow native secret arguments applied last; overridden secretContent retains its supplied shape and is always wrapped as a Pulumi secret.
   */
  secret?: Partial<oci.vault.SecretArgs>
}

/**
 * Declare an OCI Vault secret with secret-wrapped base64 content.
 * @param name - Logical resource name.
 * @param args - Compartment, Vault/key IDs, secret name/content and optional already-base64/native overrides.
 * @param options - Optional Pulumi resource options such as provider, parent, protection or adoption; host-owned.
 * @returns The native OCI Secret resource.
 * @throws Provider/resource registration errors and Output transformation failures propagate.
 * @remarks Encodes UTF-8 content unless isAlreadyBase64=true. Native overrides can replace secretContent without re-encoding; the final content object is always marked secret, including overrides. The host owns content shape and access policy. Importing the module alone does not run a Pulumi update.
 * @example
 * import { createOciVaultSecret } from '@alneas/eaos-cli/presets/oci-adb/infra'
 * export function defineHostResource(args: Parameters<typeof createOciVaultSecret>[1], options?: Parameters<typeof createOciVaultSecret>[2]) { return createOciVaultSecret('example', args, options) }
 */
export function createOciVaultSecret(name: string, args: OciVaultSecretArgs, options?: pulumi.CustomResourceOptions) {
  const content = pulumi.secret(args.secretContent).apply(raw => {
    if (args.isAlreadyBase64) return raw
    return Buffer.from(raw).toString('base64')
  })

  return new oci.vault.Secret(name, {
    compartmentId: args.compartmentId,
    vaultId: args.vaultId,
    keyId: args.keyId,
    secretName: args.secretName,
    description: args.description ?? `Encrypted Secret for ${name}`,
    ...args.secret,
    secretContent: pulumi.secret(args.secret?.secretContent ?? {
      contentType: 'BASE64',
      content,
    }),
  }, options)
}
