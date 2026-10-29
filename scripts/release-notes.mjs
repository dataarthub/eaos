import assert from 'node:assert/strict'
import semver from 'semver'
import {createHash} from 'node:crypto'

function meaningfulBody(text) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !/^#+(?:\s|$)/.test(line))
    .map(line => line.replace(/^[-*+]\s*/, '').trim()).filter(Boolean)
  return lines.length > 0 && !lines.some(line => /^(?:TODO|TBD|coming soon|placeholder)(?:\b|[.!:])/i.test(line))
}

export function changelogEntry(text, version) {
  assert(semver.valid(version), 'Invalid release version')
  const entries = [...text.matchAll(/^##[ \t]+([^\r\n]+)\r?$/gm)]
  const selected = entries.filter(entry => {
    const match = entry[1].match(/^\[?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?:\]|\s|$)/)
    return match?.[1] === version
  })
  assert.equal(selected.length, 1, `Expected one changelog entry for ${version}`)
  const heading = selected[0]
  const end = entries.find(entry => entry.index > heading.index)?.index ?? text.length
  const entry = text.slice(heading.index, end).trim()
  assert(meaningfulBody(entry.slice(entry.indexOf('\n') + 1)), `Empty or placeholder changelog for ${version}`)
  return entry
}

export function releaseNotes(pkg, changelog) {
  return `# ${pkg.name} ${pkg.version}\n\n${changelogEntry(changelog, pkg.version)}\n`
}

export function verifyReleaseNotes(pkg, {sourceChangelog,packedChangelog,notes,sha256}) {
  assert.equal(packedChangelog,sourceChangelog,'Packed CHANGELOG differs from canonical source')
  assert.equal(notes,releaseNotes(pkg,sourceChangelog),'Release notes differ from canonical version entry')
  assert.equal(createHash('sha256').update(notes).digest('hex'),sha256,'Release notes hash differs')
}

export function fragmentTargets(text,{minimumSummaryLength=0}={}) {
  const normalized = text.replace(/\r\n/g, '\n')
  const frontmatter = normalized.match(/^---\n(?:([\s\S]*?)\n)?---(?:\n|$)([\s\S]*)$/)
  assert(frontmatter && meaningfulBody(frontmatter[2]), 'Expected Changeset frontmatter and consumer summary')
  assert(frontmatter[2].trim().length>minimumSummaryLength,'Explain consumer impact')
  const lines = (frontmatter[1]??'').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  if (lines.length === 1 && lines[0] === '{}') return []
  if(!lines.length) {
    const rationale=frontmatter[2].trim()
    assert(/^No[ -]release:/i.test(rationale)&&rationale.length>=40,'Meaningful No-release rationale required')
    return []
  }
  const targets = new Set()
  for (const line of lines) {
    const match = line.match(/^(?:"(@?[a-z0-9][a-z0-9._/-]*)"|'(@?[a-z0-9][a-z0-9._/-]*)'|(@?[a-z0-9][a-z0-9._/-]*))\s*:\s*(patch|minor|major)\s*(?:#.*)?$/)
    assert(match, 'Expected package name and patch/minor/major impact')
    const name = match[1] ?? match[2] ?? match[3]
    assert(!targets.has(name), 'Duplicate Changeset package target')
    targets.add(name)
  }
  return [...targets]
}

export function pendingReleaseErrors(packages, fragments) {
  const selected = new Set(packages.map(pkg => pkg.name))
  const errors = []
  for (const { filename, text } of fragments) {
    let targets
    try { targets = fragmentTargets(text) }
    catch (error) { errors.push(`Malformed Changeset ${filename}: ${error.message}`); continue }
    for (const target of targets) {
      if (selected.has(target)) errors.push(`Unconsumed Changeset ${filename} selects ${target}; review version preparation first`)
    }
  }
  return errors
}
