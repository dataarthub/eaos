import test from 'node:test'
import assert from 'node:assert/strict'
import {planTarget,executeStage,executeRelease,npmWriteArgs,assertWriteEnvironment,compareVersions,waitForRequiredChannels} from './engine.mjs'
const a={name:'@alneas/eaos-core',version:'0.2.0',archive:'core.tgz',integrity:'sha512-reviewed'}
const bundle={targets:[a.name],artifacts:[a]}
const state=()=>({name:a.name,versions:{'0.1.0':{}},'dist-tags':{latest:'0.1.0',beta:'0.1.0'}})
test('registered targets stage once with inspection tag; never direct publish',async()=>{
 const writes=[]
 await executeStage(bundle,{readState:async()=>state(),checkPrerequisite:async()=>{},write:async(...args)=>writes.push(args)})
 assert.deepEqual(writes,[['stage',a,'staged']])
 assert.equal(npmWriteArgs('stage',a,'staged','/tmp/bundle','true')[0],'stage')
 assert(npmWriteArgs('stage',a,'staged','/tmp/bundle','true').includes('--provenance=false'))
 assert(npmWriteArgs('stage',a,'staged','/tmp/bundle','false').includes('--provenance'))
 assert.throws(()=>npmWriteArgs('publish',a,'latest','/tmp/bundle','false'))
})
test('missing prerequisite or ambiguous write blocks all further mutations',async()=>{
 let writes=0
 await assert.rejects(executeStage(bundle,{readState:async()=>state(),checkPrerequisite:async()=>{throw Error('missing peer')},write:async()=>writes++}))
 assert.equal(writes,0)
 await assert.rejects(executeStage(bundle,{readState:async()=>state(),checkPrerequisite:async()=>{},write:async()=>{writes++;throw Error('ambiguous')}}))
 assert.equal(writes,1)
})
test('matching approved bytes repair only missing tags, content conflict/newer tags forbid writes',async()=>{
 const s=state();s.versions[a.version]={dist:{integrity:a.integrity}};s['dist-tags'].beta=a.version
 const writes=[]
 await executeRelease(bundle,{readState:async()=>s,checkPrerequisite:async()=>{},verifyArtifact:async()=>{},write:async(action,item,tag)=>{writes.push([action,tag]);s['dist-tags'][tag]=item.version}})
 assert.deepEqual(writes,[['tag','latest']])
 for(const mutate of [s=>{s['dist-tags'].latest='0.3.0'},s=>{s.versions[a.version].dist.integrity='wrong'},s=>{s.name='other'},s=>{s.versions={}}]){const remote=structuredClone(s);mutate(remote);assert.throws(()=>planTarget(a,remote))}
})
test('public bytes and prerequisites must verify before channel writes',async()=>{
 const s=state();s.versions[a.version]={dist:{integrity:a.integrity}};let writes=0
 await assert.rejects(executeRelease(bundle,{readState:async()=>s,checkPrerequisite:async()=>{},verifyArtifact:async()=>{throw Error('wrong bytes')},write:async()=>writes++}))
 assert.equal(writes,0)
 await assert.rejects(executeRelease(bundle,{readState:async()=>state(),checkPrerequisite:async()=>{},verifyArtifact:async()=>{},write:async()=>writes++}))
 assert.equal(writes,0)
})
test('versions compare SemVer correctly and stable 1.x does not change beta',()=>{
 assert(compareVersions('0.2.0-alpha.2','0.2.0-alpha.10')<0)
 assert.equal(compareVersions('1.0.0+a','1.0.0+b'),0)
 assert.deepEqual(planTarget({...a,version:'1.0.0'},{...state(),'dist-tags':{beta:'2.0.0',latest:'0.2.0'}}).tags,['latest'])
})
test('writers require exact owning workflow, OIDC, event and no static credentials',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'dataarthub/eaos',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW_REF:'dataarthub/eaos/.github/workflows/publish.yml@refs/heads/main',GITHUB_SHA:'a'.repeat(40),RELEASE_REPOSITORY_PRIVATE:'true',ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.test',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'ephemeral'}
 assert.doesNotThrow(()=>assertWriteEnvironment(env))
 for(const x of [{NODE_AUTH_TOKEN:'static'},{NPM_TOKEN:'static'},{GITHUB_REPOSITORY:'fork/eaos'},{GITHUB_REF:'refs/heads/other'},{GITHUB_EVENT_NAME:'push'},{ACTIONS_ID_TOKEN_REQUEST_TOKEN:''}])assert.throws(()=>assertWriteEnvironment({...env,...x}))
})

test('completion tolerates delayed post-write channel visibility without repeating writes',async()=>{
 const live=state();live.versions[a.version]={dist:{integrity:a.integrity}};const stale=structuredClone(live),writes=[];let now=0,lagReads=0;
 await executeRelease(bundle,{readState:async()=>writes.length===2&&lagReads++<2?structuredClone(stale):structuredClone(live),verifyArtifact:async()=>{},checkPrerequisite:async()=>{},write:async(action,item,tag)=>{writes.push([action,tag]);live['dist-tags'][tag]=item.version},channelWait:{now:()=>now,sleep:async ms=>{now+=ms},timeout:50,interval:10}});
 assert.deepEqual(writes,[['tag','beta'],['tag','latest']]);assert.equal(now,20);
});


test('channel propagation timeout does not repeat tag or publication writes',async()=>{
 const live=state();live.versions[a.version]={dist:{integrity:a.integrity}};const stale=structuredClone(live),writes=[];let now=0;
 await assert.rejects(executeRelease(bundle,{readState:async()=>writes.length===2?structuredClone(stale):structuredClone(live),verifyArtifact:async()=>{},checkPrerequisite:async()=>{},write:async(action,item,tag)=>{writes.push([action,tag]);live['dist-tags'][tag]=item.version},channelWait:{now:()=>now,sleep:async ms=>{now+=ms},timeout:20,interval:10}}),/bounded propagation wait/);
 assert.deepEqual(writes,[['tag','beta'],['tag','latest']]);assert.equal(now,20);
});
test('a newer channel, changed bytes, disappeared version or read failure stops propagation checks',async()=>{
 for(const mutation of [s=>{s['dist-tags'].latest='0.3.0'},s=>{s.versions[a.version].dist.integrity='other'},s=>{delete s.versions[a.version]}]){
  let now=0,reads=0;const s=state();s.versions[a.version]={dist:{integrity:a.integrity}};
  await assert.rejects(waitForRequiredChannels(a,async()=>{if(++reads===2)mutation(s);return structuredClone(s)},{now:()=>now,sleep:async ms=>{now+=ms},timeout:50,interval:10}));
  assert.equal(reads,2);
 }
 let reads=0;await assert.rejects(waitForRequiredChannels(a,async()=>{reads++;throw Error('permission denied')}),/permission denied/);assert.equal(reads,1);
});
