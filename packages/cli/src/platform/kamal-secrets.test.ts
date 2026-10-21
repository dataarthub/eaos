import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderKamalSecretsScript, type KamalSecretsTemplateOptions } from './kamal-secrets'

// Exercise the actual consumer: dotenv alone does not propagate failed shell substitutions.
const hasKamal = !!Bun.which('ruby') && Bun.spawnSync(['ruby', '-e', 'require "kamal"; require "kamal/cli"'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const supplied = { KAMAL_REGISTRY_USERNAME: 'host-user', KAMAL_REGISTRY_PASSWORD: 'host-token', ADB_CONNECT_STRING: 'tcps://database.example:1522/service', ADB_PASSWORD: 'host-db-password' }

async function consume(options: KamalSecretsTemplateOptions, env: Record<string, string>, mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'eaos-kamal-secrets-')); roots.push(root)
  const bin = join(root, 'bin'), calls = join(root, 'calls.jsonl'), secrets = join(root, 'secrets')
  await mkdir(bin)
  await writeFile(secrets, renderKamalSecretsScript(options))
  await writeFile(join(bin, 'pulumi'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.EAOS_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.EAOS_TEST_MODE === 'failure') { console.error('sensitive-provider-error'); process.exit(7); }
if (process.env.EAOS_TEST_MODE === 'invalid') { console.log('sensitive-invalid-json'); process.exit(0); }
const key = process.argv[process.argv.indexOf('output') + 1];
if (key === 'bindings') console.log(JSON.stringify({databaseConnection:'tcps://selected.example:1522/service'}));
else if (key === 'alternateAuth') console.log('selected-token');
else if (key === 'ocirAuthToken') console.log('standard-token');
else { console.error('wrong-output-key'); process.exit(8); }
`)
  await chmod(join(bin, 'pulumi'), 0o700)
  const child = Bun.spawnSync(['ruby', '-e', 'require "kamal"; require "kamal/cli"; puts JSON.generate(Kamal::Secrets.new(secrets_path: ARGV.fetch(0)).to_h.slice("KAMAL_REGISTRY_USERNAME", "KAMAL_REGISTRY_PASSWORD", "ADB_CONNECT_STRING", "ADB_PASSWORD"))', secrets], {
    env: { PATH: bin + ':' + process.env.PATH, HOME: process.env.HOME, ...env, EAOS_TEST_CALLS: calls, EAOS_TEST_MODE: mode },
    stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
  })
  return { root, child, stdout: child.stdout.toString(), stderr: child.stderr.toString(), calls: await readFile(calls, 'utf8').catch(() => '') }
}

describe.skipIf(!hasKamal)('Kamal 2 secret-template consumption', () => {
  test('uses host credentials byte-for-byte without running command text inside them', async () => {
    const marker = join(tmpdir(), 'eaos-should-not-execute-' + crypto.randomUUID())
    roots.push(marker)
    const values = { ...supplied, KAMAL_REGISTRY_PASSWORD: `token$UNSET_VALUE'"#\\$(touch ${marker})`, ADB_PASSWORD: 'db$UNSET_VALUE\\value#\'"' }
    const result = await consume({ defaultRegistryUser: 'ignored-fallback' }, values)
    expect(result.stderr).toBe('')
    expect(result.child.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(values)
    expect(result.calls).toBe('')
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test('command-looking and Unicode token values remain inert and unmodified', async () => {
    const marker = join(tmpdir(), 'eaos-token-not-executed-' + crypto.randomUUID()); roots.push(marker)
    for (const token of [`$(touch ${marker})`, '`touch ' + marker + '`', '😀$VAR ${UNSET} $$ $1 $- $) \\$VAR', ' leading and trailing ']) {
      const result = await consume({}, { ...supplied, KAMAL_REGISTRY_PASSWORD: token })
      expect(result.stderr).toBe('')
      expect(result.child.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).KAMAL_REGISTRY_PASSWORD).toBe(token)
      expect(await Bun.file(marker).exists()).toBe(false)
    }
  })

  test('OCI token alias precedes Pulumi and the default fallback uses the generated preset directory', async () => {
    const alias = await consume({}, { ...supplied, KAMAL_REGISTRY_PASSWORD: '', OCI_AUTH_TOKEN: 'aliased-token' })
    expect(alias.child.exitCode).toBe(0)
    expect(JSON.parse(alias.stdout).KAMAL_REGISTRY_PASSWORD).toBe('aliased-token')
    expect(alias.calls).toBe('')
    const defaults = await consume({}, { ...supplied, KAMAL_REGISTRY_PASSWORD: '' })
    expect(defaults.child.exitCode).toBe(0)
    expect(JSON.parse(defaults.stdout).KAMAL_REGISTRY_PASSWORD).toBe('standard-token')
    expect(JSON.parse(defaults.calls.trim())).toEqual(['--cwd', 'pulumi', 'stack', 'output', 'ocirAuthToken', '--show-secrets'])
  })

  test('resolves selected Pulumi outputs and treats a shell-shaped directory as one argument', async () => {
    const marker = join(tmpdir(), 'eaos-options-not-executed-' + crypto.randomUUID())
    roots.push(marker)
    const directory = `infra with spaces/'$(touch ${marker})#`
    const result = await consume({ tenancyNamespace: 'namespace', identityDomain: 'Domain', username: 'user@example.com', pulumiDir: directory, authTokenSecretName: 'alternateAuth' }, { ADB_PASSWORD: supplied.ADB_PASSWORD })
    expect(result.stderr).toBe('')
    expect(result.child.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ ...supplied, KAMAL_REGISTRY_USERNAME: 'namespace/Domain/user@example.com', KAMAL_REGISTRY_PASSWORD: 'selected-token', ADB_CONNECT_STRING: 'tcps://selected.example:1522/service' })
    expect(result.calls.trim().split('\n').map(line => JSON.parse(line))).toEqual([
      ['--cwd', directory, 'stack', 'output', 'alternateAuth', '--show-secrets'],
      ['--cwd', directory, 'stack', 'output', 'bindings', '--json', '--show-secrets'],
    ])
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test('missing mandatory bindings and failed or invalid Pulumi data stop Kamal without leaking values', async () => {
    for (const [key, mode] of [['ADB_PASSWORD', 'success'], ['KAMAL_REGISTRY_USERNAME', 'success'], ['KAMAL_REGISTRY_PASSWORD', 'failure'], ['ADB_CONNECT_STRING', 'failure'], ['ADB_CONNECT_STRING', 'invalid']] as const) {
      const values: Record<string, string> = { ...supplied }; delete values[key]
      const result = await consume({}, values, mode)
      expect(result.child.exitCode).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toContain('sensitive-provider-error')
      expect(result.stderr).not.toContain('sensitive-invalid-json')
      expect(result.stderr).not.toContain(supplied.ADB_PASSWORD)
    }
  })
})

test('rejects control characters and option-like output names without reflecting their values', () => {
  for (const options of [{ defaultRegistryUser: 'private-marker\nOTHER=value' }, { pulumiDir: 'private-marker\0' }, { authTokenSecretName: '--private-marker' }]) {
    expect(() => renderKamalSecretsScript(options)).toThrow()
    try { renderKamalSecretsScript(options) } catch (error) { expect(String(error)).not.toContain('private-marker') }
  }
})
