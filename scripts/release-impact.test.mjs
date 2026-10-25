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
test('consumed Changesets remain covered by an increased package version and meaningful current release notes',async()=>{
 const {preparedReleaseTargets}=await import('./release-impact.mjs')
 const pkg={name:'core',directory:'packages/core',version:'0.2.0'}
 const before={name:'core',version:'0.1.0'}
 const files=['packages/core/package.json','packages/core/CHANGELOG.md','packages/core/src/index.ts']
 const notes='# Core\n\n## 0.2.0\n\n- Add governed draft execution contracts.\n\n## 0.1.0\n\n- Initial SDK.\n'
 const prepared=preparedReleaseTargets({packages:[pkg],files,previousManifests:{core:before},changelogs:{core:notes}})
 assert.deepEqual(prepared,['core'])
 assert.deepEqual(releaseImpactErrors({packages:[pkg],files,targets:prepared}),[])
 for(const input of [
  {packages:[{...pkg,version:'0.1.0'}],files,previousManifests:{core:before},changelogs:{core:notes}},
  {packages:[pkg],files:files.filter(f=>!f.endsWith('CHANGELOG.md')),previousManifests:{core:before},changelogs:{core:notes}},
  {packages:[pkg],files,previousManifests:{core:before},changelogs:{core:'# Core\n\n## 0.2.0\n\nTODO\n'}},
 ])assert.deepEqual(preparedReleaseTargets(input),[])
})
