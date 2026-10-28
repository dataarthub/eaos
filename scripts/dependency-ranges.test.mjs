import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
test('distributed runtime and peer dependencies use compatible ranges, with exact resolution owned by the lockfile',()=>{
 for(const directory of ['packages/core','packages/server','packages/react','packages/cli','plugins']){
  const pkg=JSON.parse(readFileSync(resolve(root,directory,'package.json'),'utf8'))
  for(const field of ['dependencies','peerDependencies','optionalDependencies'])for(const [name,range] of Object.entries(pkg[field]??{})){
   assert(!/^\d+\.\d+\.\d+$/.test(range),`${pkg.name} ${field} ${name} must use a compatible range`)
  }
 }
})
