import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as notes from './release-notes.mjs'

const pkg = { name: '@alneas/eaos-core', version: '0.1.0' }
const history = '# Changelog\n\n## Unreleased\n\n- Future behavior.\n\n## 0.1.0\n\n### Added\n\n- Initial public SDK.\n\n## 0.0.1\n\n- Earlier candidate.\n'

test('extracts only the exact selected version and derives its package notes', () => {
  const entry = '## 0.1.0\n\n### Added\n\n- Initial public SDK.'
  assert.equal(notes.changelogEntry(history, pkg.version), entry)
  assert.equal(notes.releaseNotes(pkg, history), '# @alneas/eaos-core 0.1.0\n\n'+entry+'\n')
  assert.equal(notes.changelogEntry('## [0.1.0] - 2026-10-21\n\n- Public SDK.\n', '0.1.0'), '## [0.1.0] - 2026-10-21\n\n- Public SDK.')
})

test('rejects missing or duplicate versions without matching prefix or prerelease versions', () => {
  for (const text of ['## 0.1.01\n\n- Other version.', '## 0.1.0-beta.1\n\n- Prerelease.', history+'\n## v0.1.0\n\n- Duplicate.']) {
    assert.throws(() => notes.changelogEntry(text, '0.1.0'), /one changelog entry/i)
  }
})

test('rejects empty, comment-only, section-only and placeholder version entries', () => {
  for (const body of ['', '<!-- Await review -->', '### Added', '- TODO', 'TBD.', '- Coming soon', '- Placeholder', '### Fixed\n\n<!-- pending -->\n\n- TODO: write release notes']) {
    assert.throws(() => notes.changelogEntry('## 0.1.0\n\n'+body+'\n\n## 0.0.1\n\n- Real older note.', '0.1.0'), /empty|placeholder/i, body)
  }
})

const fragment = (text, filename = 'pending-sdk.md') => ({ filename, text })
test('pending fragments block only selected package targets and retain the fragment identity', () => {
  const fragments = [fragment('---\n"@alneas/eaos-core": patch\n"@alneas/eaos-react": minor\n---\n\nAdd consumer behavior.')]
  const errors = notes.pendingReleaseErrors([pkg], fragments)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /pending-sdk\.md/)
  assert.match(errors[0], /@alneas\/eaos-core/)
  assert.deepEqual(notes.pendingReleaseErrors([{name:'@alneas/eaos-server'}], fragments), [])
  assert.deepEqual(notes.pendingReleaseErrors([pkg], [fragment('---\n{}\n---\n\nMaintainer-only change.')]), [])
})

test('malformed pending records fail closed even when no selected package can be parsed', () => {
  for (const text of ['No frontmatter', '---\n"@alneas/eaos-core": patch\nNo closing delimiter', '---\n"@alneas/eaos-core": urgent\n---\nSummary.', '---\n"@alneas/eaos-core": patch\n"@alneas/eaos-core": minor\n---\nSummary.', '---\n"@alneas/eaos-core": patch\n---\n<!-- missing summary -->', '---\nreleases:\n  - package: "@alneas/eaos-core"\n---\nSummary.', '---\n\n---\nSummary.']) {
    const errors = notes.pendingReleaseErrors([pkg], [fragment(text)])
    assert.equal(errors.length, 1, text)
    assert.match(errors[0], /malformed.*pending-sdk\.md/i)
  }
})
