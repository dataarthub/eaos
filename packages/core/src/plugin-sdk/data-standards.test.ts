import { expect, test } from 'bun:test'
import { assertBusinessDate, assertBusinessId, assertInstant, assertMoneyMinor, majorAmountToMinor, externalEntityId } from './data-standards'

test('external identity is stable and scopes tenant, provider account, entity and external key', () => {
 const identity = { system: 'neppan', scope: 'hotel-a', entityType: 'reservation', externalId: '001' }
 const id = externalEntityId('tenant-a', identity)
 expect(externalEntityId('tenant-a', {...identity})).toBe(id)
 for (const key of Object.keys(identity)) expect(externalEntityId('tenant-a', {...identity, [key]: 'different'})).not.toBe(id)
 expect(externalEntityId('tenant-b', identity)).not.toBe(id)
 expect(() => externalEntityId('tenant-a', {...identity, externalId: ' 001'})).toThrow()
 for (const value of ['', 'bad\nkey', ' key', 'x'.repeat(257)]) expect(() => assertBusinessId(value)).toThrow()
})
test('money never coerces or rounds and calendar dates are distinct from zoned instants', () => {
 assertMoneyMinor(1250); assertMoneyMinor(-1); assertMoneyMinor(0, true)
 for (const value of [1.01, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100']) expect(() => assertMoneyMinor(value)).toThrow()
 expect(() => assertMoneyMinor(-1, true)).toThrow()
 assertBusinessDate('2024-02-29'); assertInstant('2026-10-09T12:34:56+09:00')
 for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01']) expect(() => assertBusinessDate(value)).toThrow()
 for (const value of ['2026-10-09', '2026-10-09T12:34:56', '2026-02-30T00:00:00Z', '2026-10-09T24:00:00Z']) expect(() => assertInstant(value)).toThrow()
})

test('major-unit feeds convert exactly with the host scale, without guessing currency or rounding', () => {
 expect(majorAmountToMinor(12.34,100)).toBe(1234)
 expect(majorAmountToMinor(36000,1)).toBe(36000)
 expect(majorAmountToMinor(1e-6,1000000)).toBe(1)
 for (const [amount,scale] of [[1.001,100],[1.1,1],[2,3],[1e16,100],[NaN,1]]) expect(()=>majorAmountToMinor(amount!,scale!)).toThrow()
})
