import type { EligibilityRequirements } from './eligibility'

/**
 * Shared resolved procedure plan shape; plugins provide their binding type.
 *   * @typeParam TBinding - Plugin-specific target binding resolved by host procedure logic; defaults to unknown.
 *
 * @example
 * ```typescript
 * import { type ProcedureExecutionPlan } from "@alneas/eaos-core/plugin-sdk/procedure";
 * const plan: ProcedureExecutionPlan<{ recordId: string }> = { tenantId: "tenant-demo", binding: { recordId: "record-1" }, units: [] };
 * console.log(plan.units.length); // 0
 * ```
 */
export interface ProcedureExecutionPlan<TBinding = unknown> {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
  
  /** Plugin-specific resolved target binding shared by the procedure plan units. */
  binding: TBinding
  
/** Resolved procedure work units in host-defined plan order. */
  units: {
    
    /** Stable setting or procedure-unit lookup key interpreted by the host. */
    key: string
    
    /** Human-readable draft, task, file or event title displayed by the host. */
    title: string
    
/** Role responsible for performing the procedure unit. */
    ownerRole: string
    
/** Category of resource to which the procedure unit applies. */
    targetType: string
    
/** Optional human-readable target scope. */
    targetDescription?: string
    
    /** Reported success/failure/denial/unknown category; reconcile uncertain effects before retrying. */
    outcome: string
    
/** Named prerequisites that the host must satisfy before starting the unit. */
    prerequisites: string[]
    
/** Other unit keys whose completion precedes this unit. */
    dependsOn: string[]
    
/** Optional host credential references required for the unit. */
    qualificationRequirements?: string[]
    
/** Optional event/manual/predecessor activation metadata interpreted by the host. */
    trigger?: { 
  /** Whether the host activates this unit from an event, manually or after its predecessor. */
  kind: 'event' | 'manual' | 'predecessor'; 
  /** Stable setting or procedure-unit lookup key interpreted by the host. */
  key: string; 
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description: string }
    
/** Optional site-specific evidence or setting requirements for the work unit. */
    siteRequirements?: { 
  /** Stable site requirement identity used for evidence/configuration binding. */
  id: string; 
  /** Human-readable navigation/node/setting label displayed by the host. */
  label: string; 
  /** Site requirement input/evidence kind expected by the host UI. */
  kind: 'text' | 'document' | 'role' | 'duration' | 'number' }[]
    
/** Optional host scheduling rule text for this work unit. */
    dueRule?: string
    
/** Optional conditional exception handling and escalation definitions. */
    exceptions?: { 
  /** Stable exception-path identity within the procedure unit. */
  id: string; 
  /** Data-only routing predicate or host-reviewed instruction; no expression string is executed by Core. */
  condition: string; 
  /** Named host action performed or requested; procedure exception entries use this as the response instruction. */
  action: string; 
/** Role receiving the exception escalation. */
  escalateToRole: string; 
/** Human-readable condition required before resuming an exception path. */
  resumeWhen: string }[]
    
/** Optional next/rework/reinspection transitions and their output requirements. */
    handoffs?: { 
/** Target unit reference for a procedure handoff. */
  unitRef: string; 
  /** Handoff relationship: next work, rework or reinspection. */
  kind: 'next' | 'rework' | 'reinspect'; 
/** Outcome that activates this handoff. */
  when: 'accepted' | 'failed' | 'corrected'; 
/** Scope used by the host to resolve target occurrences/issues for the handoff. */
  targetBinding: 'same_target_occurrence' | 'each_open_issue' | 'source_inspection'; 
/** Whether the host creates or reopens the handoff execution. */
  execution: 'create' | 'reopen'; 
/** Named evidence/output artifacts required by the handoff. */
  deliverables: string[] }[]
    
/** Optional exact training/qualification requirements checked by host services. */
    eligibility?: EligibilityRequirements
    
    /** Ordered probe results or procedure check requirements; the owning host performs the actual checks. */
    checks: { 
  /** Stable check identity within the procedure unit. */
  id: string; 
/** Actionable procedure check instruction. */
  instruction: string; 
  
  /** Whether this procedure check is critical to host acceptance policy. */
  critical: boolean; 
/** Whether acceptance/check completion requires evidence under host policy. */
  evidenceRequired: boolean; 
  
  /** Optional check timing: before, during or before_handoff; host procedure logic applies it. */
  phase?: 'before' | 'during' | 'before_handoff'; 
/** Optional criterion used to judge a procedure check. */
  passCriterion?: string; 
/** Allowed evidence kinds for this procedure check. */
  evidenceTypes?: ('observation' | 'number' | 'photo' | 'document_ref' | 'recipient_ack')[]; 
/** Whether this check always applies or depends on a host-evaluated condition. */
  applicability?: { 
  /** Whether the procedure check always applies or requires a host-evaluated condition. */
  kind: 'always' | 'conditional'; 
  /** Data-only routing predicate or host-reviewed instruction; no expression string is executed by Core. */
  condition?: string }; 
/** Optional host action/instruction when this check fails. */
  onFailure?: string; 
/** Optional measurement unit and criterion-setting binding. */
  measurement?: { 
  
  /** Measurement unit used with the referenced criterion setting. */
  unit: string; 
/** Host setting identity supplying the measurement acceptance criterion. */
  criterionSettingId: string }; 
/** When the host requires this check: each execution, site setup or continuously. */
  frequency?: 'per_execution' | 'site_setup' | 'continuous' }[]
    
/** Reviewer independence, evidence, unresolved-issue and release requirements for the unit. */
    acceptance: { 
/** Whether the host must require a reviewer distinct from execution ownership. */
  independentReviewer: boolean; 
/** Optional role permitted to accept the work unit. */
  reviewerRole?: string; 
/** Optional roles/identities from which the reviewer must be independent. */
  separateFrom?: string[]; 
/** Whether acceptance/check completion requires evidence under host policy. */
  evidenceRequired: boolean; 
/** Whether open issues block acceptance or may remain pending source-issue reinspection. */
  unresolvedIssues: 'block' | 'allow_source_issue_pending_reinspection'; 
/** Optional acceptance release category communicated to downstream host workflows. */
  release?: 'none' | 'room_ready' | 'next_work' }
  }[]
}
