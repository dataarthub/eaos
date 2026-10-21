import { describe, expect, it } from 'bun:test'
import { evaluateSkillEligibility, filterEligibleSkills, isSafeSkillDocumentPath } from './skills'

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
