import { test, expect } from 'bun:test'
import { expandApprovalSteps } from '../src/rules'
test('host approval rules are deterministic and missing/nonfinite values do not match', () => {
 const base = { stepOrder: 1 }, extra = { stepOrder: 2 }
 const rules = { defaultSteps: [base], conditions: [{ field: 'amount', operator: '>=' as const, value: 100, step: extra }] }
 expect(expandApprovalSteps(rules, { amount: 150 })).toEqual([base, extra])
 for (const amount of [undefined, null, 'bad', Infinity]) expect(expandApprovalSteps(rules, { amount })).toEqual([base])
 expect(rules.defaultSteps).toEqual([base])
})
