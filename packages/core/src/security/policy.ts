import type { GatekeeperPolicy, RiskLevel } from '../plugin-sdk/types'
import type { ApprovalLevel } from './gatekeeper'
import { mapAIRiskToGatekeeper } from '../ai/governance'

const riskLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical']
const approvalLevels: ApprovalLevel[] = ['L1_AUTO', 'L2_LEAD', 'L3_MANAGER', 'L4_EXECUTIVE']

/**
 * Resolve shared execution policy, enforcing AI tier minimums when declared.
 * @internal
 * @param policy - Optional tool policy; omitted risk defaults to low and omitted review level derives from risk.
 * @returns Effective risk, approval level and human review flag, plus the declared AI tier when present.
 * @throws Error when the declared AI risk tier is not 1, 2 or 3.
 * @remarks Shared internally by live gatekeeper evaluation and contract snapshots. Explicit AI policy requirements can only tighten the tier minimums. This result does not authorize execution.
 * @example
 * Use the public gatekeeper to evaluate the shared policy rules:
 * ```typescript
 * import { McpGatekeeper } from '@alneas/eaos-core/security/gatekeeper';
 * const gatekeeper = new McpGatekeeper();
 * gatekeeper.registerPolicy('notes.write', { aiRiskLevel: 3, requireHumanApproval: false });
 * const decision = gatekeeper.validateCall({ toolName: 'notes.write', userRoles: [], tenantId: 'tenant-demo' });
 * console.log(decision.requireHumanApproval); // true
 * ```
 */
export function resolveGatekeeperPolicy(policy?: GatekeeperPolicy & { approvalLevel?: ApprovalLevel }) {
  const aiRiskLevel = policy?.aiRiskLevel
  if (aiRiskLevel !== undefined && aiRiskLevel !== 1 && aiRiskLevel !== 2 && aiRiskLevel !== 3) {
    throw new Error('Invalid AI risk tier; expected 1, 2 or 3')
  }
  const minimum = aiRiskLevel === undefined ? undefined : mapAIRiskToGatekeeper(aiRiskLevel)
  let riskLevel = policy?.riskLevel ?? 'low'
  if (minimum && riskLevels.indexOf(minimum.riskLevel) > riskLevels.indexOf(riskLevel)) riskLevel = minimum.riskLevel
  let approvalLevel = policy?.approvalLevel ?? approvalLevels[riskLevels.indexOf(riskLevel)] ?? 'L1_AUTO'
  if (minimum && approvalLevels.indexOf(minimum.approvalLevel) > approvalLevels.indexOf(approvalLevel)) approvalLevel = minimum.approvalLevel
  const requireHumanApproval = (policy?.requireHumanApproval ?? (approvalLevel !== 'L1_AUTO')) || (minimum?.requireHumanApproval ?? false)
  return { riskLevel, approvalLevel, requireHumanApproval, ...(aiRiskLevel === undefined ? {} : { aiRiskLevel }) }
}
