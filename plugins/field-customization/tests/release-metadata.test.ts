import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { satisfies } from 'semver'
import { FRAMEWORK_VERSION } from '@alneas/eaos-server/lifecycle-engine'
import { manifest } from '../manifest'
import { lifecycle } from '../src/lifecycle'

test('published plugin identity and lifecycle compatibility follow the package release', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const deployment = JSON.parse(await readFile(new URL('../deployment.json', import.meta.url), 'utf8'))
  expect(deployment.owner).toBe(pkg.name+'/field-customization')
  expect(deployment.version).toBe(pkg.version)
  expect(manifest.version).toBe(pkg.version)
  expect(lifecycle.version).toBe(pkg.version)
  expect(lifecycle.framework).toBe(pkg.peerDependencies['@alneas/eaos-server'])
  expect(satisfies(FRAMEWORK_VERSION, lifecycle.framework)).toBe(true)
})
