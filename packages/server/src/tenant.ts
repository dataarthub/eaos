/**
 * Routing hints used by {@link TenantResolver}; they do not authenticate a tenant.
 * @see TenantResolver for a complete usage example.
 */
export interface TenantResolverOptions {
  /** Fallback when no explicit ID or host mapping matches. @defaultValue "default" */
  defaultTenantId?: string
  /** Routing-only email domain mappings. Never use email-derived results as an authenticated tenant claim. */
  domainTenantMap?: Record<string, string>
  /** Trusted, exact hostname mappings (e.g. { "demo.example.com": "tenant-demo" }). */
  hostTenantMap?: Record<string, string>
}

/**
 * Selects a tenant routing ID from an explicit trusted ID, configured host, or fallback.
 * @remarks This resolver performs no authentication or membership check. Host headers and explicit IDs must be validated by the host before being used for authorization. Email mappings are exposed only by resolveFromEmail.
 * @example
 * ```typescript
 * import { TenantResolver } from "@alneas/eaos-server/tenant";
 * const resolver = new TenantResolver({ hostTenantMap: { "workspace.example.com": "workspace" } });
 * const tenantId = resolver.resolve({ host: "workspace.example.com:443" });
 * console.log(tenantId); // "workspace"
 * ```
 */
export class TenantResolver {
  private defaultTenantId: string
  private domainTenantMap: Map<string, string>
  private hostTenantMap: Map<string, string>

  /**
   * Copies routing mappings, normalizing their keys to lower case.
   * @param options - Routing mappings and fallback; omitted options use empty mappings and "default".
   */
  constructor(options: TenantResolverOptions = {}) {
    this.defaultTenantId = options.defaultTenantId ?? 'default'
    this.domainTenantMap = new Map(
      Object.entries(options.domainTenantMap ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    )
    this.hostTenantMap = new Map(
      Object.entries(options.hostTenantMap ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    )
  }

  /**
   * Looks up the lower-case domain following the first @ in an email routing hint.
   * @param email - Email hint; missing, empty, or missing @ returns null. No address validation is performed.
   * @returns The configured routing ID, or null when no domain matches.
   * @example
   * ```typescript
   * import { TenantResolver } from "@alneas/eaos-server/tenant";
   * const resolver = new TenantResolver({ domainTenantMap: { "example.com": "workspace" } });
   * console.log(resolver.resolveFromEmail("person@example.com"));
   * ```
   */
  resolveFromEmail(email: string | null | undefined): string | null {
    if (!email) return null
    const parts = email.split('@')
    if (parts.length < 2) return null
    const domain = parts[1].toLowerCase()
    return this.domainTenantMap.get(domain) ?? null
  }

  /**
   * Looks up a configured hostname after removing text following the first colon and lower-casing.
   * @param host - Host routing hint, optionally including a port; missing or empty values return null. IPv6 host parsing is not provided.
   * @returns The exact configured host mapping, or null.
   * @example
   * ```typescript
   * import { TenantResolver } from "@alneas/eaos-server/tenant";
   * const resolver = new TenantResolver({ hostTenantMap: { "workspace.example.com": "workspace" } });
   * console.log(resolver.resolveFromHost("workspace.example.com:443"));
   * ```
   */
  resolveFromHost(host: string | null | undefined): string | null {
    if (!host) return null
    const cleanHost = host.split(':')[0].toLowerCase()
    if (this.hostTenantMap.has(cleanHost)) {
      return this.hostTenantMap.get(cleanHost)!
    }
    return null
  }

  /**
   * Selects a truthy explicit ID, then a host mapping, then the configured fallback.
   * @param input - Routing hints: explicitTenantId takes precedence over host; email is intentionally ignored. The host must establish whether an explicit ID is trusted.
   * @returns The selected routing ID, without validating tenant existence or membership.
   * @see TenantResolver for a complete usage example.
   * @example
   * ```typescript
   * import { TenantResolver } from "@alneas/eaos-server/tenant";
   * const resolver = new TenantResolver();
   * console.log(resolver.resolve({ explicitTenantId: "workspace" }));
   * ```
   */
  resolve(input: { 
  /**
   * Optional host routing hint, including a possible port; checked only after a falsy/absent explicitTenantId against configured exact host mappings.
   */
  host?: string | null; 
  /**
   * Optional compatibility routing hint intentionally ignored by resolve; an email domain is not an authenticated tenant claim.
   */
  email?: string | null; 
  /**
   * Optional trusted tenant routing selection; any truthy value takes precedence without tenant-existence or membership validation.
   */
  explicitTenantId?: string | null }): string {
    if (input.explicitTenantId) return input.explicitTenantId
    // Email domains are routing hints only; they are deliberately not accepted
    // as an authenticated tenant selector.
    const fromHost = this.resolveFromHost(input.host)
    if (fromHost) return fromHost
    return this.defaultTenantId
  }

  /**
   * Reads the fallback ID captured at construction.
   * @returns The configured fallback, or "default" when none was supplied.
   * @example
   * ```typescript
   * import { TenantResolver } from "@alneas/eaos-server/tenant";
   * console.log(new TenantResolver().getDefaultTenantId());
   * ```
   */
  getDefaultTenantId(): string {
    return this.defaultTenantId
  }
}

/**
 * Creates a resolver for host-owned tenant routing hints.
 * @param options - Routing mappings and fallback; see {@link TenantResolverOptions}.
 * @returns A new independent resolver with copied mappings.
 * @example
 * ```typescript
 * import { createTenantResolver } from "@alneas/eaos-server/tenant";
 * const resolver = createTenantResolver({ defaultTenantId: "workspace" });
 * console.log(resolver.resolve({}));
 * ```
 */
export function createTenantResolver(options?: TenantResolverOptions): TenantResolver {
  return new TenantResolver(options)
}
