/**
 * Exact, bounded decimal strings. No implicit rounding or binary-float arithmetic.
 * @see {@link decimalToMinor}
 */
export const decimalValueSchema = {
 /** Decimal values use exact text instead of binary floating-point numbers. */
 type: 'string',
 /** Maximum serialized decimal text length, including sign and decimal point. */
 maxLength: 40,
 /** ASCII decimal notation with at most 38 digits and scale 18, without exponent or leading plus/zeroes. */
 pattern: '^(?=(?:[^0-9]*[0-9]){1,38}[^0-9]*$)-?(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,18})?$',
} as const
/**
 * Validate a bounded exact decimal string.
 * @param value - Decimal text without exponent notation, leading plus or leading zeroes; at most 38 digits, scale 18, length 40.
 * @returns No value; successful completion narrows value to string.
 * @throws Error when the value violates decimalValueSchema.
 * @example
 * ```typescript
 * import { assertDecimalValue } from "@alneas/eaos-core/plugin-sdk/decimal-values";
 * assertDecimalValue("12.50");
 * ```
 */
export function assertDecimalValue(value: unknown): asserts value is string {
 if (typeof value !== 'string' || value.length > 40 || !new RegExp(decimalValueSchema.pattern).test(value)) throw Error('Exact decimal string required (38 digits, scale <= 18)')
}
function parts(value: string): { coefficient: bigint; scale: number } {
 assertDecimalValue(value)
 const [whole, fraction = ''] = value.split('.')
 return { coefficient: BigInt(whole + fraction), scale: fraction.length }
}
function format(coefficient: bigint, scale: number): string {
 const negative = coefficient < 0n, digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0')
 const value = (negative ? '-' : '') + (scale ? digits.slice(0,-scale) + '.' + digits.slice(-scale) : digits)
 assertDecimalValue(value)
 return value
}
/**
 * Convert exact decimal text to a safe integer without rounding.
 * @param value - Decimal text accepted by assertDecimalValue.
 * @param minorUnits - Power-of-ten exponent from 0 to 18, such as 2 for cents.
 * @returns The safe integer amount in minor units.
 * @throws Error for invalid decimal/exponent, required rounding or a result outside the safe integer range.
 * @example
 * ```typescript
 * import { decimalToMinor } from "@alneas/eaos-core/plugin-sdk/decimal-values";
 * console.log(decimalToMinor("12.50", 2)); // 1250
 * ```
 */
export function decimalToMinor(value: string, minorUnits: number): number {
 if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 18) throw Error('Explicit minor-unit exponent required')
 const { coefficient, scale } = parts(value), shift = minorUnits - scale
 const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n
 if (coefficient % divisor !== 0n) throw Error('Decimal cannot be represented without rounding')
 const result = Number(shift < 0 ? coefficient / divisor : coefficient * 10n ** BigInt(shift))
 if (!Number.isSafeInteger(result)) throw Error('Minor amount exceeds safe integer range')
 return result
}
/**
 * Format a safe integer amount at an explicit decimal scale.
 * @param value - Safe integer amount in minor units.
 * @param minorUnits - Power-of-ten exponent from 0 to 18.
 * @returns Exact decimal text retaining the requested scale.
 * @throws Error for an unsafe integer, invalid exponent or a formatted value exceeding decimalValueSchema.
 * @example
 * ```typescript
 * import { minorToDecimal } from "@alneas/eaos-core/plugin-sdk/decimal-values";
 * console.log(minorToDecimal(1250, 2)); // 12.50
 * ```
 */
export function minorToDecimal(value: number, minorUnits: number): string {
 if (!Number.isSafeInteger(value) || !Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 18) throw Error('Invalid minor amount or exponent')
 return format(BigInt(value),minorUnits)
}
/**
 * Add two exact decimal strings using bigint coefficients.
 * @param left - First valid decimal string.
 * @param right - Second valid decimal string.
 * @returns Their exact sum, using the larger input scale.
 * @throws Error for invalid input or a sum exceeding decimalValueSchema.
 * @example
 * ```typescript
 * import { addDecimalValues } from "@alneas/eaos-core/plugin-sdk/decimal-values";
 * console.log(addDecimalValues("0.10", "0.20")); // 0.30
 * ```
 */
export function addDecimalValues(left: string, right: string): string {
 const a = parts(left), b = parts(right), scale = Math.max(a.scale,b.scale)
 return format(a.coefficient * 10n ** BigInt(scale-a.scale) + b.coefficient * 10n ** BigInt(scale-b.scale),scale)
}
/**
 * Explicit adapter for existing numeric feeds, preserving their displayed decimal value.
 * @param value - Finite JavaScript number; any precision already lost in the number cannot be recovered.
 * @returns Decimal text without exponent notation.
 * @throws Error for a nonfinite number or output exceeding decimalValueSchema.
 * @example
 * ```typescript
 * import { legacyNumberToDecimal } from "@alneas/eaos-core/plugin-sdk/decimal-values";
 * console.log(legacyNumberToDecimal(1e-7)); // 0.0000001
 * ```
 */
export function legacyNumberToDecimal(value: number): string {
 if (!Number.isFinite(value)) throw Error('Finite legacy number required')
 const [digits, exponent = '0'] = String(value).toLowerCase().split('e')
 const [whole, fraction = ''] = digits!.split('.'), shift = Number(exponent) - fraction.length
 return shift >= 0 ? format(BigInt(whole!+fraction)*10n**BigInt(shift),0) : format(BigInt(whole!+fraction),-shift)
}
