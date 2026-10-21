/**
 * Browser-safe contracts. The server must resolve these from its control plane.
 * @see {@link evaluatePluginEntitlement}
 */
export type PluginTier = 'public' | 'standard' | 'pro' | 'corporate'
/**
 * Plugin subscription, tenant allowlist and optional metering requirements.
 * @see {@link evaluatePluginEntitlement}
 */
export interface PluginEntitlement {
  
  /** Commercial entitlement category or model resource tier, interpreted by its owning policy. */
  tier: PluginTier
  
/** Optional subscription addon identity; required for pro plugin policies. */
  addonId?: string
  
/** Optional explicit tenant allowlist; corporate policies require a nonempty list. */
  allowedTenants?: readonly string[]
  
  /** Optional usage unit and nonnegative default monthly quota; admission preview does not measure/consume usage. */
  metering?: { 
  
  /** Metered usage-unit identifier validated as a bounded entitlement identifier. */
  unit: string; 
/** Nonnegative safe-integer quota used when no tenant override exists. */
  defaultMonthlyQuota: number }
}
/**
 * Host-controlled tenant subscription snapshot and quota overrides.
 * @see {@link evaluatePluginEntitlement}
 */
export interface TenantEntitlements {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Host subscription plan used by entitlement preview. */
  plan: 'free' | 'standard' | 'pro'
  
  /** Subscription state; nonpublic/noncorporate preview requires active status. */
  status: 'active' | 'suspended'
  
/** Optional parseable subscription expiry checked against the evaluation clock. */
  validUntil?: string
  
/** Addon identities present in the host entitlement snapshot. */
  addons: readonly string[]
  /** Overrides are keyed by addon ID, otherwise by plugin ID. Zero denies all usage. */
  monthlyQuotas?: Readonly<Record<string, number>>
}
/**
 * Admission preview as an allowed status/quota or a denied status/reason.
 * @see {@link evaluatePluginEntitlement}
 */
export type EntitlementDecision = { 
  /** Admission/check decision; consumers must inspect it before using the associated result or performing an effect. */
  allowed: true; 
  /** HTTP-style preview status: 200 allowed, 402 subscription/addon denial or 404 tenant allowlist denial. */
  status: 200; 
/** Resolved metering allowance; evaluation does not consume it or compare current usage. */
  quota?: number } |
  { 
  /** Admission/check decision; consumers must inspect it before using the associated result or performing an effect. */
  allowed: false; 
  /** HTTP-style preview status: 200 allowed, 402 subscription/addon denial or 404 tenant allowlist denial. */
  status: 402 | 404; 
/** Human-readable explanation of the decision or requested action. */
  reason: 'tenant-locked' | 'subscription-required' | 'addon-required' | 'quota-exceeded' }
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(v)
/**
 * Validate plugin admission and optional metering requirements.
 * @param value - Policy; pro requires an addon ID, corporate requires a nonempty tenant allowlist, and quotas must be nonnegative safe integers.
 * @returns No value; completion confirms structural policy validity.
 * @throws Error for invalid tier, identifiers, allowlist or metering settings.
 * @example
 * ```typescript
 * import { assertPluginEntitlement } from "@alneas/eaos-core/entitlements";
 * assertPluginEntitlement({ tier: "public" });
 * ```
 */
