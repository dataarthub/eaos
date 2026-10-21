import { describe, expect, test } from 'bun:test'
import { evaluatePluginEntitlement, assertPluginEntitlement, type TenantEntitlements } from './entitlements'
import { definePlugin } from './define-plugin'
const subscribed: TenantEntitlements = { tenantId: 't-a', plan: 'standard', status: 'active', addons: ['addon-quant'] }
describe('commercial contracts', () => {
  test('pro always requires its specific addon, current subscription and exact tenant', () => {
    const rule = { tier: 'pro' as const, addonId: 'addon-quant', metering: { unit: 'run', defaultMonthlyQuota: 5 } }
    expect(evaluatePluginEntitlement('quant', rule, 't-a', subscribed)).toEqual({ allowed: true, status: 200, quota: 5 })
    expect(evaluatePluginEntitlement('quant', rule, 't-a', { ...subscribed, plan: 'pro', addons: [] }).allowed).toBe(false)
    expect(evaluatePluginEntitlement('quant', rule, 't-a', { ...subscribed, validUntil: '2000-01-01T00:00:00Z' }).allowed).toBe(false)
    expect(evaluatePluginEntitlement('quant', rule, 't-a', { ...subscribed, status: 'suspended' }).allowed).toBe(false)
    expect(() => evaluatePluginEntitlement('quant', rule, 't-b', subscribed)).toThrow('tenant differs')
    expect(evaluatePluginEntitlement('quant', rule, 't-a', { ...subscribed, monthlyQuotas: { 'addon-quant': 0 } })).toEqual({ allowed: true, status: 200, quota: 0 })
  })
  test('corporate is invisible outside its declared tenants', () => {
    expect(evaluatePluginEntitlement('corp', { tier: 'corporate', allowedTenants: ['t-a'] }, 't-b', null)).toEqual({ allowed: false, status: 404, reason: 'tenant-locked' })
    expect(() => assertPluginEntitlement({ tier: 'corporate' })).toThrow()
    expect(() => assertPluginEntitlement({ tier: 'pro' })).toThrow()
    expect(() => assertPluginEntitlement({ tier: 'public', metering: { unit: 'run', defaultMonthlyQuota: -1 } })).toThrow()
  })
  test('SDK is declarative, and rejects ambiguous routes and invalid scopes', () => {
    const plugin = definePlugin({ id: 'repairs', routes(r) { r.post('/requests', (ctx, input) => ({ tenantId: ctx.principal.tenantId, input })) } })
    expect(plugin.routeDefinitions).toHaveLength(1)
    expect(Object.isFrozen(plugin.routeDefinitions)).toBe(true)
    expect(() => definePlugin({ id: '../x', routes() {} })).toThrow()
    expect(() => definePlugin({ id: 'x', routes(r) { r.get('/x', () => 1); r.get('/x', () => 2) } })).toThrow('Duplicate')
  })
})
