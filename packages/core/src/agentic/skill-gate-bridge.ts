/**
 * Skill Gate Bridge for AIWorker & EAOS Core
 * Integrates @aiworker/skill-loader gating logic with McpGatekeeper & AgentRuntime
 */

import type { McpGatekeeper, ApprovalLevel } from '../security/gatekeeper'
import type { AgentRuntime, AgentExecutionContext } from './runtime'
import type { RiskLevel } from '../plugin-sdk/types'

/**
 * Skill policy metadata mapped to a named gatekeeper policy.
 * @see {@link SkillGateBridge}
 */
export interface SkillGateDefinition {
  
/** Exact policy/tool identity used when registering and evaluating this skill gate. */
  skillName: string
  
  /** Skill metadata version; SkillGateBridge does not use it in policy evaluation. */
  version: string
  
  
  /** Skill discovery classification; SkillGateBridge does not use it for gatekeeper evaluation. */
  category: string
  
/** Required organizational review category; a level declaration is not proof of approval. */
  approvalLevel?: ApprovalLevel
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel?: RiskLevel
  
/** Optional allowed role names mapped to the gatekeeper policy. */
  requiredRoles?: string[]
  
/** Discovery trigger metadata; SkillGateBridge does not evaluate it. */
  whenToActivate: string[]
}

/**
 * Map named skill policies to gatekeeper decisions and runtime hooks.
 * @remarks Does not load skill files or evaluate whenToActivate/version/category. Registration replaces a gatekeeper policy; the host supplies trusted scope and owns any approval workflow.
 *
 * @example
 * ```typescript
 * import { SkillGateBridge } from "@alneas/eaos-core/agentic/skill-gate-bridge";
 * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
 * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
 * const bridge = new SkillGateBridge(new McpGatekeeper(), new AgentRuntime());
 * bridge.registerSkillGate({ skillName: "notes.preview", version: "1", category: "notes", riskLevel: "low", whenToActivate: [] });
 * ```
 */
export class SkillGateBridge {
  /**
   * Connect a skill policy bridge to host-owned gatekeeper and runtime instances.
   * @param gatekeeper - Policy registry used before skill execution.
   * @param runtime - Hook engine called only after the policy allows execution without pending approval.
   *
   * @example
   * ```typescript
   * import { SkillGateBridge } from "@alneas/eaos-core/agentic/skill-gate-bridge";
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const bridge = new SkillGateBridge(new McpGatekeeper(), new AgentRuntime());
   * ```
   */
  constructor(
    private gatekeeper: McpGatekeeper,
    private runtime: AgentRuntime
  ) {}

  /**
   * Register or replace a skill-name gatekeeper policy.
   * @param skill - Name, roles, risk and approval metadata; risk defaults to low. Human approval is computed from the supplied approvalLevel/riskLevel combination.
   * @returns No value; named policy has been replaced.
   * @remarks Activation triggers, version and category are metadata only; empty role arrays deny users unless they carry an admin override in the gatekeeper.
   * @example
   * ```typescript
   * import { SkillGateBridge } from "@alneas/eaos-core/agentic/skill-gate-bridge";
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const bridge = new SkillGateBridge(new McpGatekeeper(), new AgentRuntime());
   * bridge.registerSkillGate({ skillName: "notes.preview", version: "1", category: "notes", riskLevel: "low", whenToActivate: [] });
   * ```
   */
  registerSkillGate(skill: SkillGateDefinition): void {
    this.gatekeeper.registerPolicy(skill.skillName, {
      requiredRole: skill.requiredRoles,
      riskLevel: skill.riskLevel ?? 'low',
      approvalLevel: skill.approvalLevel,
      requireHumanApproval: skill.approvalLevel !== 'L1_AUTO' && skill.riskLevel !== 'low',
    })
  }

  /**
   * Check skill policy and execute through runtime hooks when no review is required.
   * @typeParam T - Resolved domain output from the supplied executor; defaults to unknown.
   * @param skillName - Policy/tool name to resolve.
   * @param args - Arguments passed to runtime hooks after admission.
   * @param context - Verified host tenant/user roles and execution scope.
   * @param skillExecutor - Asynchronous callback receiving final hook-modified arguments; called only after policy/hook admission.
   * @returns BLOCKED or PENDING_APPROVAL data when denied/deferred; otherwise the runtime execution result.
   * @throws Runtime pre-hook errors/rejections propagate; executor errors are normally returned as BLOCKED data.
   * @remarks An unregistered skill follows gatekeeper default policy. No approval is granted, recorded or resumed here; no cancellation/retry is provided.
   * @example
   * ```typescript
   * import { SkillGateBridge } from "@alneas/eaos-core/agentic/skill-gate-bridge";
   * import { McpGatekeeper } from "@alneas/eaos-core/security/gatekeeper";
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const bridge = new SkillGateBridge(new McpGatekeeper(), new AgentRuntime());
   * const context = { tenantId: "tenant-demo", userId: "user-demo", sessionId: "session-1", traceId: "trace-1", userRoles: ["member"] };
   * console.log(await bridge.evaluateAndExecuteSkill("notes.preview", {}, context, async () => ({ count: 0 })));
   * ```
   */
  async evaluateAndExecuteSkill<T = unknown>(
    skillName: string,
    args: Record<string, unknown>,
    context: AgentExecutionContext,
    skillExecutor: (args: Record<string, unknown>) => Promise<T>
  ) {
    // 1. Validate Gatekeeper policy
    const check = this.gatekeeper.validateCall({
      toolName: skillName,
      userRoles: context.userRoles,
      tenantId: context.tenantId,
      traceId: context.traceId,
    })

    if (!check.allowed) {
      return {
        success: false,
        status: 'BLOCKED' as const,
        error: check.reason,
        riskLevel: check.riskLevel,
      }
    }

    if (check.requireHumanApproval) {
      return {
        success: false,
        status: 'PENDING_APPROVAL' as const,
        approvalLevel: check.approvalLevel,
        riskLevel: check.riskLevel,
        error: `Human approval (${check.approvalLevel}) required before executing '${skillName}'`,
      }
    }

    // 2. Execute with AgentRuntime Pre/Post hooks
    return this.runtime.executeTool(skillName, args, context, skillExecutor)
  }
}
