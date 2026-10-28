import assert from 'node:assert/strict'
import semver from 'semver'

// Deliberately bounded: accepting more range syntax requires a reviewed selector.
function branches(range) {
  assert.equal(typeof range,'string','Dependency range must be a string')
  const values=range.split(/\s*\|\|\s*/)
  assert.ok(values.every(value=>/^\^?\d+\.\d+\.\d+$/.test(value)&&semver.validRange(value)),`Unsupported dependency range: ${range}`)
  return values.map(value=>({range:value,minimum:semver.minVersion(value).version}))
}
export function dependencyConstraints(packages) {
  return packages.flatMap(pkg=>['dependencies','peerDependencies'].flatMap(kind=>Object.entries(pkg[kind]??{}).map(([name,range])=>{
    branches(range)
    return {owner:pkg.name,kind,name,range,optional:kind==='peerDependencies'&&pkg.peerDependenciesMeta?.[name]?.optional===true}
  })))
}
export function selectProfile(id,constraints,registry,candidates,{omitOptional=[]}={}) {
  assert.ok(['minimum','updated-compatible'].includes(id),'Unknown dependency profile')
  const dependencies={},candidateDependencies={},records=[],coverageGaps=[],omitted=[]
  const candidateByName=new Map(candidates.map(pkg=>[pkg.name,pkg]))
  for(const name of [...new Set(constraints.map(c=>c.name))].sort()) {
    const declarations=constraints.filter(c=>c.name===name)
    const candidate=candidateByName.get(name)
    if(candidate) {
      assert.ok(declarations.every(c=>semver.satisfies(candidate.version,c.range)),`Candidate ${name}@${candidate.version} violates declared constraints`)
      candidateDependencies[name]=candidate.version
      continue
    }
    if(omitOptional.includes(name)) {
      assert.ok(declarations.every(c=>c.optional),`Cannot omit required dependency ${name}`)
      omitted.push({name,reason:'Optional peer deliberately absent; this profile does not execute its dependent functionality',declarations})
      continue
    }
    const metadata=registry[name]
    assert.ok(metadata?.versions,`Missing registry metadata: ${name}`)
    for(const declaration of declarations)for(const branch of branches(declaration.range)) {
      assert.ok(metadata.versions[branch.minimum],`Unpublished declared minimum: ${name}@${branch.minimum}`)
    }
    const versions=Object.keys(metadata.versions).filter(v=>semver.valid(v)&&!semver.prerelease(v)&&declarations.every(c=>semver.satisfies(v,c.range))).sort(semver.compare)
    assert.ok(versions.length,`No published intersection for ${name}`)
    const version=id==='minimum'?versions[0]:versions.at(-1),published=metadata.versions[version]
    assert.equal(published.version,version,`Registry version mismatch for ${name}`)
    assert.equal(published.name,name,`Registry name mismatch for ${name}`)
    assert.match(published.dist?.integrity??'',/^sha(?:256|384|512)-\S+$/,`Missing registry integrity for ${name}`)
    assert.ok(published.dist.tarball?.startsWith('https://registry.npmjs.org/'),`Non-public registry archive for ${name}`)
    dependencies[name]=version
    records.push({name,version,integrity:published.dist.integrity,resolved:published.dist.tarball,declarations})
    for(const declaration of declarations)for(const branch of branches(declaration.range))if(version!==branch.minimum) {
      coverageGaps.push({owner:declaration.owner,name,range:branch.range,minimum:branch.minimum,selected:version,reason:semver.satisfies(version,branch.range)?'Combined profile does not exercise this owner minimum':'Combined profile does not exercise this disjunctive branch'})
    }
  }
  return {id,dependencies,candidateDependencies,constraints,registrySelections:records,coverageGaps,omittedOptionalPeers:omitted,scope:'Combined five-archive application; owner and alternate-branch minima listed as gaps are not claimed as verified'}
}
export function verifyInstalledProfile(profile,packageJson,lock,installedVersions) {
  assert.ok(!packageJson.overrides&&!packageJson.resolutions,'Hidden dependency overrides are forbidden')
  return profile.registrySelections.map(selection=>{
    const {name,version,integrity,resolved}=selection,entry=lock.packages?.['node_modules/'+name]
    assert.equal(packageJson.dependencies?.[name],version,`Root must pin exact ${name}`)
    assert.equal(lock.packages?.['']?.dependencies?.[name],version,`Lock root must pin exact ${name}`)
    assert.equal(entry?.version,version,`Lock version mismatch for ${name}`)
    assert.equal(installedVersions[name],version,`Installed version mismatch for ${name}`)
    assert.equal(entry?.integrity,integrity,`Registry integrity mismatch for ${name}`)
    assert.equal(entry?.resolved,resolved,`Registry resolution mismatch for ${name}`)
    return {...selection,installedVersion:installedVersions[name]}
  })
}
