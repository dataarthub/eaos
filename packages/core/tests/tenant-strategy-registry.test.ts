import { describe, it, expect } from 'bun:test'
import { TenantStrategyRegistry } from '../src/plugin-sdk/tenant-strategy-registry'

interface ICalculationStrategy {
  calculate(value: number): number
}

class StandardCalculationStrategy implements ICalculationStrategy {
  calculate(value: number): number {
    return value + 10 // Standard fee
  }
}

class TenantACalculationStrategy implements ICalculationStrategy {
  calculate(value: number): number {
    return value + 5 // Tenant A special fee
  }
}

describe('TenantStrategyRegistry', () => {
  it('resolves default strategy when no tenant override is registered', () => {
    const registry = new TenantStrategyRegistry<ICalculationStrategy>(
      new StandardCalculationStrategy()
    )

    const strategy = registry.resolve('standard-tenant-uuid')
    expect(strategy.calculate(100)).toBe(110)
    expect(registry.hasTenantStrategy('standard-tenant-uuid')).toBe(false)
  })

  it('resolves tenant-specific strategy override when registered', () => {
    const registry = new TenantStrategyRegistry<ICalculationStrategy>(
      new StandardCalculationStrategy()
    )

    registry.registerTenantStrategy('tenant-a-uuid', new TenantACalculationStrategy())

    const strategyForA = registry.resolve('tenant-a-uuid')
    expect(strategyForA.calculate(100)).toBe(105)
    expect(registry.hasTenantStrategy('tenant-a-uuid')).toBe(true)

    // Ensure standard tenant still gets default strategy
    const strategyForOther = registry.resolve('other-tenant-uuid')
    expect(strategyForOther.calculate(100)).toBe(110)
  })

  it('falls back to default strategy if moduleGuard rejects the tenant license', () => {
    const moduleGuard = (tenantId: string, enabledModules?: string[]) => {
      return enabledModules?.includes('custom_override_feature') ?? false
    }

    const registry = new TenantStrategyRegistry<ICalculationStrategy>(
      new StandardCalculationStrategy(),
      moduleGuard
    )

    registry.registerTenantStrategy('tenant-a-uuid', new TenantACalculationStrategy())

    // 1. Without license/feature module -> falls back to default strategy
    const fallbackStrategy = registry.resolve('tenant-a-uuid', ['standard_accounting'])
    expect(fallbackStrategy.calculate(100)).toBe(110)

    // 2. With license/feature module -> uses custom Tenant A strategy
    const activeStrategy = registry.resolve('tenant-a-uuid', ['standard_accounting', 'custom_override_feature'])
    expect(activeStrategy.calculate(100)).toBe(105)
  })
})
