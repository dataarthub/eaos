import test from 'node:test'
import assert from 'node:assert/strict'
import {releaseTarget,validateReleaseEvent,assertReleaseSelection,releaseContext} from './context.mjs'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
const sha='a'.repeat(40)
const fixture=()=>({event:{action:'published',repository:{full_name:'dataarthub/eaos'},release:{id:17,tag_name:'eaos-core-v0.2.0',draft:false,prerelease:false}},commit:sha,tagCommit:sha,onMain:true,manifests:{core:{name:'@alneas/eaos-core',version:'0.2.0',repository:{url:'git+https://github.com/dataarthub/eaos.git'},publishConfig:{access:'public',registry:'https://registry.npmjs.org'}}}})
test('five package tags select one stable package; initial aggregate tag cannot stage',()=>{
 for(const kind of ['core','server','react','cli','plugins'])assert.equal(releaseTarget(`eaos-${kind}-v0.2.0`).name,`@alneas/eaos-${kind}`)
 for(const tag of ['v0.1.0','eaos-core-v0.2.0-beta','eaos-core-v01.2.0','eaos-other-v0.2.0','eaos-core-v0.2.0\n'])assert.throws(()=>releaseTarget(tag))
 assert.equal(validateReleaseEvent(fixture()).commit,sha)
})
test('fork, draft, prerelease, moved/off-main source and manifest mismatch block staging',()=>{
 for(const mutate of [i=>{i.event.action='edited'},i=>{i.event.release.draft=true},i=>{i.event.release.prerelease=true},i=>{i.event.repository.full_name='fork/eaos'},i=>{i.tagCommit='b'.repeat(40)},i=>{i.onMain=false},i=>{i.manifests.core.version='0.1.0'},i=>{i.event.release.id=0},i=>{i.manifests.core.publishConfig.registry='https://example.test'}]){const i=fixture();mutate(i);assert.throws(()=>validateReleaseEvent(i))}
})
test('bundle selection is bound to package, version, original Release and commit',()=>{
 const selection=validateReleaseEvent(fixture()),m={commit:sha,release:{id:17,tag:'eaos-core-v0.2.0'},targets:['@alneas/eaos-core'],artifacts:[{name:'@alneas/eaos-core',version:'0.2.0'}]}
 assert.doesNotThrow(()=>assertReleaseSelection(m,selection))
 for(const mutate of [m=>{m.release.id++},m=>{m.commit='b'.repeat(40)},m=>{m.targets.push('@alneas/eaos-cli')},m=>{m.artifacts[0].version='0.1.0'}]){const x=structuredClone(m);mutate(x);assert.throws(()=>assertReleaseSelection(x,selection))}
})
test('real Git context peels annotated tags and rejects moved tags and all-job reruns',()=>{
 const root=mkdtempSync(join(tmpdir(),'eaos-publish-context-'))
 try{
  const input=fixture()
  for(const kind of ['core','server','react','cli','plugins']){
   const dir=join(root,kind==='plugins'?'plugins':'packages/'+kind);mkdirSync(dir,{recursive:true})
   writeFileSync(join(dir,'package.json'),JSON.stringify({...input.manifests.core,name:'@alneas/eaos-'+kind}))
  }
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:root,encoding:'utf8',stdio:'pipe'}).trim()
  git('-c','init.templateDir=','init','--quiet','--initial-branch=main');git('add','.');git('commit','--quiet','-m','fixture')
  const commit=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',commit);git('tag','-a','eaos-core-v0.2.0','-m','reviewed')
  const path=join(root,'event.json');writeFileSync(path,JSON.stringify(input.event))
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'dataarthub/eaos',GITHUB_EVENT_NAME:'release',GITHUB_EVENT_PATH:path,GITHUB_SHA:commit,GITHUB_REF:'refs/tags/eaos-core-v0.2.0',GITHUB_WORKFLOW_REF:'dataarthub/eaos/.github/workflows/publish.yml@refs/tags/eaos-core-v0.2.0',GITHUB_RUN_ATTEMPT:'1'}
  assert.equal(releaseContext({root,env}).commit,commit)
  assert.throws(()=>releaseContext({root,env:{...env,GITHUB_RUN_ATTEMPT:'2'}}),/cannot rebuild or restage/)
  git('commit','--allow-empty','--quiet','-m','later');const later=git('rev-parse','HEAD');git('checkout','--quiet','--detach',commit);git('tag','-f','eaos-core-v0.2.0',later)
  assert.throws(()=>releaseContext({root,env}),/tag must resolve/)
 }finally{rmSync(root,{recursive:true,force:true})}
})
