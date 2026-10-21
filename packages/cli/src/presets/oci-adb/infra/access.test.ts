import { describe, expect, test } from 'bun:test'
import { createOciNlbIngressRules } from './access'

describe('createOciNlbIngressRules', () => {
  test('generates default ingress rules for ports 80 and 443', () => {
    const rules = createOciNlbIngressRules()
    expect(rules).toHaveLength(2)

    const httpRule = rules.find(r => r.tcpOptions?.min === 80)
    expect(httpRule).toBeDefined()
    expect(httpRule?.source).toBe('0.0.0.0/0')
    expect(httpRule?.protocol).toBe('6')
    expect(httpRule?.description).toContain('Client IP preserved')

    const httpsRule = rules.find(r => r.tcpOptions?.min === 443)
    expect(httpsRule).toBeDefined()
    expect(httpsRule?.source).toBe('0.0.0.0/0')
  })

  test('allows custom ports and CIDRs', () => {
    const rules = createOciNlbIngressRules({
      ports: [3000, 8080],
      allowedCidrs: ['192.168.1.0/24', '10.0.0.0/16'],
      descriptionPrefix: 'MyService',
    })

    expect(rules).toHaveLength(4)
    expect(rules.every(r => r.description?.includes('MyService'))).toBe(true)
  })
})
