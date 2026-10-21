/**
 * Conditional rule that appends a host-defined step when one field comparison matches.
 * @typeParam T - Host value shape carried by this contract.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface ConditionalStep<T> {
/**
 * Input values key inspected by the rule.
 */
  field: string;
/**
 * String-coercing equality or finite-number comparison operator.
 */
  operator: '>=' | '>' | '===' | '<=' | '<';
/**
 * Comparison threshold or equality text.
 */
  value: number | string;
/**
 * Host-defined step appended when the condition matches.
 */
  step: T }
/**
 * Expands matching conditional approval steps, sorts by stepOrder and keeps the first step for each order.
 *
 * Deterministic rule expansion. Roles, names, limits and templates are host-owned.
 * @typeParam T - Host step shape with numeric stepOrder; other fields are preserved.
 * @param rules - Default steps plus optional conditions evaluated against values.
 * @param values - Field-value map; null/undefined values do not match.
 * @returns A new sorted array sharing the original step objects; duplicate stepOrder values are removed.
 *
 * @remarks
 * Equality compares String values. Ordering operators coerce finite numbers; nonfinite comparisons are skipped. Default steps win duplicate orders ahead of appended conditions.
 *
 * @example
 * ```typescript
 * import { expandApprovalSteps } from '@alneas/eaos-plugins/approval/rules';
 * const steps = expandApprovalSteps({ defaultSteps: [{ stepOrder: 1, role: 'reviewer' }], conditions: [{ field: 'amount', operator: '>=', value: 1000, step: { stepOrder: 2, role: 'manager' } }] }, { amount: 2000 });
 * ```
 */
export function expandApprovalSteps<T extends { stepOrder: number }>(rules: {
/**
 * Host steps always included before conditional expansion.
 */
  defaultSteps: T[];
/**
 * Optional field comparisons that append matching steps; defaults to none.
 */
  conditions?: ConditionalStep<T>[] }, values: Record<string, unknown>): T[] {
 const steps = [...rules.defaultSteps]
 for (const condition of rules.conditions ?? []) {
  const field = values[condition.field]
  if (field === undefined || field === null) continue
  let matched = false
  if (condition.operator === '===') matched = String(field) === String(condition.value)
  else {
   const a = Number(field), b = Number(condition.value)
   if (!Number.isFinite(a) || !Number.isFinite(b)) continue
   if (condition.operator === '>=') matched = a >= b
   if (condition.operator === '>') matched = a > b
   if (condition.operator === '<=') matched = a <= b
   if (condition.operator === '<') matched = a < b
  }
  if (matched) steps.push(condition.step)
 }
 const seen = new Set<number>()
 return steps.sort((a, b) => a.stepOrder - b.stepOrder).filter(s => { if (seen.has(s.stepOrder)) return false; seen.add(s.stepOrder); return true })
}
