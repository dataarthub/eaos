/**
 * Unified Secret Resolver for EAOS
 * Provides Fail-Fast validation without silent fallback values.
 * Reads injected process.env values with caching. The current OCI fallback
 * is environment-only and does not perform a Vault API request.
 */

declare const process: { env: Record<string, string | undefined> }


/**
 * Environment key and optional required flag for host secret declarations.
 * @see {@link SecretResolver}
 */
export interface SecretResolveOptions {
  
  /** Exact environment variable name to resolve; declarations contain names rather than secret values. */
  envKey: string
  
  /** Whether an unresolved environment secret must fail validation; resolver calls default to true when the flag is omitted. */
  required?: boolean
}

/**
 * Resolve and cache process environment secrets through static methods.
 * @remarks Requires process.env. The current OCI fallback only inspects environment values and does not perform a Vault API request; it must not be treated as a connected Vault client. Cache is global to this class and does not expire. Missing optional values return an empty string without caching.
 *
 * @example
 * ```typescript
 * import { SecretResolver } from "@alneas/eaos-core/secrets/secret-resolver";
 * const secret = await SecretResolver.getSecret("EAOS_OPTIONAL_TEST_SECRET", false);
 * console.log(secret.length > 0);
 * SecretResolver.clearCache();
 * ```
 */
export class SecretResolver {
  private static cache = new Map<string, string>()

  /**
   * Read a cached or nonblank environment value, failing when a required secret is absent.
   * @param envKey - Exact process.env key.
   * @param required - Whether an unresolved value rejects; defaults to true.
   * @returns Resolved secret, including original whitespace, or empty string when optional and missing.
   * @throws Rejects with Error when a required secret is unavailable; process access errors propagate.
   * @remarks Successful values are cached across calls until clearCache; OCI fallback failures are logged. No secret is persisted.
   * @example
   * ```typescript
   * import { SecretResolver } from "@alneas/eaos-core/secrets/secret-resolver";
   * const secret = await SecretResolver.getSecret("EAOS_OPTIONAL_TEST_SECRET", false);
   * console.log(secret.length > 0);
   * ```
   */
  static async getSecret(envKey: string, required = true): Promise<string> {
    if (this.cache.has(envKey)) {
      return this.cache.get(envKey)!
    }

    // 1. Check process.env (BWS, Docker env, or Kamal injection)
    const envVal = process.env[envKey]
    if (envVal && envVal.trim() !== '') {
      this.cache.set(envKey, envVal)
      return envVal
    }

    // 2. Try OCI Vault if OCI Vault environment variables are present
    const ociVaultOcid = process.env.OCI_VAULT_OCID
    if (ociVaultOcid && process.env.OCI_SECRET_OCID_PREFIX) {
      try {
        const ociSecretVal = await this.fetchFromOciVault(envKey)
        if (ociSecretVal && ociSecretVal.trim() !== '') {
          this.cache.set(envKey, ociSecretVal)
          return ociSecretVal
        }
      } catch (error) {
        console.error(`[SecretResolver] Warning: Failed to retrieve "${envKey}" from OCI Vault:`, error)
      }
    }

    // 3. Fail-Fast: Throw explicit critical exception if secret is required but missing
    if (required) {
      throw new Error(
        `[CRITICAL SECRET FAILURE] Required secret "${envKey}" could not be resolved from BWS (process.env) or OCI Vault. ` +
        `Application startup halted to prevent undefined fallback behavior.`
      )
    }

    return ''
  }

  /**
   * Resolve plugin secret declarations sequentially during startup.
   * @param pluginId - Plugin identifier accepted for call-site context; currently unused by the implementation.
   * @param secretRequirements - Environment key and required flag for each secret; optional missing entries do not fail validation.
   * @returns No value; all declarations resolved or were optional and missing.
   * @throws Rejects on the first required missing secret or propagated resolver failure.
   * @remarks May populate the shared cache; earlier resolutions remain cached if a later one fails.
   * @example
   * ```typescript
   * import { SecretResolver } from "@alneas/eaos-core/secrets/secret-resolver";
   * await SecretResolver.validatePluginSecrets("notes", [{ envKey: "EAOS_OPTIONAL_TEST_SECRET", required: false }]);
   * ```
   */
  static async validatePluginSecrets(pluginId: string, secretRequirements: Array<{ 
  /** Exact environment variable name to resolve; declarations contain names rather than secret values. */
  envKey: string; 
  /** Whether an unresolved environment secret must fail validation; resolver calls default to true when the flag is omitted. */
  required: boolean }>): Promise<void> {
    for (const req of secretRequirements) {
      await this.getSecret(req.envKey, req.required)
    }
  }

  /**
   * OCI Vault runtime fetcher fallback (lazily loaded when OCI Vault is configured)
   */
  private static async fetchFromOciVault(envKey: string): Promise<string | null> {
    // Runtime fetch via OCI REST API or instance principal environment
    const secretOcid = process.env[`OCI_SECRET_OCID_${envKey.toUpperCase()}`]
    if (!secretOcid) return null

    // Simulating OCI Vault Secrets Client resolution if OCI instance principal is active
    if (process.env.OCI_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.OCI_RESOURCE_PRINCIPAL_VERSION) {
      // Execute OCI Vault bundle retrieval
      return process.env[envKey] || null
    }

    return null
  }

  /**
   * Remove all resolved values from the shared in-memory cache.
   * @returns No value; subsequent lookups read the environment again.
   * @example
   * ```typescript
   * import { SecretResolver } from "@alneas/eaos-core/secrets/secret-resolver";
   * SecretResolver.clearCache();
   * ```
   */
  static clearCache(): void {
    this.cache.clear()
  }
}
