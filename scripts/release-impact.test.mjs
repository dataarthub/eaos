import {test} from 'node:test'
import assert from 'node:assert/strict'
import {releaseImpactErrors} from './release-impact.mjs'
const packages=[{name:'core',directory:'packages/core'},{name:'ui',directory:'packages/ui',dependencies:{core:'1.0.0'}}]
test('requires new notes for changed runtime owners and dependent targets',()=>{
  assert.ok(releaseImpactErrors({packages,files:['packages/core/src/index.ts'],targets:['core']}).length)
  assert.deepEqual(releaseImpactErrors({packages,files:['packages/core/src/index.ts'],targets:['core','ui']}),[])
})
test('shared inputs conservatively require all targets or an explicit rationale for review',()=>{
  assert.ok(releaseImpactErrors({packages,files:['bun.lock'],targets:[]}).length)
  assert.deepEqual(releaseImpactErrors({packages,files:['bun.lock'],targets:[],rationale:'Maintainer-only test dependency; delivered package contracts and payload are unchanged.'}),[])
  assert.ok(releaseImpactErrors({packages,files:['CONTRIBUTING.md'],targets:[],rationale:'none'}).length)
})
