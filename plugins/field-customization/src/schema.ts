/**
 * Display overrides and additive validation requirements for one schema field.
 *
 * @see FieldCustomizationService for a complete host integration example.
 */
export interface FieldCustomization {
 /**
 * Optional displayed field title, at most 2000 characters through the service.
 */
  display_label?: string;
/**
 * Optional input hint, at most 2000 characters.
 */
  placeholder?: string;
/**
 * Optional schema description/help, at most 2000 characters.
 */
  help_text?: string
 /**
 * True adds a requirement; false never removes base requirements.
 */
  is_required?: boolean;
/**
 * Display-only hidden flag; required base fields cannot be hidden through the service.
 */
  is_hidden?: boolean;
/**
 * Optional safe integer UI order with absolute value at most 10000.
 */
  display_order?: number
 /**
 * Required for a new custom_ field; forbidden for existing base fields.
 */
  type?: 'string' | 'number' | 'boolean';
/**
 * Nonempty list of at most 100 strings for new string fields only; each at most 2000 characters.
 */
  enum?: string[]
}
/**
 * Extensible JSON-schema-like object used for safe display projections.
 *
 * @see FieldCustomizationService for a complete host integration example.
 */
export interface ObjectSchema {
/**
 * Schema type; the service requires object.
 */
  type?: string;
/**
 * Canonical property schemas; required by the service.
 */
  properties?: Record<string, any>;
/**
 * Field keys whose validation requirement must be preserved.
 */
  required?: string[];
/**
 * Additional JSON Schema keywords preserved during projection.
 */
 [key: string]: any }
/**
 * Projects display overrides and additive custom fields onto a cloned object schema.
 *
 * Pure projection: existing validation constraints are never removed or weakened.
 * @typeParam T - JSON-schema-like object shape preserved by the projection.
 * @param base - Canonical object schema; original validation constraints are preserved.
 * @param fields - Overrides keyed by field name; new custom_ fields require a supported explicit type.
 * @returns A deep-cloned schema with display metadata and added required fields.
 * @throws May throw if base contains values unsupported by structuredClone.
 *
 * @remarks
 * This pure projection does not validate all service input constraints. Existing field types/enums remain unchanged; false is_required never removes a base requirement. Prototype keys and unknown non-custom fields are skipped.
 *
 * @example
 * ```typescript
 * import { applyFieldCustomizations } from '@alneas/eaos-plugins/field-customization/schema';
 * const schema = applyFieldCustomizations({ type: 'object', properties: { title: { type: 'string' } } }, { title: { display_label: 'Report title' }, custom_note: { type: 'string', help_text: 'Optional note' } });
 * ```
 */
export function applyFieldCustomizations<T extends ObjectSchema>(base: T, fields: Record<string, FieldCustomization>): T {
 const result = structuredClone(base), properties = result.properties ??= {}, required = new Set(result.required ?? [])
 for (const [key, field] of Object.entries(fields)) {
  if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
  let prop = properties[key]
  if (!prop && /^custom_[a-z][a-z0-9_]{0,55}$/.test(key) && field.type) prop = properties[key] = { type: field.type, ...(field.enum ? { enum: [...field.enum] } : {}) }
  if (!prop || typeof prop !== 'object') continue
  if (field.display_label !== undefined) prop.title = field.display_label
  if (field.help_text !== undefined) prop.description = field.help_text
  prop['x-ui'] = { ...prop['x-ui'], ...(field.display_label !== undefined ? { label: field.display_label } : {}), ...(field.placeholder !== undefined ? { placeholder: field.placeholder } : {}), ...(field.display_order !== undefined ? { order: field.display_order } : {}), ...(field.is_hidden !== undefined ? { hidden: field.is_hidden } : {}) }
  if (field.is_required) required.add(key)
 }
 if (required.size) result.required = [...required]
 return result
}
