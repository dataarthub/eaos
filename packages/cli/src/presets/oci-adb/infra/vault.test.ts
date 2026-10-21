import { describe, expect, test } from 'bun:test'
import { createOciVault, createOciVaultKey, createOciAuthToken, createOciVaultSecret } from './vault'

describe('OCI Vault / Key / AuthToken / Secret factories', () => {
  test('exports factory functions correctly', () => {
    expect(typeof createOciVault).toBe('function')
    expect(typeof createOciVaultKey).toBe('function')
    expect(typeof createOciAuthToken).toBe('function')
    expect(typeof createOciVaultSecret).toBe('function')
  })
})
