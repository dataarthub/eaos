import assert from 'node:assert/strict'
import {test} from 'node:test'
import {manualFirstPublication} from './release-handoff.mjs'
const bundle={state:'commit-bound',commit:'a'.repeat(40),sourceHash:'b'.repeat(64),archives:[{name:'@alneas/eaos-core',version:'0.1.0',archive:'core.tgz',integrity:'sha512-Ynl0ZXM=',sha256:'c'.repeat(64),requiredTags:['beta','latest'],notes:{file:'core.notes.md',sha256:'d'.repeat(64)}}]}
test('manual first-publication handoff uses exact archive, explicit flags, read-only preflight and integrity/channel verification',()=>{
 const text=manualFirstPublication(bundle,"/tmp/reviewed candidate's bundle")
 assert.ok(text.includes('npm publish "$EAOS_RELEASE_BUNDLE"/\'core.tgz\' --ignore-scripts --access public --tag beta --registry=https://registry.npmjs.org'))
 assert.equal(manualFirstPublication(bundle,'/original'),manualFirstPublication(bundle,'/relocated'))
 assert.ok(text.includes('--target'))
 assert.ok(text.includes('dist.integrity'))
 assert.ok(text.includes('beta'))
 assert.ok(text.includes('latest'))
 assert.ok(text.includes(bundle.archives[0].integrity))
 assert.ok(text.includes(bundle.commit))
 assert.ok(text.includes('2FA'))
 assert.ok(text.includes('after first registration'))
 assert.ok(!text.includes('npm stage publish'))
})
test('working-tree or malformed artifact identities cannot produce publish instructions',()=>{
 for(const change of [{state:'working-tree'},{commit:null},{archives:[{...bundle.archives[0],archive:'../escape.tgz'}]},{archives:[{...bundle.archives[0],requiredTags:['evil']}]}])assert.throws(()=>manualFirstPublication({...bundle,...change},'/tmp/bundle'))
})
