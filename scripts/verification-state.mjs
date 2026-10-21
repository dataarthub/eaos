import assert from 'node:assert/strict'
export function assertLatestQuality(quality,latest,source) {
  assert.ok(latest?.status==='passed' && latest.guard?.ok && quality.runId===latest.runId,'Require the latest successful guarded quality invocation; run bun run check')
  assert.equal(quality.sourceHash,source,'Quality source changed')
  assert.equal(latest.sourceHash,source,'Latest invocation source changed')
}

export function assertLatestConsumer(bundle,latest) {
  assert.ok(latest?.status==='passed' && latest.guard?.ok && bundle.consumerVerified?.guard?.ok && bundle.consumerVerified?.runId===latest.runId,'Require the latest successful guarded consumer invocation')
  assert.equal(latest.sourceHash,bundle.sourceHash,'Latest consumer source changed')
}
export async function withVerificationLock(root,kind,work) {
  const {mkdir,writeFile,rm}=await import('node:fs/promises')
  const {join}=await import('node:path')
  const lock=join(root,'.verification/verification.lock')
  await mkdir(join(root,'.verification'),{recursive:true})
  try {await mkdir(lock)}catch(error){if(error.code==='EEXIST')throw Error('Another verification already owns the lock; inspect .verification/verification.lock/owner.json. Remove a stale lock only after confirming its invocation stopped.');throw error}
  try {
    await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,kind,startedAt:new Date().toISOString()})+'\n')
    return await work()
  } finally {await rm(lock,{recursive:true,force:true})}
}
