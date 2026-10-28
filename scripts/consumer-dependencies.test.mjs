import test from 'node:test'
import assert from 'node:assert/strict'
import { dependencyConstraints, selectProfile, verifyInstalledProfile } from './consumer-dependencies.mjs'
const packument=(name,versions)=>({name,versions:Object.fromEntries(versions.map(version=>[version,{name,version,dist:{integrity:'sha512-'+version,tarball:`https://registry.npmjs.org/${name}/-/${version}.tgz`}}]))})
const owners=[{name:'candidate',version:'0.3.0',dependencies:{dep:'^1.2.0'},peerDependencies:{react:'^18.3.0 || ^19.0.0',optional:'^2.0.0'},peerDependenciesMeta:{optional:{optional:true}}},{name:'other',version:'0.3.0',peerDependencies:{dep:'^1.3.0',react:'^19.2.3'}}]
const registry={dep:packument('dep',['1.2.0','1.3.0','1.4.1','2.0.0']),react:packument('react',['18.3.0','19.0.0','19.2.3','19.3.1']),optional:packument('optional',['2.0.0','2.1.0'])}
test('minimum and updated use published intersection and retain owner lower-bound gaps',()=>{
 const constraints=dependencyConstraints(owners)
 const min=selectProfile('minimum',constraints,registry,owners)
 const updated=selectProfile('updated-compatible',constraints,registry,owners)
 assert.equal(min.dependencies.dep,'1.3.0');assert.equal(updated.dependencies.dep,'1.4.1')
 assert.equal(min.dependencies.react,'19.2.3');assert.equal(updated.dependencies.react,'19.3.1')
 assert.equal(min.dependencies.optional,'2.0.0')
 assert.ok(min.coverageGaps.some(g=>g.owner==='candidate'&&g.name==='react'&&g.minimum==='18.3.0'))
 assert.ok(min.constraints.some(c=>c.name==='optional'&&c.optional))
})
test('invalid, unbounded and unpublished declared minimums fail closed',()=>{
 for(const range of ['workspace:*','*','>=1.2.0','^1.2.1'])assert.throws(()=>selectProfile('minimum',dependencyConstraints([{name:'owner',dependencies:{dep:range}}]),registry,[]))
})
test('candidate archives must satisfy internal constraints without registry substitution',()=>{
 const c=dependencyConstraints([{name:'owner',dependencies:{candidate:'^0.3.0'}}])
 assert.equal(selectProfile('minimum',c,{},[{name:'candidate',version:'0.3.0'}]).candidateDependencies.candidate,'0.3.0')
 assert.throws(()=>selectProfile('minimum',c,{},[{name:'candidate',version:'0.2.0'}]),/candidate/i)
 assert.throws(()=>selectProfile('minimum',c,{},[]),/registry/i)
})
test('installed roots must match exact requested version, registry integrity and root declaration',()=>{
 const profile=selectProfile('minimum',dependencyConstraints([{name:'owner',dependencies:{dep:'^1.2.0'}}]),registry,[])
 const packageJson={dependencies:{dep:'1.2.0'}}
 const lock={packages:{'':{dependencies:{dep:'1.2.0'}},'node_modules/dep':{version:'1.2.0',integrity:'sha512-1.2.0',resolved:'https://registry.npmjs.org/dep/-/1.2.0.tgz'}}}
 assert.equal(verifyInstalledProfile(profile,packageJson,lock,{dep:'1.2.0'})[0].integrity,'sha512-1.2.0')
 assert.throws(()=>verifyInstalledProfile(profile,{...packageJson,overrides:{dep:'1.4.1'}},lock,{dep:'1.2.0'}),/override/i)
 assert.throws(()=>verifyInstalledProfile(profile,packageJson,lock,{dep:'1.4.1'}),/installed/i)
 assert.throws(()=>verifyInstalledProfile(profile,packageJson,{packages:{...lock.packages,'node_modules/dep':{...lock.packages['node_modules/dep'],integrity:'wrong'}}},{dep:'1.2.0'}),/integrity/i)
 assert.throws(()=>verifyInstalledProfile(profile,{dependencies:{dep:'^1.2.0'}},lock,{dep:'1.2.0'}),/exact/i)
})
test('optional omissions cannot hide required dependencies and retain declaration evidence',()=>{
 const optional=selectProfile('minimum',dependencyConstraints([{name:'owner',peerDependencies:{provider:'^2.0.0'},peerDependenciesMeta:{provider:{optional:true}}}]),{},[],{omitOptional:['provider']})
 assert.equal(optional.omittedOptionalPeers[0].declarations[0].owner,'owner')
 assert.throws(()=>selectProfile('minimum',dependencyConstraints([{name:'owner',dependencies:{provider:'^2.0.0'}}]),{},[],{omitOptional:['provider']}),/required/)
})
test('alternate icon floors can be explicitly selected without narrowing the owner declaration',()=>{
 const constraints=dependencyConstraints([{name:'react-owner',peerDependencies:{icon:'^0.475.0 || ^1.57.0'}},{name:'branch-fixture',dependencies:{icon:'1.57.0'}}])
 const p=selectProfile('minimum',constraints,{icon:packument('icon',['0.475.0','1.57.0','1.61.0'])},[])
 assert.equal(p.dependencies.icon,'1.57.0')
 assert.equal(p.registrySelections[0].declarations[0].range,'^0.475.0 || ^1.57.0')
})
test('untrusted or incomplete registry resolution metadata fails closed',()=>{
 for(const mutate of [v=>delete v.dist.integrity,v=>v.dist.tarball='https://example.test/pkg.tgz',v=>v.name='other']){
  const registry={dep:packument('dep',['1.2.0'])};mutate(registry.dep.versions['1.2.0'])
  assert.throws(()=>selectProfile('minimum',dependencyConstraints([{name:'owner',dependencies:{dep:'^1.2.0'}}]),registry,[]))
 }
})
test('optional infrastructure peers are pinned and recorded when explicitly exercised',()=>{
 const constraints=dependencyConstraints([{name:'cli-owner',peerDependencies:{'@pulumi/pulumi':'^3.268.0','@pulumi/oci':'^5.3.1'},peerDependenciesMeta:{'@pulumi/pulumi':{optional:true},'@pulumi/oci':{optional:true}}}])
 const registry={'@pulumi/pulumi':packument('@pulumi/pulumi',['3.268.0','3.270.0','4.0.0']),'@pulumi/oci':packument('@pulumi/oci',['5.3.1','5.4.0','6.0.0'])}
 const min=selectProfile('minimum',constraints,registry,[]),updated=selectProfile('updated-compatible',constraints,registry,[])
 assert.deepEqual(min.dependencies,{'@pulumi/oci':'5.3.1','@pulumi/pulumi':'3.268.0'})
 assert.deepEqual(updated.dependencies,{'@pulumi/oci':'5.4.0','@pulumi/pulumi':'3.270.0'})
 assert.deepEqual(min.omittedOptionalPeers,[])
 assert.ok(min.registrySelections.every(s=>s.declarations[0].optional&&s.declarations[0].owner==='cli-owner'))
})
test('React owner branch types stay at independently published matching floors',()=>{
 const registry={'@types/react':packument('@types/react',['18.3.0','18.3.28','19.0.0','19.3.0']),'@types/react-dom':packument('@types/react-dom',['18.3.0','18.3.7','19.0.0','19.3.0'])}
 for(const floor of ['18.3.0','19.0.0']) {
  const constraints=dependencyConstraints([{name:'react-owner-branch-type-harness',dependencies:{'@types/react':floor,'@types/react-dom':floor}}])
  const profile=selectProfile('minimum',constraints,registry,[])
  assert.equal(profile.dependencies['@types/react'],floor)
  assert.equal(profile.dependencies['@types/react-dom'],floor)
  assert.equal(profile.registrySelections[0].declarations[0].owner,'react-owner-branch-type-harness')
 }
 delete registry['@types/react-dom'].versions['18.3.0']
 assert.throws(()=>selectProfile('minimum',dependencyConstraints([{name:'owner',dependencies:{'@types/react-dom':'18.3.0'}}]),registry,[]),/Unpublished/)
})
