import { parseAccountMemberships, type AccountMemberships } from '@alneas/eaos-server/platform'

/**
 * Parses account membership claims exclusively from an active identity's public metadata.
 * @param identity - Identity returned by a server-verified Kratos session; state must equal active.
 * @returns Parsed memberships and optional defaultTenantId; absent/null public metadata supplies an empty membership list.
 * @throws For inactive identities, malformed public metadata, or invalid membership claims rejected by the platform parser.
 * @remarks Never pass editable traits or unverified client JSON. There is no fallback to private metadata or SQL membership lookup, and parsing does not authenticate the identity.
 * @example
 * ```typescript
 * import { publicAccountMemberships } from "@alneas/eaos-server/browser-auth/public-memberships";
 * import { createKratosSessionVerifier } from "@alneas/eaos-server/browser-auth/kratos-session";
 * const verify = createKratosSessionVerifier({ publicUrl: "https://identity.example.com" });
 * export async function memberships(cookie: string | undefined) {
 *   const session = await verify({ cookie });
 *   return session ? publicAccountMemberships(session.identity) : null;
 * }
 * ```
 */
export function publicAccountMemberships(identity: Record<string, unknown>): AccountMemberships {
  if (identity.state !== 'active') throw new Error('Active identity required')
  const value = identity.metadata_public
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid public metadata')
  const metadata = (value ?? {}) as Record<string, unknown>
  // No fallback to editable traits, private metadata, or a SQL directory.
  return parseAccountMemberships({ memberships: metadata.eaos_memberships ?? [], defaultTenantId: metadata.eaos_default_tenant_id ?? undefined })
}
