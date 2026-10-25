import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile,access} from 'node:fs/promises'
import {packages} from './check-public.mjs'
import {validateManifest} from './release-contract.mjs'
const root=new URL('../',import.meta.url)
test('publication targets explicitly include their paired Japanese READMEs',async()=>{
 for(const pkg of await packages()) {
  assert.ok(pkg.files.includes('README.ja.md'),pkg.name)
  await access(new URL(pkg.directory+'/README.ja.md',root))
  if(pkg.name==='@alneas/eaos-plugins') for(const id of ['approval','field-customization','admin']) {
   assert.ok(pkg.files.includes(id+'/README.ja.md'),id)
   await access(new URL('plugins/'+id+'/README.ja.md',root))
  }
 }
})
test('five publication targets share one standard plugin package with isolated exports',async()=>{
 const entries=await packages()
 assert.equal(entries.length,5)
 const pkg=entries.find(p=>p.name==='@alneas/eaos-plugins')
 assert.ok(pkg)
 assert.deepEqual(validateManifest(pkg),[],'Collection releases keep the public manifest contract; feature versions are independent')
 assert.equal(pkg.exports['.'],undefined)
 for(const id of ['approval','field-customization','admin']) {
  await assert.rejects(access(new URL('plugins/'+id+'/package.json',root)))
  assert.ok(pkg.files.includes(id+'/LICENSE'),'Keep npm-included feature licenses explicit in the reviewed payload')
  assert.equal(pkg.exports['./'+id+'/runtime'].import,'./dist/'+id+'/src/runtime.js')
  assert.equal(pkg.exports['./'+id+'/deployment.json'],'./dist/'+id+'/deployment.json')
 }
 const catalog=JSON.parse(await readFile(new URL('plugins/catalog.json',root),'utf8'))
 assert.deepEqual(catalog,{apiVersion:1,plugins:['approval','field-customization','admin']})
})
