import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SecretResolver } from '../src/secrets/secret-resolver'

describe('SecretResolver (Fail-Fast & Multi-Provider)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    SecretResolver.clearCache()
    delete process.env.TEST_SECRET_KEY
    delete process.env.OCI_VAULT_OCID
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('resolves secret successfully from process.env (BWS / Docker env)', async () => {
    process.env.TEST_SECRET_KEY = 'valid-bws-token'
    const secret = await SecretResolver.getSecret('TEST_SECRET_KEY', true)
    expect(secret).toBe('valid-bws-token')
  })

  it('throws critical error when required secret is missing (Fail-Fast)', async () => {
    expect(SecretResolver.getSecret('MISSING_REQUIRED_KEY', true)).rejects.toThrow(
      '[CRITICAL SECRET FAILURE]'
    )
  })

  it('returns empty string without error for optional missing secrets', async () => {
    const secret = await SecretResolver.getSecret('OPTIONAL_KEY', false)
    expect(secret).toBe('')
  })
})
