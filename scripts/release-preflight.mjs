import { appkitVersions, supportedAppkitRange } from './appkit-versions.mjs'
import semver from 'semver'
import { requiredTags } from './release-contract.mjs'

const PUBLIC_REGISTRY = 'https://registry.npmjs.org'
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const validIntegrity = value => typeof value === 'string' && /^sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(value)
const registryFailure = Symbol('registry-failure')
const failure = code => Object.assign(new Error(code), { code, [registryFailure]:true })
const sanitizedCode = cause => cause?.[registryFailure] ? cause.code : 'registry-read-failed'

async function readMetadata(name, {fetch, registry, timeoutMs, maxBodyBytes, path = encodeURIComponent(name), kind = 'package'}) {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(failure('registry-timeout')) }, timeoutMs)
  })
  const request = (async () => {
    let response
    try {
      response = await fetch(`${registry}/${path}`, {
        method: 'GET', redirect: 'error', credentials: 'omit',
        headers: {Accept: kind === 'package' ? 'application/vnd.npm.install-v1+json' : 'application/json'}, signal: controller.signal,
      })
    } catch { throw failure('registry-unreachable') }
    if (response.url && new URL(response.url).origin !== registry) throw failure('registry-redirect')
    if (response.status === 404) { response.body?.cancel().catch(() => {}); return null }
    if (response.status !== 200) {
      response.body?.cancel().catch(() => {})
      throw failure(response.status === 401 || response.status === 403 ? 'registry-permission-denied' : 'registry-http-error')
    }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes)) {
      response.body?.cancel().catch(() => {})
      throw failure('registry-body-too-large')
    }
    if (!response.body) throw failure('registry-invalid-metadata')
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      while (true) {
        const {done, value} = await Promise.race([reader.read(), deadline])
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBodyBytes) throw failure('registry-body-too-large')
        chunks.push(Buffer.from(value))
      }
    } finally { reader.cancel().catch(() => {}); reader.releaseLock() }
    let metadata
    try { metadata = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw failure('registry-invalid-metadata') }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw failure('registry-invalid-metadata')
    if (kind === 'package' && (metadata.name !== name || !metadata.versions || typeof metadata.versions !== 'object' || Array.isArray(metadata.versions))) throw failure('registry-invalid-metadata')
    return metadata
  })()
  try { return await Promise.race([request, deadline]) }
  finally { clearTimeout(timer); controller.abort() }
}

