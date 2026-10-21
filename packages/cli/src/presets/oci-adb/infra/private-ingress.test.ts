import { expect, test } from 'bun:test'
import { defaultEoasPrivateIngressRules } from './index'
test('default split host traffic stays private and supports host-specific callers', () => {
  const rules = defaultEoasPrivateIngressRules('10.8.0.0/16', { kratosPublicSource: '10.8.1.10/32', workerApiSource: '10.8.1.11/32' }) as any[]
  expect(rules.map(rule => [rule.tcpOptions.min, rule.source])).toEqual([[4434, '10.8.0.0/16'], [4433, '10.8.1.10/32'], [3000, '10.8.1.11/32']])
  expect(rules.every(rule => rule.source !== '0.0.0.0/0')).toBe(true)
})
