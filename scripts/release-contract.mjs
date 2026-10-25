import { appkitVersions } from './appkit-versions.mjs'
import semver from 'semver'

export function validateManifest(pkg) {
  const errors = []
  if (!pkg.name?.startsWith('@alneas/eaos-') || !semver.valid(pkg.version)) errors.push('Invalid package name/version')
  if (pkg.private || pkg.license !== 'MIT' || pkg.type !== 'module') errors.push('Expected public MIT ESM package')
  if (pkg.publishConfig?.registry !== 'https://registry.npmjs.org' || pkg.publishConfig?.access !== 'public') errors.push('Expected public npmjs destination')
  if (pkg.engines?.node !== '>=24.0.0') errors.push('Node 24 minimum required by Appkit')
  if (!pkg.files?.includes('CHANGELOG.md')) errors.push('Include CHANGELOG.md in files')
  for (const field of ['dependencies','peerDependencies','optionalDependencies','devDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (name.startsWith('@dataarthub/') || /^(file:|link:|git|https?:|\/|\.\.)/.test(range)) errors.push(`Non-public dependency ${field}:${name}`)
      if (Object.hasOwn(appkitVersions, name) && range !== appkitVersions[name]) errors.push(`Appkit must be exactly ${appkitVersions[name]}: ${name}`)
    }
  }
  for (const key of Object.keys(pkg.exports ?? {})) if (key.includes('*') || /^\.\/(src|dist)(\/|$)/.test(key)) errors.push(`Unsupported public entry ${key}`)
  return errors
}

export function publicationOrder(packages) {
  const byName = new Map(packages.map(pkg => [pkg.name,pkg])), visited = new Set(), active = new Set(), result = []
  if (byName.size !== packages.length) throw Error('Duplicate package names')
  function visit(pkg) {
    if (visited.has(pkg.name)) return
    if (active.has(pkg.name)) throw Error(`Publication dependency cycle: ${pkg.name}`)
    active.add(pkg.name)
    for (const [name,range] of Object.entries({ ...pkg.peerDependencies,...pkg.dependencies,...pkg.optionalDependencies })) {
      if (!name.startsWith('@alneas/eaos-')) continue
      const dependency = byName.get(name)
      if (!dependency) throw Error(`Missing internal package: ${name}`)
      if (!semver.satisfies(dependency.version, range)) throw Error(`Incompatible internal dependency ${pkg.name} -> ${name}@${range}`)
      visit(dependency)
    }
    active.delete(pkg.name);visited.add(pkg.name);result.push(pkg)
  }
  packages.forEach(visit)
  return result
}

function exportTargets(value) {
  if (typeof value === 'string') return [value]
  return Object.values(value ?? {}).flatMap(exportTargets)
}

export function auditPackedFiles(pkg, files) {
  const errors = [], paths = new Set(files.map(file => file.path))
  for (const required of ['package.json','README.md','LICENSE','CHANGELOG.md',...exportTargets(pkg.exports).map(x=>x.replace(/^\.\//,''))]) {
    if (!paths.has(required)) errors.push(`Missing packed file: ${required}`)
  }
  const allowed = ['package.json','README.md','LICENSE',...(pkg.files ?? [])]
  for (const {path,content = ''} of files) {
    if (path.includes('..') || path.startsWith('/') || path.includes('\\') || /(^|\/)(node_modules|\.verification|\.git|\.changeset|coverage|tests?|fixtures|\.env)(\/|\.|$)/.test(path) || /\.(test|spec)\./.test(path)) errors.push(`Forbidden packed file: ${path}`)
    if (!allowed.some(prefix => path===prefix || path.startsWith(prefix+'/'))) errors.push(`Unexpected packed file: ${path}`)
    if (path.startsWith('src/') && !path.endsWith('.json')) errors.push(`Uncompiled source: ${path}`)
    if (/\.(?:[cm]?js|[cm]?ts|map|json)$/.test(path) && /@dataarthub\/(?:app-core|react-tools)|\/Users\/|\/Volumes\/|(?:private\/eaos-framework|eaos-private)/.test(content)) errors.push(`Private or local reference in ${path}`)
  }
  return errors
}

export function requiredTags(version) {
  if (!semver.valid(version)) throw Error('Invalid version')
  return semver.lt(version,'1.0.0') ? ['beta','latest'] : ['latest']
}

export function verifyCandidateIdentity(bundle, current) {
  if(bundle.sourceHash!==current.sourceHash)throw Error('Candidate source changed')
  if(!['working-tree','commit-bound'].includes(bundle.state))throw Error('Unknown candidate state')
  if(bundle.state==='commit-bound' && (!bundle.commit || bundle.commit!==current.cleanCommit))throw Error('Candidate commit differs from current clean commit')
  const consumer=bundle.consumerVerified
  const identity=items=>items.map(({name,version,sha256})=>({name,version,sha256}))
  if(!consumer || consumer.sourceHash!==bundle.sourceHash || JSON.stringify(consumer.archives)!==JSON.stringify(identity(bundle.archives)))throw Error('Missing or stale consumer evidence')
}
