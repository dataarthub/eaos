import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {cp,mkdir,mkdtemp,readFile,rename,rm,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {sourceHash} from './source-state.mjs'

const names=['core','server','react','cli','plugins'].map(name=>'@alneas/eaos-'+name)
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n')

async function fixture(t) {
  const scratch=await mkdtemp(join(tmpdir(),'eaos-release-workflow-')),root=join(scratch,'repo')
  t.after(()=>rm(scratch,{recursive:true,force:true}))
  await mkdir(join(root,'scripts'),{recursive:true})
  await mkdir(join(root,'.changeset'))
  await mkdir(join(root,'.verification'))
  await mkdir(join(scratch,'home'))
  const env={...process.env,HOME:join(scratch,'home'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    npm_config_offline:'true',npm_config_audit:'false',npm_config_update_notifier:'false',npm_config_userconfig:join(scratch,'npm-user.rc'),npm_config_globalconfig:join(scratch,'npm-global.rc')}
  function run(command,args,cwd=root) {
    const result=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:60000})
    assert.ifError(result.error)
    return result
  }
  function ok(command,args,cwd) {
    const result=run(command,args,cwd)
    assert.equal(result.status,0,result.stderr||result.stdout)
    return result.stdout.trim()
  }
  const cli=(...args)=>run(process.execPath,['scripts/release.mjs',...args])
  const success=(...args)=>ok(process.execPath,['scripts/release.mjs',...args])
  const fails=(pattern,...args)=>{
    const result=cli(...args)
    assert.notEqual(result.status,0,result.stdout)
    assert.match(result.stderr,pattern)
  }
  for(const script of ['release','check-public','release-contract','source-state','verification-state','release-notes','release-handoff','release-preflight'])
    await cp(new URL(`./${script}.mjs`,import.meta.url),join(root,'scripts',script+'.mjs'))
  // Only installed external dependencies are linked; release sources are regular fixture files.
  await symlink(resolve(import.meta.dirname,'../node_modules'),join(root,'node_modules'),'dir')
  await writeFile(join(root,'.gitignore'),'node_modules/\ndist/\n.verification/\n')
  const directories=names.map(name=>'packages/'+name.split('-').at(-1))
  await save(join(root,'package.json'),{private:true,type:'module',workspaces:directories})
  for(const [index,directory] of directories.entries()) {
    const target=join(root,directory)
    await mkdir(join(target,'dist'),{recursive:true})
    await save(join(target,'package.json'),{name:names[index],version:'0.1.0',type:'module',license:'MIT',
      engines:{node:'>=24.0.0'},publishConfig:{access:'public',registry:'https://registry.npmjs.org'},
      files:['dist','CHANGELOG.md'],exports:{'.':'./dist/index.js'},
      ...(index?{dependencies:{[names[index-1]]:'0.1.0'}}:{})})
    await writeFile(join(target,'README.md'),`# ${names[index]}\n\nDisposable release workflow fixture.\n`)
    await writeFile(join(target,'LICENSE'),'MIT\n')
    await writeFile(join(target,'CHANGELOG.md'),'# Changelog\n\n## 0.1.0\n\n- Add the initial public fixture API.\n')
    await writeFile(join(target,'dist/index.js'),'export const fixture = true\n')
  }
  async function quality() {
    const hash=await sourceHash(root),outputs={}
    for(const [index,directory] of directories.entries())outputs[names[index]]=await sourceHash(join(root,directory,'dist'),new Set())
    // Synthetic receipts are solely fixture setup, never actual quality or consumer evidence.
    const receipt={runId:'fixture-only-quality',sourceHash:hash,status:'passed',guard:{ok:true},outputs,node:process.version,bun:'fixture-only',checks:['fixture-only']}
    await save(join(root,'.verification/quality.json'),receipt)
    await save(join(root,'.verification/quality-latest.json'),receipt)
  }
  async function consumer(bundle) {
    const manifest=await json(join(bundle,'bundle.json'))
    manifest.consumerVerified={runId:'fixture-only-consumer',sourceHash:manifest.sourceHash,guard:{ok:true},
      archives:manifest.archives.map(({name,version,sha256})=>({name,version,sha256}))}
    await save(join(bundle,'bundle.json'),manifest)
    await save(join(root,'.verification/consumer-latest.json'),{runId:'fixture-only-consumer',sourceHash:manifest.sourceHash,status:'passed',guard:{ok:true}})
    return manifest
  }
  return {root,scratch,ok,success,fails,quality,consumer}
}

