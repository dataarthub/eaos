import { describe, expect, it } from 'bun:test'
import { evaluateSkillEligibility, filterEligibleSkills, isSafeSkillDocumentPath } from './skills'
import { evaluateAIRiskPolicy } from './governance'

describe('AI risk level and policy evaluation', () => {
  it('allows Level 1 read-only queries unconditionally', () => {
    const result = evaluateAIRiskPolicy(1)
    expect(result.allowed).toBe(true)
    expect(result.humanConfirmationRequired).toBe(false)
  })

  it('enforces human confirmation on Level 2 direct mutations', () => {
    const blocked = evaluateAIRiskPolicy(2, { isDirectMutation: true, hasHumanConfirmation: false })
    expect(blocked.allowed).toBe(false)
    expect(blocked.humanConfirmationRequired).toBe(true)
    expect(blocked.reason).toContain('Level 2')

    const confirmed = evaluateAIRiskPolicy(2, { isDirectMutation: true, hasHumanConfirmation: true })
    expect(confirmed.allowed).toBe(true)
    expect(confirmed.humanConfirmationRequired).toBe(false)
  })

  it('strictly forbids automated execution for Level 3 critical operations', () => {
    const level3WithoutConfirm = evaluateAIRiskPolicy(3, { isDirectMutation: true, hasHumanConfirmation: false })
    expect(level3WithoutConfirm.allowed).toBe(false)
    expect(level3WithoutConfirm.humanConfirmationRequired).toBe(true)
    expect(level3WithoutConfirm.reason).toContain('Level 3')

    const level3EvenWithConfirm = evaluateAIRiskPolicy(3, { isDirectMutation: true, hasHumanConfirmation: true })
    expect(level3EvenWithConfirm.allowed).toBe(false)
  })
})

describe('AI skill eligibility', () => {
  it('evaluates all host-provided requirements without reading process state', () => {
    const skill = { requirements: { os: ['darwin'] as const, bins: ['opencode'], anyBins: ['goose', 'codex'], env: ['OPENAI_API_KEY'], config: ['~/.config/opencode'] } }
    expect(evaluateSkillEligibility(skill, { os: 'darwin', bins: ['opencode', 'codex'], env: ['OPENAI_API_KEY'], config: ['~/.config/opencode'] })).toEqual({ eligible: true, missing: [] })
    expect(evaluateSkillEligibility(skill, { os: 'linux', bins: ['node'] })).toEqual({ eligible: false, missing: ['os:linux', 'bin:opencode', 'anyBin:goose|codex', 'env:OPENAI_API_KEY', 'config:~/.config/opencode'] })
  })

  it('filters a catalog while preserving declared order', () => {
    const skills = [
      { id: 'always', name: 'Always', description: 'Always available' },
      { id: 'mac', name: 'Mac', description: 'Mac only', requirements: { os: ['darwin'] as const } },
    ]
    expect(filterEligibleSkills(skills, { os: 'linux' }).map(skill => skill.id)).toEqual(['always'])
  })

  it('requires Host adapters without inspecting provider credentials', () => {
    const skill = { requirements: { adapters: ['calendar', 'workspace'] as const } }
    expect(evaluateSkillEligibility(skill, { os: 'darwin', adapters: ['calendar'] })).toEqual({ eligible: false, missing: ['adapter:workspace'] })
    expect(evaluateSkillEligibility(skill, { os: 'darwin', adapters: new Set(['calendar', 'workspace']) })).toEqual({ eligible: true, missing: [] })
    expect(evaluateSkillEligibility({ requirements: { adapters: ['retrieval'] } }, { os: 'darwin', adapters: ['retrieval'] })).toEqual({ eligible: true, missing: [] })
  })

  it('accepts only package-relative Skill documents', () => {
    expect(isSafeSkillDocumentPath('skills/repair-triage/SKILL.md')).toBe(true)
    expect(isSafeSkillDocumentPath('/tmp/SKILL.md')).toBe(false)
    expect(isSafeSkillDocumentPath('skills/../secret/SKILL.md')).toBe(false)
    expect(isSafeSkillDocumentPath('skills/repair-triage/README.md')).toBe(false)
  })
})
