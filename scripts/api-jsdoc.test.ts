import {test,expect} from 'bun:test'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {readApiJSDoc,renderJSDocDetails,rewriteJSDocLinks,publicJSDocMembers} from './api-jsdoc'
const ts=createRequire(new URL('../packages/core/package.json',import.meta.url))('typescript')
function symbol(text:string,name:string){
 const path='/virtual-fixture.ts',source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true),host=ts.createCompilerHost({noLib:true})
 host.getSourceFile=(file:string)=>file===path?source:undefined;host.fileExists=(file:string)=>file===path;host.readFile=(file:string)=>file===path?text:undefined
 const program=ts.createProgram([path],{noLib:true},host),checker=program.getTypeChecker()
 return {checker,symbol:checker.getExportsOfModule(checker.getSymbolAtLocation(source)).find((s:any)=>s.name===name)}
}
test('API cards retain source parameter semantics, return description and actual example',()=>{
 const fixture=symbol(`/** Read a bounded number of records.\n * @param limit - Maximum records; zero returns an empty list.\n * @returns The matching records in source order.\n * @throws When the source cannot be read.\n * @remarks Reading does not change authorization.\n * @example\n * import { readRecords } from '@example/records'\n * const records = readRecords(0)\n */\nexport function readRecords(limit:number):string[]{return []}`,'readRecords')
 const docs=readApiJSDoc(fixture.symbol,fixture.checker)
 expect(docs.parameters.get('limit')).toContain('zero returns an empty list')
 expect(docs.returns).toContain('source order')
 expect(docs.examples[0]).toContain('const records = readRecords(0)')
 const rendered=renderJSDocDetails(docs)
 expect(rendered).toContain('Reading does not change authorization')
 expect(rendered).toContain('source cannot be read')
})
test('generic and deprecated contracts are exposed rather than dropped during generation',()=>{
 const fixture=symbol(`/** Map a value.\n * @typeParam T - Type retained without conversion.\n * @param value - Input to preserve.\n * @returns The original value.\n * @deprecated Use the host mapper instead.\n */\nexport function preserve<T>(value:T):T{return value}`,'preserve')
 const rendered=renderJSDocDetails(readApiJSDoc(fixture.symbol,fixture.checker))
 expect(rendered).toContain('Type retained without conversion')
 expect(rendered).toContain('Use the host mapper instead')
})

test('canonical usage links resolve to known API anchors without inventing unknown destinations',()=>{
 const targets=new Map([['createStore','#api-createStore']])
 expect(rewriteJSDocLinks('See {@link createStore} and {@link Missing}.',targets)).toBe('See [createStore](#api-createStore) and `Missing`.')
})

test('member rendering includes type-alias union variants and nested option contracts',()=>{
 const fixture=symbol(`export type Options = {
 /** Enabled source. */
 mode:'on';
 /** Host configuration. */
 host:{
 /** Timeout in milliseconds. */
 timeout:number
 }
 } | {
 /** Disabled source. */
 mode:'off'
 };`,'Options')
 const members=publicJSDocMembers(ts,fixture.symbol.declarations[0])
 expect(members.map(member=>member.name)).toEqual(['mode','host','host.timeout','mode'])
 expect(readApiJSDoc(fixture.checker.getSymbolAtLocation(members[2].node.name),fixture.checker).summary).toBe('Timeout in milliseconds.')
})
