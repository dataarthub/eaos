// Credential-free identity verification shared by staging, observation and completion.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,lstat,mkdir,copyFile,writeFile} from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {releaseContext,assertReleaseSelection,releaseTarget} from './context.mjs'
export const registry='https://registry.npmjs.org'
export const digest=bytes=>({sha256:createHash('sha256').update(bytes).digest('hex'),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')})
export function requiredTags(version){assert.match(version,/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);return version.startsWith('0.')?['beta','latest']:['latest']}
export const directoryFor=kind=>kind==='plugins'?'plugins':'packages/'+kind
export const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:10000}).trim()
export function sourceTarget(root,commit,tag){
 const target=releaseTarget(tag)
 const meta=JSON.parse(git(root,['show',commit+':'+directoryFor(target.kind)+'/package.json']))
 assert.equal(meta.name,target.name);assert.equal(meta.version,target.version)
 assert.equal(meta.repository?.url,'git+https://github.com/dataarthub/eaos.git')
 assert.equal(meta.publishConfig?.registry,registry);assert.equal(meta.publishConfig?.access,'public')
 const changelog=git(root,['show',commit+':'+directoryFor(target.kind)+'/CHANGELOG.md'])
 return {...target,meta,changelog}
}
export async function verifyBundleIdentity(manifest,{directory,expectedCommit,targets}){
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.repository,'https://github.com/dataarthub/eaos')
 assert.match(manifest.commit,/^[a-f0-9]{40}$/);assert.equal(manifest.commit,expectedCommit)
 assert.equal(targets.length,1);assert.deepEqual(manifest.targets,[targets[0].name]);assert.equal(manifest.artifacts.length,1)
 const a=manifest.artifacts[0],target=targets[0]
 assert.equal(a.name,target.name);assert.equal(a.version,target.version)
 for(const [file,hash] of [[a.archive,a.sha256],[a.notes,a.notesSha256]]){
  assert.equal(file,basename(file));assert.match(file,/^[a-zA-Z0-9._-]+$/)
  const path=join(directory,file),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink())
  assert.equal(digest(await readFile(path)).sha256,hash,'Release file SHA-256 mismatch')
 }
 assert.match(a.archive,/\.tgz$/);assert.match(a.notes,/\.notes\.md$/)
 assert.equal(digest(await readFile(join(directory,a.archive))).integrity,a.integrity,'Archive SHA-512 mismatch')
 const packed=JSON.parse(execFileSync('tar',['-xOf',join(directory,a.archive),'package/package.json'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}))
 assert.equal(packed.name,target.name);assert.equal(packed.version,target.version)
 if(target.meta)for(const key of ['exports','dependencies','peerDependencies','optionalDependencies','publishConfig','repository','license'])assert.deepEqual(packed[key],target.meta[key],'Packed source mismatch: '+key)
 if(target.changelog){
  const packedLog=execFileSync('tar',['-xOf',join(directory,a.archive),'package/CHANGELOG.md'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}).trim()
  assert.equal(packedLog,target.changelog.trim(),'Packed changelog differs from released source')
  const entries=[...target.changelog.matchAll(/^##[ \t]+([^\r\n]+)\r?$/gm)]
  const headings=entries.filter(e=>e[1]===a.version||e[1]===`[${a.version}]`||e[1].startsWith(`[${a.version}] `)||e[1]===`v${a.version}`)
  assert.equal(headings.length,1,'Missing or duplicate version notes')
  const end=entries.find(e=>e.index>headings[0].index)?.index??target.changelog.length
  const notes=`# ${a.name} ${a.version}\n\n${target.changelog.slice(headings[0].index,end).trim()}\n`
  assert.equal(await readFile(join(directory,a.notes),'utf8'),notes,'Notes differ from released source')
 }
 return manifest
}
export async function readBundle(directory,root){
 const manifest=JSON.parse(await readFile(join(directory,'release.json'),'utf8'))
 const selection=releaseContext({root})
 const target=sourceTarget(root,selection.commit,selection.tag)
 await verifyBundleIdentity(manifest,{directory,expectedCommit:selection.commit,targets:[target]})
 assertReleaseSelection(manifest,selection)
 return manifest
}
export async function handoff(candidate,destination,root,{selection,recovery}={}){
 const selected=selection??releaseContext({root}),b=JSON.parse(await readFile(join(candidate,'bundle.json'),'utf8'))
 assert.equal(b.state,'commit-bound');assert.equal(b.commit,selected.commit)
 assert(b.consumerVerified?.guard?.ok,'Missing guarded consumer verification')
 const a=b.archives.find(a=>a.name===selected.name);assert(a);assert.equal(a.version,selected.version)
 const manifest={schemaVersion:1,repository:'https://github.com/dataarthub/eaos',commit:b.commit,sourceHash:b.sourceHash,release:{id:selected.releaseId,tag:selected.tag},staging:{runId:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT)},targets:[a.name],artifacts:[{name:a.name,version:a.version,archive:a.archive,sha256:a.sha256,integrity:a.integrity,notes:a.notes.file,notesSha256:a.notes.sha256}]}
 if(recovery)manifest.recovery=recovery
 assert(Number.isSafeInteger(manifest.staging.runId)&&manifest.staging.runId>0&&Number.isSafeInteger(manifest.staging.attempt)&&manifest.staging.attempt>0)
 await mkdir(destination,{recursive:true})
 for(const file of [a.archive,a.notes.file])await copyFile(join(candidate,file),join(destination,file))
 await writeFile(join(destination,'release.json'),JSON.stringify(manifest,null,2)+'\n')
 await verifyBundleIdentity(manifest,{directory:destination,expectedCommit:selected.commit,targets:[sourceTarget(root,selected.commit,selected.tag)]})
 assertReleaseSelection(manifest,selected)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(import.meta.dirname,'../..')
 await handoff(resolve(process.argv[2]),resolve(process.argv[3]),root)
}
