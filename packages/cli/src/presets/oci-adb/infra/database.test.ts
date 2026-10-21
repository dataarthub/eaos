import { describe, expect, test } from 'bun:test'
import { selectAdbConnectionProfile, type AdbConnectionProfile } from './database'

const profile: AdbConnectionProfile = { consumerGroup: 'LOW', tlsAuthentication: 'SERVER', protocol: 'TCPS', hostFormat: 'FQDN', syntaxFormat: 'LONG', sessionMode: 'DIRECT', value: 'provider-dsn' }
describe('ADB connection selection', () => {
  test('selects TLS without guessing from the first profile or rewriting its DSN', () => {
    expect(selectAdbConnectionProfile([{ profiles: [{ ...profile, tlsAuthentication: 'MUTUAL', value: 'wallet-dsn' }, { ...profile, protocol: 'TCP' }, profile] }])).toBe('provider-dsn')
    expect(selectAdbConnectionProfile([{ profiles: [{ ...profile, tlsAuthentication: 'MUTUAL' }] }], { tlsAuthentication: 'MUTUAL' })).toBe('provider-dsn')
  })
  test('rejects missing, empty and ambiguous profiles, even with identical DSNs', () => {
    for (const groups of [[], [{}], [{ profiles: [{ ...profile, value: '' }] }], [{ profiles: [profile, profile] }], [{ profiles: [{ ...profile, tlsAuthentication: 'MUTUAL' }] }]]) {
      expect(() => selectAdbConnectionProfile(groups)).toThrow('exactly one')
    }
  })
  test('host metadata resolves ambiguity; false regional flag is retained', () => {
    const regional = { ...profile, isRegional: true, value: 'regional' }
    const local = { ...profile, isRegional: false, value: 'local' }
    expect(selectAdbConnectionProfile([{ profiles: [regional, local] }], { isRegional: false, sessionMode: 'DIRECT' })).toBe('local')
  })
  test('failed selection never includes the DSN in diagnostics', () => {
    const sensitive = { ...profile, value: 'secret-dsn-marker' }
    try { selectAdbConnectionProfile([{ profiles: [sensitive, sensitive] }]) }
    catch (error) { expect(String(error)).not.toContain(sensitive.value); return }
    throw new Error('Expected ambiguous selection to fail')
  })
})