export async function registryPreflight({packages, archives, mode = 'bootstrap', selectedName, fetch = globalThis.fetch, registry = PUBLIC_REGISTRY, timeoutMs = 10000, maxBodyBytes = 8 * 1024 * 1024}) {
  if (registry !== PUBLIC_REGISTRY) throw Error('Expected exact public npm registry')
  if (!['bootstrap','publish'].includes(mode)) throw Error('Unknown preflight mode')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 32 * 1024 * 1024) throw Error('Invalid registry read limits')
  if (!Array.isArray(packages) || !Array.isArray(archives) || typeof fetch !== 'function') throw Error('Invalid preflight inputs')
  const byName = new Map(packages.map(pkg => [pkg.name,pkg]))
  const candidates = new Map(archives.map(item => [item.name,item]))
  if (byName.size !== packages.length || candidates.size !== archives.length) throw Error('Duplicate preflight targets')
  for (const item of archives) {
    const pkg = byName.get(item.name)
    if (!pkg || !packageName.test(item.name) || !semver.valid(item.version) || pkg.version !== item.version || !validIntegrity(item.integrity)) throw Error('Invalid candidate identity')
    if (JSON.stringify(item.requiredTags) !== JSON.stringify(requiredTags(item.version))) throw Error('Invalid candidate required tags')
  }
  if (packages.some(pkg => !candidates.has(pkg.name))) throw Error('Missing candidate archive')
  if (mode === 'publish' && !candidates.has(selectedName)) throw Error('publish mode requires a candidate selectedName')
  if (selectedName !== undefined && !candidates.has(selectedName)) throw Error('Unknown selectedName')
  const report = {schemaVersion:1, registry, mode, ...(selectedName ? {selectedName} : {}), ok:true, targets:[], errors:[], maintainerConfirmationRequired:[]}
  const cache = new Map()
  const metadata = name => {
    if (!cache.has(name)) cache.set(name, readMetadata(name,{fetch, registry, timeoutMs, maxBodyBytes}))
    return cache.get(name)
  }
  const error = (code, name, dependency) => {
    report.ok = false
    report.errors.push({code, package:name, ...(dependency ? {dependency} : {}), message:code})
  }
  const versionRecord = (data, name, version) => {
    const record = data?.versions[version]
    if (!record || record.name !== name || record.version !== version || !validIntegrity(record.dist?.integrity)) throw failure('registry-invalid-version')
    return record
  }
  const limitedDependencyMetadata = async (name, range) => {
    const options = {fetch, registry, timeoutMs, maxBodyBytes}
    const tags = await readMetadata(name, {...options, path:`-/package/${encodeURIComponent(name)}/dist-tags`, kind:'tags'})
    if (!tags || !Object.values(tags).every(value => typeof value === 'string' && semver.valid(value))) throw failure('registry-invalid-channel')
    const channel = semver.rsort(Object.values(tags).filter(version => semver.satisfies(version,range)))[0]
    const floor = semver.minVersion(range)?.version
    // Limited exact probes prove availability only; their failure cannot establish range-wide absence.
    for (const version of new Set([channel,floor].filter(Boolean))) {
      const record = await readMetadata(name, {...options, path:`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, kind:'version'})
      if (!record) continue
      const data = {name, versions:{[version]:record}, 'dist-tags':tags}
      versionRecord(data,name,version)
      return data
    }
    throw failure('dependency-range-unresolved')
  }
  for (const pkg of packages.filter(pkg => !selectedName || pkg.name === selectedName)) {
    const item = candidates.get(pkg.name)
    const target = {name:pkg.name, version:pkg.version, status:'unconfirmed', requiredTags:item.requiredTags, tags:{}, dependencies:[]}
    report.targets.push(target)
    try {
      const data = await metadata(pkg.name)
      if (!data) {
        target.status = 'maintainer-confirmation-required'
        report.maintainerConfirmationRequired.push(pkg.name)
      } else {
        const tags = data['dist-tags'] ?? {}
        if (!tags || typeof tags !== 'object' || Array.isArray(tags)) throw failure('registry-invalid-metadata')
        for (const tag of item.requiredTags) {
          if (tags[tag] === undefined) continue
          if (!semver.valid(tags[tag])) throw failure('registry-invalid-channel')
          target.tags[tag] = tags[tag]
          if (semver.gt(tags[tag], item.version)) error('newer-channel', pkg.name)
        }
        if (Object.hasOwn(data.versions, item.version)) {
          const record = versionRecord(data, pkg.name, item.version)
          if (record.dist.integrity !== item.integrity) { target.status = 'integrity-conflict'; error('integrity-conflict',pkg.name) }
          else target.status = 'already-published'
        } else {
          target.status = 'existing-package'
          error('first-publication-ineligible',pkg.name)
        }
      }
    } catch (cause) { error(sanitizedCode(cause), pkg.name) }
    for (const type of ['dependencies','peerDependencies','optionalDependencies']) {
      for (const [name,range] of Object.entries(pkg[type] ?? {})) {
        const dependency = {name, range, type, status:'unconfirmed'}
        target.dependencies.push(dependency)
        try {
          if (!packageName.test(name) || !semver.validRange(range)) throw failure('invalid-dependency-range')
          if (!supportedAppkitRange(name, range)) throw failure('appkit-compatible-range-required')
          const candidate = candidates.get(name)
          if (name.startsWith('@alneas/eaos-') && (!candidate || !semver.satisfies(candidate.version, range))) throw failure('internal-candidate-incompatible')
          let data
          try { data = await metadata(name) }
          catch (cause) {
            if (sanitizedCode(cause) !== 'registry-body-too-large' || candidate || name.startsWith('@alneas/eaos-')) throw cause
            data = await limitedDependencyMetadata(name,range)
          }
          const matches = data ? Object.keys(data.versions).filter(version => semver.valid(version) && semver.satisfies(version,range)) : []
          // A selected predecessor is the exact reviewed prerequisite, even if a different version also satisfies its range.
          const version = candidate && semver.satisfies(candidate.version,range) ? candidate.version : semver.rsort(matches)[0]
          if (!version || !data?.versions[version]) {
            if (mode === 'bootstrap' && candidate && semver.satisfies(candidate.version,range)) {
              dependency.status = 'pending-internal'
              dependency.version = candidate.version
              continue
            }
            throw failure('dependency-unavailable')
          }
          const record = versionRecord(data,name,version)
          if (candidate && version === candidate.version && record.dist.integrity !== candidate.integrity) throw failure('dependency-integrity-conflict')
          dependency.status = 'available'
          dependency.version = version
          dependency.integrity = record.dist.integrity
        } catch (cause) { dependency.status = 'blocked'; error(sanitizedCode(cause),pkg.name,name) }
      }
    }
  }
  return report
}
