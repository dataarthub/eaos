import { test, expect } from 'bun:test'
import { loadRecordReference, recordReferenceLabel, recordFormSchema, recordFormValues, scopedUiRecord } from './record-workspace'

test('record forms strip transport scope and workflow-only fields, retain typed values and reject foreign records', () => {
 const schema = { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string' }, tenantId: { type: 'string' }, revision: { type: 'integer' }, rent: { type: 'integer' }, ownerId: { type: 'string', minLength: 1 } }, required: ['name'] }
 const form = recordFormSchema(schema, ['status', 'tenantId', 'revision'])
 expect(recordFormValues(form as any, { name: 'Property', status: 'approved', tenantId: 'other', revision: 99, rent: 0, ownerId: '' })).toEqual({ name: 'Property', rent: 0 })
 expect(() => scopedUiRecord({ id: 'one', tenantId: 'other', revision: 1 }, 'tenant')).toThrow()
 expect(() => scopedUiRecord({ id: 'one', tenantId: 'tenant', revision: 0 }, 'tenant')).toThrow()
 expect(scopedUiRecord({ id: 'one', tenantId: 'tenant', revision: 1 }, 'tenant').id).toBe('one')
 expect(recordFormValues({ properties: { status: { enum: ['active', 'archived'] }, limit: { type: 'integer' } } }, { status: '', limit: '' })).toEqual({})
})

// Optional patterned fields stay omitted instead of sending a schema-invalid blank.
test('blank optional currency is omitted while explicit typed values are retained', () => {
 const schema = { type: 'object', properties: { currency: { type: 'string', pattern: '^[A-Z]{3}$' } } }
 expect(recordFormValues(schema, { currency: '' })).toEqual({})
 expect(recordFormValues(schema, { currency: 'JPY' })).toEqual({ currency: 'JPY' })
})

const reference = { field: 'propertyId', title: '物件を選択', pluginId: 'estate-properties', listOperation: 'estate_properties_list', listKey: 'properties', displayFields: ['name', 'address'] }
test('relation candidates include later pages and use authorized names, with no false complete truncated response', async () => {
 const inputs: Record<string, unknown>[] = []
 const client = { load: async () => { throw Error('unused') }, execute: async (operation: string, input: Record<string, unknown>) => {
  expect(operation).toBe(reference.listOperation); inputs.push(input)
  return { tenantId: 'tenant', recordId: reference.pluginId, revision: 0, data: { properties: [{ tenantId: 'tenant', id: input.cursor ? 'second' : 'first', revision: 1, name: input.cursor ? '二ページ目' : '最初', address: '住所' }], ...(input.cursor ? {} : { nextCursor: 'page2', mayHaveMore: true }) } }
 } }
 const records = await loadRecordReference(reference, 'tenant', client)
 expect(records.map(row => row.record.id)).toEqual(['first', 'second'])
 expect(inputs).toEqual([{ limit: 100 }, { limit: 100, cursor: 'page2' }])
 expect(records[1].label).toBe('二ページ目 / 住所')
 await expect(loadRecordReference(reference, 'tenant', { ...client, execute: async () => ({ tenantId: 'tenant', recordId: reference.pluginId, revision: 0, data: { properties: [], mayHaveMore: true } }) })).rejects.toThrow('続き')
})
test('relation loading rejects foreign records, duplicate cursors and responses after a session is cancelled', async () => {
 const snapshot = (record: Record<string, unknown>, nextCursor?: string) => ({ tenantId: 'tenant', recordId: reference.pluginId, revision: 0, data: { properties: [record], ...(nextCursor ? { nextCursor } : {}) } })
 const client = { load: async () => { throw Error('unused') }, execute: async () => snapshot({ tenantId: 'other', id: 'foreign', revision: 1 }) }
 await expect(loadRecordReference(reference, 'tenant', client)).rejects.toThrow('範囲')
 let count = 0
 await expect(loadRecordReference(reference, 'tenant', { ...client, execute: async () => snapshot({ tenantId: 'tenant', id: String(++count), revision: 1 }, 'same') })).rejects.toThrow('ページ')
 const controller = new AbortController()
 await expect(loadRecordReference(reference, 'tenant', { ...client, execute: async () => { controller.abort(); return snapshot({ tenantId: 'tenant', id: 'stale', revision: 1 }) } }, controller.signal)).rejects.toThrow('Stale response')
})

test('related labels resolve through authorized catalogs and never overwrite command IDs or trust inline names',async()=>{
 const property={tenantId:'tenant',id:'property',revision:1,name:'青空マンション'}
 const unitReference={field:'unitId',title:'住戸を選択',pluginId:'estate-units',listOperation:'estate_units_list',listKey:'units',displayFields:['propertyId','unitNumber'],references:[reference]}
 const unit={tenantId:'tenant',id:'room',revision:1,propertyId:'property',unitNumber:'101',displayName:'fabricated'}
 const transport=(definition:any)=>({load:async()=>{throw Error('unused')},execute:async()=>({tenantId:'tenant',recordId:definition.pluginId,revision:0,data:{[definition.listKey]:definition.pluginId==='estate-units'?[unit]:[property]}})})
 const candidates=await loadRecordReference(unitReference,'tenant',transport(unitReference),undefined,transport)
 expect(candidates[0].label).toBe('青空マンション / 101')
 expect(candidates[0].record.id).toBe('room')
 expect(candidates[0].record.propertyId).toBe('property')
 const forged=(definition:any)=>({...transport(definition),execute:async()=>({tenantId:'tenant',recordId:definition.pluginId,revision:0,data:{[definition.listKey]:[{...property,tenantId:'other'}]}})})
 await expect(loadRecordReference(unitReference,'tenant',transport(unitReference),undefined,forged)).rejects.toThrow('範囲')
 expect(recordReferenceLabel(reference,property)).toBe('青空マンション')
})

test('AI-to-UI draft pattern: accepts draft proposal and preserves deterministic form inputs', () => {
 const schema = { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'integer' } }, required: ['name'] }
 const form = recordFormSchema(schema, [])
 const draftValues = { name: 'AI抽出物件', amount: 120000, unverifiedNoise: 'ignored' }
 const parsed = recordFormValues(form as any, draftValues)
 expect(parsed).toEqual({ name: 'AI抽出物件', amount: 120000 })
 expect(parsed).not.toHaveProperty('unverifiedNoise')
})
