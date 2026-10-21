import assert from 'node:assert/strict'
import {digest,registry} from './bundle.mjs'
export async function readVersion(a,timeout=30000){
 const r=await fetch(`${registry}/${encodeURIComponent(a.name)}/${a.version}`,{redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(timeout,30000))))})
 if(r.status===404)return null
 assert(r.ok,'Public registry version request failed');return r.json()
}
export async function verifyArtifact(a,timeout=30000){
 const started=performance.now(),v=await readVersion(a,timeout)
 assert(v?.name===a.name&&v.version===a.version,'Public version unavailable')
 assert.equal(v.dist?.integrity,a.integrity,'Registry integrity mismatch')
 const url=new URL(v.dist.tarball);assert.equal(url.origin,registry)
 const remaining=timeout-(performance.now()-started);assert(remaining>0,'Archive verification deadline')
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.floor(remaining)))})
 assert(response.ok,'Public archive unavailable')
 const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.length<=32*1024*1024,'Oversized public archive')
 assert.equal(digest(bytes).sha256,a.sha256,'Delivered archive differs from reviewed bytes')
}
