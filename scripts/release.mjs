import assert from 'node:assert/strict'
import { readFile,writeFile,mkdir,mkdtemp,rm,readdir } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { packages } from './check-public.mjs'
import { validateManifest,publicationOrder,auditPackedFiles,requiredTags,verifyCandidateIdentity } from './release-contract.mjs'
import { sourceHash,candidateCommit,cleanCommit } from './source-state.mjs'
import { assertLatestQuality,assertLatestConsumer } from './verification-state.mjs'
import {releaseNotes,verifyReleaseNotes,pendingReleaseErrors} from './release-notes.mjs'
import {manualFirstPublication} from './release-handoff.mjs'
import {registryPreflight} from './release-preflight.mjs'
const root=resolve(import.meta.dirname,'..')
const command=process.argv[2]??'plan'
if(!['plan','notes','prepare','verify','preflight'].includes(command))throw Error('Usage: release.mjs plan|notes|prepare [--final]|verify <bundle-directory>|preflight <bundle-directory> [--target <name>]')
const entries=publicationOrder(await packages())
for(const pkg of entries)assert.deepEqual(validateManifest(pkg),[],pkg.name)
async function preparedNotes(requireConsumed=false) {
  const fragments=await Promise.all((await readdir(join(root,'.changeset'))).filter(file=>file.endsWith('.md')&&file!=='README.md').map(async filename=>({filename,text:await readFile(join(root,'.changeset',filename),'utf8')})))
  if(requireConsumed)assert.deepEqual(pendingReleaseErrors(entries,fragments),[],'Review selected pending Changesets before final preparation')
  const notes=new Map()
  for(const pkg of entries) {
    const changelog=await readFile(join(root,pkg.directory,'CHANGELOG.md'),'utf8')
    notes.set(pkg.name,{changelog,text:releaseNotes(pkg,changelog)})
  }
  return notes
}