test('release CLI binds real local archives, notes and a portable final handoff',async t=>{
  assert.equal(Number(process.versions.node.split('.')[0]),24,'Run release workflow tests with Node 24')
  const f=await fixture(t),pending=join(f.root,'.changeset/pending.md')
  await writeFile(pending,'---\n"@alneas/eaos-core": patch\n---\n\nImprove public SDK behavior in a future reviewed release.\n')
  await t.test('development notes and preparation allow pending root Changesets',async()=>{
    await f.quality()
    assert.match(f.success('notes'),/All five current version entries/)
    const bundle=f.success('prepare'),manifest=await json(join(bundle,'bundle.json'))
    assert.equal(manifest.state,'working-tree')
    assert.equal(manifest.schemaVersion,2)
    assert.equal(manifest.archives.length,5)
  })
  f.ok('git',['init','--quiet'])
  f.ok('git',['config','user.name','Fixture Only'])
  f.ok('git',['config','user.email','fixture@example.invalid'])
  const commit=()=>{f.ok('git',['add','.']);f.ok('git',['commit','--quiet','-m','Disposable fixture snapshot'])}
  commit()
  await t.test('final preparation rejects selected pending Changesets on a clean commit',async()=>{
    await f.quality()
    f.fails(/Unconsumed Changeset pending.md selects @alneas\/eaos-core/,'prepare','--final')
  })
  await rm(pending);commit();await f.quality()
  const bundle=f.success('prepare','--final'),manifest=await f.consumer(bundle)
  await t.test('final preparation binds all five notes, archive hashes and portable handoff',async()=>{
    assert.equal(manifest.state,'commit-bound');assert.equal(manifest.schemaVersion,2)
    assert.equal(manifest.commit,f.ok('git',['rev-parse','HEAD']))
    assert.deepEqual(manifest.archives.map(item=>item.name),names)
    for(const item of manifest.archives) {
      assert.equal(digest(await readFile(join(bundle,item.archive))),item.sha256)
      const notes=await readFile(join(bundle,item.notes.file),'utf8')
      assert.match(notes,/Add the initial public fixture API/)
      assert.equal(digest(notes),item.notes.sha256)
    }
    const handoff=await readFile(join(bundle,manifest.handoff.file),'utf8')
    assert.equal(digest(handoff),manifest.handoff.sha256)
    assert.ok(handoff.includes('"$EAOS_RELEASE_BUNDLE"'))
    assert.ok(!handoff.includes(bundle))
    assert.match(f.success('verify',bundle),/consumer evidence match \(commit-bound\)/)
  })
  await t.test('verification rejects notes, packed changelog and handoff tampering, then permits relocation',async()=>{
    const item=manifest.archives[0],note=join(bundle,item.notes.file),archive=join(bundle,item.archive),handoff=join(bundle,manifest.handoff.file)
    for(const [path,pattern] of [[note,/Release notes differ/],[handoff,/Manual bootstrap handoff differs/]]) {
      const original=await readFile(path)
      await writeFile(path,Buffer.concat([original,Buffer.from('\nTampered fixture bytes\n')]))
      f.fails(pattern,'verify',bundle)
      await writeFile(path,original)
    }
    const original=await readFile(archive),unpacked=join(f.scratch,'unpacked')
    await mkdir(unpacked);f.ok('tar',['-xzf',archive,'-C',unpacked])
    await writeFile(join(unpacked,'package/CHANGELOG.md'),'# Tampered fixture changelog\n')
    f.ok('tar',['-czf',archive,'-C',unpacked,'package'])
    f.fails(/Packed CHANGELOG differs from canonical source/,'verify',bundle)
    await writeFile(archive,original)
    const moved=join(f.scratch,'retained-bundle');await rename(bundle,moved)
    assert.match(f.success('verify',moved),/consumer evidence match \(commit-bound\)/)
  })
})
