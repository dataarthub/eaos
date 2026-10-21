/**
 * Shared eligibility contract used by training, procedure and task plugins.
 * @see {@link eligibilityRequirementsSchema}
 */
export interface EligibilityCourseRequirement {
  
/** Logical provider/plugin namespace used to prevent ownership collisions. */
  namespace: string
  
  /** Course identity within the named training namespace. */
  id: string
  
  /** Exact three-component numeric course version required by eligibility. */
  version: string
  
/** Exact course-content digest required to match the requested revision. */
  contentHash: string
}

/**
 * Issuer-qualified credential identity required for eligibility.
 * @see {@link eligibilityRequirementsSchema}
 */
export interface EligibilityQualificationRequirement {
  
/** Credential-issuing authority used to disambiguate qualification IDs. */
  issuer: string
  
  /** Credential identity within its issuing authority. */
  id: string
}

/**
 * Course and qualification requirements evaluated by host training/credential services.
 * @see {@link eligibilityRequirementsSchema}
 */
export interface EligibilityRequirements {
  
/** Exact course namespace/ID/version/content-hash requirements, or their satisfaction results. */
  courses: EligibilityCourseRequirement[]
  
/** Issuer-qualified credential requirements, or their satisfaction results. */
  qualifications: EligibilityQualificationRequirement[]
}

/**
 * Tenant/user eligibility decision with per-requirement satisfaction evidence and check time.
 * @see {@link eligibilityRequirementsSchema}
 */
export interface EligibilityResult {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Stable identity of the eligibility requirements evaluated for this result. */
  requirementsHash: string
  
/** Whether all declared host requirements were satisfied. */
  eligible: boolean
  
/** Timestamp associated with the reported evaluation or measurement. */
  checkedAt: string
  
/** Exact course namespace/ID/version/content-hash requirements, or their satisfaction results. */
  courses: { 
/** Exact requirement whose satisfaction is reported by this entry. */
  requirement: EligibilityCourseRequirement; 
/** Whether the host eligibility check found evidence meeting this requirement. */
  satisfied: boolean }[]
  
/** Issuer-qualified credential requirements, or their satisfaction results. */
  qualifications: { 
/** Exact requirement whose satisfaction is reported by this entry. */
  requirement: EligibilityQualificationRequirement; 
/** Whether the host eligibility check found evidence meeting this requirement. */
  satisfied: boolean }[]
}

/**
 * Closed JSON Schema limiting course and qualification requirement arrays to 50 entries each.
 * @see {@link eligibilityRequirementsSchema}
 *
 * @example
 * ```typescript
 * import { eligibilityRequirementsSchema } from "@alneas/eaos-core/plugin-sdk/eligibility";
 * console.log(eligibilityRequirementsSchema.properties.courses.maxItems); // 50
 * ```
 */
export const eligibilityRequirementsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['courses', 'qualifications'],
  properties: {
    courses: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['namespace', 'id', 'version', 'contentHash'],
        properties: {
          namespace: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
          id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' },
          version: { type: 'string', pattern: '^\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}$' },
          contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        },
      },
    },
    qualifications: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issuer', 'id'],
        properties: {
          issuer: { type: 'string', minLength: 1, maxLength: 100 },
          id: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
  },
} as const
