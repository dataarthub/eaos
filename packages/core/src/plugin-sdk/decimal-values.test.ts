import { test, expect } from 'bun:test'
import { assertDecimalValue, decimalToMinor, minorToDecimal, addDecimalValues, legacyNumberToDecimal } from './decimal-values'

test('exact decimal conversion handles currency scales without rounding',()=> {
 expect(decimalToMinor('12.34',2)).toBe(1234)
 expect(decimalToMinor('-0.01',2)).toBe(-1)
 expect(decimalToMinor('1.234',3)).toBe(1234)
 expect(decimalToMinor('0.1234',4)).toBe(1234)
 expect(minorToDecimal(-1,2)).toBe('-0.01')
 expect(addDecimalValues('0.1','0.2')).toBe('0.3')
 expect(addDecimalValues('-0.10','0.20')).toBe('0.10')
 expect(legacyNumberToDecimal(1e-6)).toBe('0.000001')
 expect(legacyNumberToDecimal(1e21)).toBe('1000000000000000000000')
 for(const [value,scale] of [['1.001',2],['1.1',0],['9007199254740992',0]] as const) expect(()=>decimalToMinor(value,scale)).toThrow()
})
test('decimal API rejects coercion, exponential notation and excess precision',()=> {
 for(const value of [1.2,'1e3','01.0','+1',' 1','1.','NaN','0.'+'1'.repeat(19),'1'.repeat(39),'1'.repeat(30)+'.'+'1'.repeat(9)]) expect(()=>assertDecimalValue(value)).toThrow()
 assertDecimalValue('1'.repeat(20)+'.'+'1'.repeat(18))
 expect(()=>addDecimalValues('9'.repeat(38),'1')).toThrow()
})
