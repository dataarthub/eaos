import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertLatestQuality } from './verification-state.mjs'
const quality={runId:'old',sourceHash:'same'}
test('a newer running or failed attempt blocks an older success at identical source',()=>{
  for(const status of ['running','failed'])assert.throws(()=>assertLatestQuality(quality,{runId:'new',status,sourceHash:'same'},'same'),/latest successful/)
})
test('only the same successful invocation and source authorize preparation',()=>{
  const latest={runId:'old',status:'passed',sourceHash:'same',guard:{ok:true}}
  assert.doesNotThrow(()=>assertLatestQuality(quality,latest,'same'))
  assert.throws(()=>assertLatestQuality(quality,{...latest,guard:{ok:false}},'same'),/latest successful/)
  assert.throws(()=>assertLatestQuality(quality,latest,'changed'),/source/)
  assert.throws(()=>assertLatestQuality(quality,undefined,'same'),/latest successful/)
})

test('a newer failed consumer blocks prior bundle evidence even at identical source',async()=>{
  const {assertLatestConsumer}=await import('./verification-state.mjs')
  const bundle={sourceHash:'same',consumerVerified:{runId:'first',sourceHash:'same',guard:{ok:true}}}
  const latest={status:'passed',sourceHash:'same',runId:'first',guard:{ok:true}}
  assert.doesNotThrow(()=>assertLatestConsumer(bundle,latest))
  assert.throws(()=>assertLatestConsumer(bundle,{...latest,status:'failed',runId:'second'}),/latest successful/)
  assert.throws(()=>assertLatestConsumer(bundle,{...latest,status:'running'}),/latest successful/)
})
test('one verification owns the lock and failure releases it',async()=>{
  const {withVerificationLock}=await import('./verification-state.mjs')
  const {mkdtemp,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const root=await mkdtemp(join(tmpdir(),'eaos-verification-lock-'))
  try {
    await withVerificationLock(root,'quality',async()=>{
      await assert.rejects(()=>withVerificationLock(root,'consumer',async()=>{}),/verification already owns/)
    })
    await assert.rejects(()=>withVerificationLock(root,'consumer',async()=>{throw Error('failed check')}),/failed check/)
    assert.equal(await withVerificationLock(root,'quality',async()=>42),42)
  }finally{await rm(root,{recursive:true,force:true})}
})
