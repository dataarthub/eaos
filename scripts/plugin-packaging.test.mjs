import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile,access} from 'node:fs/promises'
import {packages} from './check-public.mjs'
const root=new URL('../',import.meta.url)
test('five publication targets share one standard plugin package with isolated exports',async()=>{
 const entries=await packages()
 assert.equal(entries.length,5)
 const pkg=entries.find(p=>p.name==='@alneas/eaos-plugins')
 assert.ok(pkg)
 assert.equal(pkg.version,'0.1.0')
 assert.equal(pkg.exports['.'],undefined)
 assert.ok(pkg.files.includes('README.ja.md'),'Keep the collection Japanese README explicit in the reviewed payload')
 for(const id of ['approval','field-customization','admin']) {
  await assert.rejects(access(new URL('plugins/'+id+'/package.json',root)))
  assert.ok(pkg.files.includes(id+'/README.ja.md'),'Keep translated feature README payloads explicit')
  assert.ok(pkg.files.includes(id+'/LICENSE'),'Keep npm-included feature licenses explicit in the reviewed payload')
  assert.equal(pkg.exports['./'+id+'/runtime'].import,'./dist/'+id+'/src/runtime.js')
  assert.equal(pkg.exports['./'+id+'/deployment.json'],'./dist/'+id+'/deployment.json')
 }
 const catalog=JSON.parse(await readFile(new URL('plugins/catalog.json',root),'utf8'))
 assert.deepEqual(catalog,{apiVersion:1,plugins:['approval','field-customization','admin']})
})
