import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {auditPublicApiJSDoc} from './public-api-jsdoc'
test('audit follows public re-exports, inspects members and ignores unexported modules',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-jsdoc-audit-'))
 try{
  await mkdir(join(root,'src'))
  await writeFile(join(root,'package.json'),JSON.stringify({name:'@example/sdk',exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'}}}))
  await writeFile(join(root,'src/index.ts'),"export { run, type Options } from './feature'\n")
  await writeFile(join(root,'src/feature.ts'),`/** Inputs for one task. */\nexport interface Options { enabled:boolean; host:{ timeout:number }; sources:Array<{ url:string }>;\n/** Complete one task.\n * @returns No value; completion is synchronous.\n */\ncomplete():void\n}\n/** Run a task. */\nexport function run(options:Options,host:{timeout:number}):{ok:boolean}{return {ok:true}}\n`)
  await writeFile(join(root,'src/internal.ts'),'export function hidden(){}')
  const result=await auditPublicApiJSDoc({root,packages:[{id:'fixture',directory:'.'}]})
  expect(result.records.some(r=>r.name==='hidden')).toBe(false)
  expect(result.records.find(r=>r.name==='run')?.issues).toEqual(['param:options','param:host','returns','example'])
  expect(result.records.find(r=>r.name==='Options')?.issues).toContain('usageReference')
  expect(result.records.find(r=>r.name==='Options.enabled')?.issues).toContain('summary')
  expect(result.records.find(r=>r.name==='Options.host.timeout')?.issues).toContain('summary')
  expect(result.records.find(r=>r.name==='Options.sources[].url')?.issues).toContain('summary')
  expect(result.records.find(r=>r.name==='Options.complete')?.issues).toEqual(['example'])
  expect(result.records.find(r=>r.name==='run.host.timeout')?.issues).toContain('summary')
  expect(result.records.find(r=>r.name==='run.result.ok')?.issues).toContain('summary')
  expect(result.records.filter(r=>r.name==='run')).toHaveLength(1)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('collection export paths resolve direct TSX sources and keep same-name feature declarations separate',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-jsdoc-collection-'))
 try{
  await mkdir(join(root,'approval/src'),{recursive:true})
  await mkdir(join(root,'admin/src'),{recursive:true})
  await writeFile(join(root,'package.json'),JSON.stringify({name:'@example/plugins',exports:{'./approval/react':{types:'./dist/approval/src/react.d.ts',import:'./dist/approval/src/react.js'},'./admin/react':{types:'./dist/admin/src/react.d.ts',import:'./dist/admin/src/react.js'}}}))
  for(const id of ['approval','admin'])await writeFile(join(root,id,'src/react.tsx'),`/** Return the ${id} component.\n * @returns The selected feature identifier.\n * @example\n * import { createView } from '@example/plugins/${id}/react';\n * createView();\n */\nexport function createView(){return '${id}'}\n`)
  const result=await auditPublicApiJSDoc({root,packages:[{id:'plugins',directory:'.'}]})
  const views=result.records.filter(record=>record.name==='createView')
  expect(views).toHaveLength(2)
  expect(views.map(record=>record.imports[0]).sort()).toEqual(['@example/plugins/admin/react','@example/plugins/approval/react'])
  expect(views.every(record=>record.issues.length===0)).toBe(true)
 }finally{await rm(root,{recursive:true,force:true})}
})
