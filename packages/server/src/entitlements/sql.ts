import { assertTenantEntitlements, type TenantEntitlements } from '@alneas/eaos-core'
import type { DataContract, Dialect } from '@alneas/eaos-server/lifecycle-engine'
/**
 * Declares reviewed control-plane storage for tenant subscription/addon/quota state across supported SQL dialects.
 * @remarks Hosts install this contract through reviewed lifecycle operations; importing the constant performs no migration.
 * @see createSqlTenantEntitlementLoader for the reader usage example.
 */
export const tenantEntitlementContract: DataContract = {
  id: 'platform-entitlements', version: '1.0.0', description: 'Tenant subscription and plugin addon grants',
  schema: { type: 'object', required: ['tenant_id', 'plan_tier', 'status', 'addons_json', 'quotas_json', 'revision', 'plugin_data'], properties: {
    tenant_id: { type: 'string' }, plan_tier: { type: 'string', enum: ['free', 'standard', 'pro'] }, status: { type: 'string', enum: ['active', 'suspended'] },
    valid_until: { type: ['string', 'null'] }, addons_json: { type: 'string' }, quotas_json: { type: 'string' }, revision: { type: 'integer', minimum: 1 }, plugin_data: { type: 'string', default: '{}' },
  }, 'x-db': { tableName: 'eaos_tenant_entitlements' } },
  migrations: [{ id: '001_tenant_entitlements', scope: 'database', sql: {
    sqlite: ["CREATE TABLE eaos_tenant_entitlements(tenant_id TEXT PRIMARY KEY NOT NULL,plan_tier TEXT NOT NULL CHECK(plan_tier IN ('free','standard','pro')),status TEXT NOT NULL CHECK(status IN ('active','suspended')),valid_until TEXT,addons_json TEXT NOT NULL CHECK(json_valid(addons_json)),quotas_json TEXT NOT NULL CHECK(json_valid(quotas_json)),revision INTEGER NOT NULL,plugin_data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(plugin_data)))"],
    postgres: ["CREATE TABLE eaos_tenant_entitlements(tenant_id VARCHAR(128) PRIMARY KEY,plan_tier VARCHAR(16) NOT NULL CHECK(plan_tier IN ('free','standard','pro')),status VARCHAR(16) NOT NULL CHECK(status IN ('active','suspended')),valid_until VARCHAR(64),addons_json JSONB NOT NULL,quotas_json JSONB NOT NULL,revision BIGINT NOT NULL,plugin_data JSONB NOT NULL DEFAULT '{}')"],
    oracle: ["CREATE TABLE eaos_tenant_entitlements(tenant_id VARCHAR2(128) PRIMARY KEY,plan_tier VARCHAR2(16) NOT NULL CHECK(plan_tier IN ('free','standard','pro')),status VARCHAR2(16) NOT NULL CHECK(status IN ('active','suspended')),valid_until VARCHAR2(64),addons_json CLOB NOT NULL CHECK(addons_json IS JSON),quotas_json CLOB NOT NULL CHECK(quotas_json IS JSON),revision NUMBER(19) NOT NULL,plugin_data CLOB DEFAULT '{}' NOT NULL CHECK(plugin_data IS JSON))"],
  } }],
}
/**
 * Builds a parameterized tenant entitlement reader for the reviewed control-plane table.
 * @param driver - Host SQL dialect and execute callback; execute receives SQL and one tenant binding and resolves optional rows. Credentials and connection lifecycle remain host-owned.
 * @returns An async loader accepting a verified 1–128-character tenant ID (letters/digits/underscore/dot/hyphen, starting alphanumeric) and resolving validated entitlements or null when no row exists.
 * @throws Loader calls reject invalid tenant IDs, multiple rows, malformed JSON/contracts, tenant mismatch, and propagated SQL errors.
 * @remarks Row keys are normalized to lowercase; JSON columns may be strings or already parsed values. No row-level authorization or shared transaction is established by this factory.
 * @example
 * ```typescript
 * import { createSqlTenantEntitlementLoader } from "@alneas/eaos-server/entitlements";
 * export function entitlementLoader(driver: Parameters<typeof createSqlTenantEntitlementLoader>[0]) {
 *   return createSqlTenantEntitlementLoader(driver);
 * }
 * ```
 */
export function createSqlTenantEntitlementLoader(driver: {
  /**
 * SQL placeholder dialect: Oracle uses :1, PostgreSQL $1, and SQLite ? for the tenant binding.
 */
dialect: Dialect;
  /**
 * Executes the loader's parameterized tenant SELECT through the trusted host connection.
 * @param sql - SQL supplied by the loader with one dialect-correct tenant placeholder.
 * @param bindings - One verified tenant ID in placeholder order.
 * @returns Optional result rows; no rows resolves to null at the loader boundary.
 * @throws Host query errors reject the entitlement lookup.
 * @example
 * ```typescript
 * import { createSqlTenantEntitlementLoader } from '@alneas/eaos-server/entitlements';
 * export async function loadContract(driver: Parameters<typeof createSqlTenantEntitlementLoader>[0], verifiedTenantId: string) {
 *   // The host supplies the reviewed schema and privileged read connection.
 *   return createSqlTenantEntitlementLoader(driver)(verifiedTenantId);
 * }
 * ```
 */
execute(sql: string, bindings: unknown[]): Promise<{
  /**
 * Optional result rows; missing rows is treated as an empty result, while more than one row rejects as ambiguous.
 */
rows?: Record<string, unknown>[] }> }) {
  return async (tenantId: string): Promise<TenantEntitlements | null> => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(tenantId)) throw Error('Verified entitlement tenant required')
    const bind = driver.dialect === 'oracle' ? ':1' : driver.dialect === 'postgres' ? '$1' : '?'
    const rows = (await driver.execute(`SELECT tenant_id,plan_tier,status,valid_until,addons_json,quotas_json FROM eaos_tenant_entitlements WHERE tenant_id=${bind}`, [tenantId])).rows ?? []
    if (!rows.length) return null
    if (rows.length !== 1) throw Error('Ambiguous tenant entitlement')
    const row = Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k.toLowerCase(), v]))
    const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value
    const result: TenantEntitlements = { tenantId: String(row.tenant_id), plan: row.plan_tier as TenantEntitlements['plan'], status: row.status as TenantEntitlements['status'], addons: json(row.addons_json), monthlyQuotas: json(row.quotas_json), ...(row.valid_until ? { validUntil: String(row.valid_until) } : {}) }
    assertTenantEntitlements(result)
    if (result.tenantId !== tenantId) throw Error('Entitlement tenant differs')
    return result
  }
}
