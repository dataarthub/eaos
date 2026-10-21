import { expect, test } from 'bun:test'
import { assertJsonDocumentContracts, createJsonDocumentAssertion, type JsonDocumentContract } from './json-documents'
const document: JsonDocumentContract = {id:'fixture.json',version:'1.0.0',table:'records',column:'plugin_data',namespace:'ota',jsonPath:'$.plugins.ota.neppan',schema:{type:'object',additionalProperties:false,properties:{at:{type:'string',format:'date-time'}},required:['at']}}
const tables = new Map([['records',{properties:{plugin_data:{type:'string'}}}]])
test('JSON contracts enforce owned path boundaries, physical columns, versions and non-ambiguous routes',()=>{
 assertJsonDocumentContracts([document],tables)
 for (const invalid of [{...document,jsonPath:'$.plugins.otaOther.neppan'},{...document,version:'next'},{...document,column:'missing'},{...document,schema:{type:'object'}}]) expect(()=>assertJsonDocumentContracts([invalid],tables)).toThrow()
 expect(()=>assertJsonDocumentContracts([document,{...document,id:'fixture.other'}],tables)).toThrow()
})
test('strict document assertions do not coerce, add defaults, mutate callers or fetch external schemas',()=>{
 const validate = createJsonDocumentAssertion(document)
 const value = {at:'2026-10-09T12:00:00Z'}
 validate(value);expect(value).toEqual({at:'2026-10-09T12:00:00Z'})
 for(const bad of [{at:100},{at:'2026-02-30T00:00:00Z'},{...value,unknown:true},{at:undefined},{}]) expect(()=>validate(bad)).toThrow()
 expect(()=>createJsonDocumentAssertion({...document,schema:{type:'object',additionalProperties:false,properties:{value:{$ref:'https://example.invalid/unknown'}}}})).toThrow()
})

test('document size uses UTF-8 and schemas must have a valid bounded byte policy',()=>{
 const compact={...document,maxBytes:20,schema:{type:'object',additionalProperties:false,properties:{text:{type:'string'}},required:['text']}}
 const validate=createJsonDocumentAssertion(compact)
 validate({text:'abcd'})
 expect(()=>validate({text:'あいうえ'})).toThrow('byte limit')
 expect(()=>createJsonDocumentAssertion({...compact,maxBytes:0})).toThrow('byte limit')
})