if(command==='plan') {
  console.log(JSON.stringify({commit:candidateCommit(root),status:'preparation-only',packages:entries.map(p=>({name:p.name,version:p.version,directory:p.directory,requiredTags:requiredTags(p.version)})),publication:'No registry writes. Review Changesets, version entries, prerequisite registry versions and clean-commit binding before publication.'},null,2))
} else if(command==='notes') {
  await preparedNotes()
  console.log('All five current version entries contain meaningful notes. Pending Changesets remain allowed for development; final preparation enforces consumption.')
} else if(command==='prepare') {
  const before=await sourceHash(root)
  const quality=JSON.parse(await readFile(join(root,'.verification/quality.json'),'utf8'))
  assertLatestQuality(quality,JSON.parse(await readFile(join(root,'.verification/quality-latest.json'),'utf8')),before)
  for(const pkg of entries)assert.equal(await sourceHash(join(root,pkg.directory,'dist'),new Set()),quality.outputs[pkg.name],'Built output changed since quality verification')
  const commit=process.argv.includes('--final')?cleanCommit(root):candidateCommit(root)
  const notes=await preparedNotes(process.argv.includes('--final'))
  const bundle=await mkdtemp(join(root,'.verification/release-'))
  const archives=[]
  for(const pkg of entries) {
    const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',bundle,'--cache',join(root,'.verification/npm-cache')],{cwd:join(root,pkg.directory),encoding:'utf8',maxBuffer:32*1024*1024}))[0]
    const archive=join(bundle,packed.filename)
    const files=packed.files.map(file=>({path:file.path,content:/\.(?:[cm]?js|[cm]?ts|map|json)$/.test(file.path)?execFileSync('tar',['-xOf',archive,'package/'+file.path],{encoding:'utf8',maxBuffer:32*1024*1024}):''}))
    assert.deepEqual(auditPackedFiles(pkg,files),[],pkg.name)
    const actual=JSON.parse(execFileSync('tar',['-xOf',archive,'package/package.json'],{encoding:'utf8'}))
    assert.equal(actual.name,pkg.name);assert.equal(actual.version,pkg.version)
    assert.deepEqual(validateManifest(actual),[],pkg.name)
    for(const field of ['exports','dependencies','peerDependencies','optionalDependencies'])assert.deepEqual(actual[field],pkg[field],`Packed ${field} differs from reviewed source`)
    const text=notes.get(pkg.name).text
    const noteFile=packed.filename.replace(/\.tgz$/,'.notes.md')
    const noteHash=createHash('sha256').update(text).digest('hex')
    verifyReleaseNotes(pkg,{sourceChangelog:notes.get(pkg.name).changelog,packedChangelog:execFileSync('tar',['-xOf',archive,'package/CHANGELOG.md'],{encoding:'utf8'}),notes:text,sha256:noteHash})
    await writeFile(join(bundle,noteFile),text)
    const bytes=await readFile(archive)
    archives.push({name:pkg.name,version:pkg.version,archive:packed.filename,sha256:createHash('sha256').update(bytes).digest('hex'),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),requiredTags:requiredTags(pkg.version),files:packed.files.length,notes:{file:noteFile,sha256:noteHash}})
  }
  assert.equal(await sourceHash(root),before,'Source changed while packing')
  const manifest={schemaVersion:2,state:process.argv.includes('--final')?'commit-bound':'working-tree',commit,sourceHash:before,qualityRunId:quality.runId,node:quality.node,bun:quality.bun,checks:quality.checks,archives,consumerVerified:false}
  if(manifest.state==='commit-bound') {
    const text=manualFirstPublication(manifest)
    manifest.handoff={file:'MANUAL-FIRST-PUBLICATION.md',sha256:createHash('sha256').update(text).digest('hex')}
    await writeFile(join(bundle,manifest.handoff.file),text)
  }
  await writeFile(join(bundle,'bundle.json'),JSON.stringify(manifest,null,2)+'\n')
  console.log(bundle)
} else {
  const bundle=resolve(process.argv[3]??'')
  const manifest=JSON.parse(await readFile(join(bundle,'bundle.json'),'utf8'))
  assert.equal(manifest.schemaVersion,2,'Prepare a fresh notes-bound candidate')
  const notes=await preparedNotes(manifest.state==='commit-bound')
  const quality=JSON.parse(await readFile(join(root,'.verification/quality.json'),'utf8'))
  assertLatestQuality(quality,JSON.parse(await readFile(join(root,'.verification/quality-latest.json'),'utf8')),await sourceHash(root))
  assert.equal(manifest.qualityRunId,quality.runId,'Candidate belongs to a different quality invocation; prepare again')
  assertLatestConsumer(manifest,JSON.parse(await readFile(join(root,'.verification/consumer-latest.json'),'utf8')))
  assert.equal(manifest.sourceHash,await sourceHash(root),'Source differs from candidate')
  assert.deepEqual(manifest.archives.map(x=>x.name),entries.map(x=>x.name),'Candidate target/order differs')
  for(const item of manifest.archives) {
    assert.ok(item.archive===item.archive.split(/[\\/]/).at(-1)&&!item.archive.includes('..'),'Unsafe archive path')
    const pkg=entries.find(pkg=>pkg.name===item.name)
    assert.equal(item.version,pkg.version,'Candidate version differs from source')
    assert.deepEqual(item.requiredTags,requiredTags(pkg.version),'Candidate channels differ')
    assert.match(item.notes?.file??'',/^[A-Za-z0-9._-]+\.notes\.md$/,'Missing or invalid notes filename')
    const text=await readFile(join(bundle,item.notes.file),'utf8')
    verifyReleaseNotes(pkg,{sourceChangelog:notes.get(pkg.name).changelog,packedChangelog:execFileSync('tar',['-xOf',join(bundle,item.archive),'package/CHANGELOG.md'],{encoding:'utf8'}),notes:text,sha256:item.notes.sha256})
    const bytes=await readFile(join(bundle,item.archive))
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,'Archive changed')
    assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),item.integrity,'Archive integrity changed')
  }
  verifyCandidateIdentity(manifest,{sourceHash:await sourceHash(root),cleanCommit:manifest.state==='commit-bound'?cleanCommit(root):null})
  if(manifest.state==='commit-bound') {
    assert.equal(manifest.handoff?.file,'MANUAL-FIRST-PUBLICATION.md','Missing manual bootstrap handoff')
    const text=await readFile(join(bundle,manifest.handoff.file),'utf8')
    assert.equal(text,manualFirstPublication(manifest),'Manual bootstrap handoff differs from candidate')
    assert.equal(createHash('sha256').update(text).digest('hex'),manifest.handoff.sha256,'Manual bootstrap handoff hash differs')
  }
  if(command==='preflight') {
    assert.equal(manifest.state,'commit-bound','Registry handoff requires a final commit-bound candidate')
    const targetIndex=process.argv.indexOf('--target'),selectedName=targetIndex<0?undefined:process.argv[targetIndex+1]
    if(targetIndex>=0)assert.ok(selectedName,'--target requires a candidate package name')
    const report=await registryPreflight({packages:entries,archives:manifest.archives,mode:selectedName?'publish':'bootstrap',selectedName})
    const receipt={...report,commit:manifest.commit,sourceHash:manifest.sourceHash,checkedAt:new Date().toISOString()}
    await writeFile(join(bundle,'registry-preflight.json'),JSON.stringify(receipt,null,2)+'\n')
    console.log(JSON.stringify(receipt,null,2))
    if(!report.ok)process.exitCode=1
  } else console.log('Candidate source, notes, archive bytes and consumer evidence match ('+manifest.state+'). This is not publication or registry verification.')
}
