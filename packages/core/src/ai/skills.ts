import type { SkillCatalogEntry, SkillRequirement } from './governance'

/**
 * Check the restricted relative path shape used for packaged skill documents.
 * @param path - Candidate path; must begin skills/, end /SKILL.md, and contain neither .. nor backslashes.
 * @returns Whether the path meets the lexical check; no filesystem access occurs.
 * @remarks The host loader remains responsible for safe package/filesystem resolution.
 * @example
 * ```typescript
 * import { isSafeSkillDocumentPath } from "@alneas/eaos-core/ai/skills";
 * console.log(isSafeSkillDocumentPath("skills/review/SKILL.md")); // true
 * ```
 */
export function isSafeSkillDocumentPath(path: string): boolean {
  return path.startsWith('skills/') && path.endsWith('/SKILL.md') && !path.includes('..') && !path.includes('\\')
}

/**
 * Runtime facts supplied by a trusted host when selecting eligible skills.
 * @see {@link evaluateSkillEligibility}
 */
export interface SkillRuntimeAvailability {
  
/** Supported/current host operating system used by skill eligibility. */
  os: 'darwin' | 'linux' | 'win32'
  
/** Executable names that must all be present in trusted host availability. */
  bins?: ReadonlySet<string> | readonly string[]
  
/** Required/available environment variable names only; secret values are not stored here. */
  env?: ReadonlySet<string> | readonly string[]
  
/** Host configuration metadata; plugin/node configuration is data and does not execute code by itself. */
  config?: ReadonlySet<string> | readonly string[]
  
/** Required/available host capability families used during skill eligibility checks. */
  adapters?: ReadonlySet<string> | readonly string[]
}

/**
 * Eligibility and ordered descriptors for unmet requirements.
 * @see {@link evaluateSkillEligibility}
 */
export interface SkillEligibilityResult {
  
/** Whether all declared host requirements were satisfied. */
  eligible: boolean
  
/** Ordered unmet requirement descriptors; an empty array accompanies eligible true. */
  missing: readonly string[]
}

/**
 * Evaluates skill requirements without reading host process state from core.
 * @param skill - Skill requirement metadata; missing requirements mean no restrictions.
 * @param availability - Host OS and available binaries, environment/config names and adapters; missing collections satisfy no entries.
 * @returns Eligibility plus ordered missing requirement descriptors; empty missing means eligible.
 * @example
 * ```typescript
 * import { evaluateSkillEligibility } from "@alneas/eaos-core/ai/skills";
 * console.log(evaluateSkillEligibility({ requirements: { bins: ["git"] } }, { os: "linux", bins: ["git"] }));
 * ```
 */
export function evaluateSkillEligibility(
  skill: Pick<SkillCatalogEntry, 'requirements'>,
  availability: SkillRuntimeAvailability,
): SkillEligibilityResult {
  const requirements: SkillRequirement = skill.requirements ?? {}
  const missing: string[] = []
  const has = (values: ReadonlySet<string> | readonly string[] | undefined, value: string) => values instanceof Set ? values.has(value) : Array.isArray(values) ? values.includes(value) : false

  if (requirements.os?.length && !requirements.os.includes(availability.os)) missing.push(`os:${availability.os}`)
  for (const bin of requirements.bins ?? []) if (!has(availability.bins, bin)) missing.push(`bin:${bin}`)
  if (requirements.anyBins?.length && !requirements.anyBins.some(bin => has(availability.bins, bin))) missing.push(`anyBin:${requirements.anyBins.join('|')}`)
  for (const env of requirements.env ?? []) if (!has(availability.env, env)) missing.push(`env:${env}`)
  for (const config of requirements.config ?? []) if (!has(availability.config, config)) missing.push(`config:${config}`)
  for (const adapter of requirements.adapters ?? []) if (!has(availability.adapters, adapter)) missing.push(`adapter:${adapter}`)

  return { eligible: missing.length === 0, missing }
}

/**
 * Select skills whose requirements are satisfied by host availability.
 * @typeParam T - Skill metadata containing optional requirements; returned elements retain this type.
 * @param skills - Candidates in the desired output order.
 * @param availability - Trusted host facts passed to evaluateSkillEligibility.
 * @returns A new array preserving candidate order and original skill references; empty when none qualify.
 * @example
 * ```typescript
 * import { filterEligibleSkills } from "@alneas/eaos-core/ai/skills";
 * const skills = [{ requirements: { bins: ["git"] } }];
 * console.log(filterEligibleSkills(skills, { os: "linux", bins: ["git"] }).length); // 1
 * ```
 */
export function filterEligibleSkills<T extends Pick<SkillCatalogEntry, 'requirements'>>(
  skills: readonly T[],
  availability: SkillRuntimeAvailability,
): readonly T[] {
  return skills.filter(skill => evaluateSkillEligibility(skill, availability).eligible)
}
