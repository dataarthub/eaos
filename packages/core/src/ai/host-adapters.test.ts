import { describe, expect, test } from 'bun:test'
import { isAIHostReceiptSuccessful, isAIHostReceiptTerminal, type AIHostReceipt } from './host-adapters'

const receipt = (status: AIHostReceipt['status']): AIHostReceipt => ({
  adapterId: 'test-host',
  operation: 'test',
  receiptId: `receipt-${status}`,
  idempotencyKey: `key-${status}`,
  status,
  acceptedAt: '2026-09-18T00:00:00.000Z',
})

describe('AI host adapter receipts', () => {
  test('accepted and pending are not completion', () => {
    expect(isAIHostReceiptTerminal(receipt('accepted'))).toBe(false)
    expect(isAIHostReceiptTerminal(receipt('pending'))).toBe(false)
    expect(isAIHostReceiptSuccessful(receipt('accepted'))).toBe(false)
  })

  test('only completed is successful', () => {
    expect(isAIHostReceiptTerminal(receipt('completed'))).toBe(true)
    expect(isAIHostReceiptSuccessful(receipt('completed'))).toBe(true)
    expect(isAIHostReceiptTerminal(receipt('failed'))).toBe(true)
    expect(isAIHostReceiptTerminal(receipt('unavailable'))).toBe(true)
  })
})