export function assertPluginEntitlement(value: PluginEntitlement): void {
  if (!value || !['public', 'standard', 'pro', 'corporate'].includes(value.tier)) throw Error('Invalid plugin entitlement tier')
  if (value.addonId !== undefined && !identifier(value.addonId)) throw Error('Invalid entitlement addon ID')
  if (value.tier === 'pro' && !value.addonId) throw Error('Pro plugin requires an addon ID')
  if (value.tier === 'corporate' && (!Array.isArray(value.allowedTenants) || !value.allowedTenants.length)) throw Error('Corporate plugin requires allowed tenants')
  if (value.allowedTenants !== undefined && (!Array.isArray(value.allowedTenants) || !value.allowedTenants.length || value.allowedTenants.some(v => !identifier(v)))) throw Error('Invalid entitlement tenant allowlist')
  if (value.metering && (!identifier(value.metering.unit) || !Number.isSafeInteger(value.metering.defaultMonthlyQuota) || value.metering.defaultMonthlyQuota < 0)) throw Error('Invalid entitlement metering')
}
/**
 * Validate a host-provided tenant subscription snapshot.
 * @param value - Tenant ID, plan/status, addon IDs, optional parseable expiry and nonnegative safe-integer quota overrides.
 * @returns No value; completion confirms snapshot shape, without checking freshness.
 * @throws Error for invalid identity, plan/status, expiry, addon IDs or quota overrides.
 * @example
 * ```typescript
 * import { assertTenantEntitlements } from "@alneas/eaos-core/entitlements";
 * assertTenantEntitlements({ tenantId: "tenant-demo", plan: "free", status: "active", addons: [] });
 * ```
 */
export function assertTenantEntitlements(value: TenantEntitlements): void {
  if (!value || !identifier(value.tenantId) || !['free', 'standard', 'pro'].includes(value.plan) || !['active', 'suspended'].includes(value.status) || !Array.isArray(value.addons) || value.addons.some(v => !identifier(v)) || value.validUntil !== undefined && !Number.isFinite(Date.parse(value.validUntil))) throw Error('Invalid tenant entitlements')
  if (value.monthlyQuotas !== undefined && (!value.monthlyQuotas || typeof value.monthlyQuotas !== 'object' || Array.isArray(value.monthlyQuotas) || Object.entries(value.monthlyQuotas).some(([key, quota]) => !identifier(key) || !Number.isSafeInteger(quota) || quota < 0))) throw Error('Invalid tenant quota')
}
/**
 * Pure preview shared by server and UI. A UI decision is never a server capability.
 * @param pluginId - Valid plugin identifier used as a quota key when no addon ID is set.
 * @param rule - Plugin policy validated before evaluation.
 * @param tenantId - Tenant whose access is being previewed.
 * @param entitlement - Trusted tenant snapshot, or null when absent; any supplied tenant ID must match.
 * @param now - Evaluation time; defaults to a newly constructed current Date.
 * @returns Allowed with optional quota, or a denial carrying status 402/404 and reason. This helper does not consume quota or compare usage.
 * @throws Error for malformed policies/snapshots, invalid time or scope, or a mismatched tenant.
 * @remarks Pure preview only. The host must enforce admission and quotas; an allowed browser result is not a server capability.
 * @example
 * ```typescript
 * import { evaluatePluginEntitlement } from "@alneas/eaos-core/entitlements";
 * console.log(evaluatePluginEntitlement("notes", { tier: "public" }, "tenant-demo", null));
 * ```
 */
export function evaluatePluginEntitlement(pluginId: string, rule: PluginEntitlement, tenantId: string, entitlement: TenantEntitlements | null, now = new Date()): EntitlementDecision {
  assertPluginEntitlement(rule)
  if (!identifier(pluginId) || !identifier(tenantId) || !Number.isFinite(now.getTime())) throw Error('Invalid entitlement scope')
  if (rule.allowedTenants && !rule.allowedTenants.includes(tenantId)) return { allowed: false, status: 404, reason: 'tenant-locked' }
  if (entitlement) { assertTenantEntitlements(entitlement); if (entitlement.tenantId !== tenantId) throw Error('Entitlement tenant differs') }
  if (rule.tier !== 'public' && rule.tier !== 'corporate' && (!entitlement || entitlement.status !== 'active' || entitlement.plan === 'free' || entitlement.validUntil && Date.parse(entitlement.validUntil) <= now.getTime())) return { allowed: false, status: 402, reason: 'subscription-required' }
  if (rule.tier === 'pro' && !entitlement?.addons.includes(rule.addonId!)) return { allowed: false, status: 402, reason: 'addon-required' }
  const quota = rule.metering ? entitlement?.monthlyQuotas?.[rule.addonId ?? pluginId] ?? rule.metering.defaultMonthlyQuota : undefined
  return { allowed: true, status: 200, ...(quota !== undefined ? { quota } : {}) }
}
