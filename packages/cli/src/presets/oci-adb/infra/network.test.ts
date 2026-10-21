import { expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
const created: pulumi.runtime.MockResourceArgs[] = []
pulumi.runtime.setMocks({
 newResource: args => { created.push(args); return { id: `${args.name}-id`, state: { ...args.inputs, ...(args.type === 'oci:Database/autonomousDatabase:AutonomousDatabase' ? { connectionStrings: [{ profiles: [{ consumerGroup: 'LOW', tlsAuthentication: 'SERVER', protocol: 'TCPS', hostFormat: 'FQDN', syntaxFormat: 'LONG', value: 'tcps-test' }] }] } : {}) } } },
 call: args => args.token.includes('getServices') ? { services: [{ id: 'oci-all', name: 'All TEST Services In Oracle Services Network', cidrBlock: 'all-test-services' }] } : args.inputs,
}, 'test-project', 'dedicated', false)

test('network resources use the calling deployment inputs', async () => {
 const { createOciNetwork } = await import('./index')
 expect(created).toHaveLength(0)
 const network = createOciNetwork('tenant-a', { compartmentId: 'compartment-a', cidrBlock: '10.8.0.0/16', subnetCidrBlock: '10.8.1.0/24' })
 await new Promise<void>((resolve, reject) => {
  pulumi.all([network.vcn.id, network.gateway.id, network.routes.id, network.securityList.id, network.subnet.id]).apply(() => {
   try {
    expect(created.filter(r => r.type.startsWith('oci:'))).toHaveLength(5)
    expect(created.find(r => r.name === 'tenant-a-vcn')?.inputs.compartmentId).toBe('compartment-a')
    expect(created.find(r => r.name === 'tenant-a-public-subnet')?.inputs.cidrBlock).toBe('10.8.1.0/24')
    expect(created.find(r => r.name === 'tenant-a-sl')?.inputs.ingressSecurityRules).toEqual([])
    resolve()
   } catch (error) { reject(error) }
  })
 })
})

test('KMS key defaults use provider byte lengths and preserve explicit native shapes', async () => {
 const { createOciVaultKey } = await import('./vault')
 const common = { compartmentId: 'compartment-a', managementEndpoint: 'https://vault.example.com' }
 const keys = [
  createOciVaultKey('default-aes', common),
  createOciVaultKey('default-rsa', { ...common, algorithm: 'RSA' }),
  createOciVaultKey('default-ecdsa', { ...common, algorithm: 'ECDSA' }),
  createOciVaultKey('explicit-rsa', { ...common, algorithm: 'RSA', length: 512 }),
  createOciVaultKey('native-shape', { ...common, key: { keyShape: { algorithm: 'ECDSA', length: 48, curveId: 'NIST_P384' } } }),
 ]
 await new Promise<void>((resolve, reject) => { pulumi.all(keys.map(key => key.urn)).apply(() => { try {
  expect(created.find(resource => resource.name === 'default-aes')?.inputs.keyShape).toEqual({ algorithm: 'AES', length: 32 })
  expect(created.find(resource => resource.name === 'default-rsa')?.inputs.keyShape).toEqual({ algorithm: 'RSA', length: 256 })
  expect(created.find(resource => resource.name === 'default-ecdsa')?.inputs.keyShape).toEqual({ algorithm: 'ECDSA', length: 32 })
  expect(created.find(resource => resource.name === 'explicit-rsa')?.inputs.keyShape).toEqual({ algorithm: 'RSA', length: 512 })
  expect(created.find(resource => resource.name === 'native-shape')?.inputs.keyShape).toEqual({ algorithm: 'ECDSA', length: 48, curveId: 'NIST_P384' })
  resolve()
 } catch (error) { reject(error) } }) })
})

test('native Vault content overrides remain Pulumi secrets without being encoded twice', async () => {
 const { createOciVaultSecret } = await import('./vault')
 const resource = createOciVaultSecret('native-secret', {
  compartmentId: 'compartment-a', vaultId: 'vault-a', keyId: 'key-a', secretName: 'fixture', secretContent: 'unused-default',
  secret: { secretContent: { contentType: 'BASE64', content: 'c3ludGhldGlj' } },
 })
 await new Promise<void>((resolve, reject) => { resource.secretContent.apply(content => { try {
  expect(content).toEqual({ contentType: 'BASE64', content: 'c3ludGhldGlj' })
  resolve()
 } catch (error) { reject(error) } }) })
 expect(await pulumi.isSecret(resource.secretContent)).toBe(true)
})

test('OCI standard preset keeps DB and buckets private and routes database traffic through the service gateway', async () => {
 const { createOciAdbPreset } = await import('../index')
 const stack = createOciAdbPreset('standard', {
  compartmentId: 'compartment-a', availabilityDomain: 'AD-1', edgeImageId: 'ubuntu-amd64', workerImageId: 'ubuntu-arm64',
  sshAuthorizedKeys: 'ssh-ed25519 test', sshCidr: '192.0.2.0/24', dbName: 'EAOSTEST', dbVersion: '23ai', adminPassword: pulumi.secret('sensitive-admin'), objectStorageNamespace: 'namespace-a',
 })
 await new Promise<void>((resolve, reject) => {
  pulumi.all([stack.network.privateSubnet.id, stack.network.serviceGateway!.id, stack.edge.id, stack.worker.id, stack.database.id, stack.bucket.id, stack.key.id]).apply(() => {
   try {
    const database = created.find(r => r.name === 'standard-db')!.inputs
    expect(database.whitelistedIps).toEqual(['standard-vcn-id'])
    const bucket = created.find(r => r.name === 'standard-objects')!.inputs
    expect(bucket.accessType).toBe('NoPublicAccess'); expect(bucket.versioning).toBe('Enabled')
    const edge = created.find(r => r.name === 'standard-edge')!.inputs, worker = created.find(r => r.name === 'standard-worker')!.inputs
    expect(edge.createVnicDetails.assignPublicIp).toBe('true'); expect(worker.createVnicDetails.assignPublicIp).toBe('false')
    const publicRules = created.find(r => r.name === 'standard-public-security-list')!.inputs.ingressSecurityRules
    expect(publicRules.find((r: any) => r.tcpOptions.min === 22).source).toBe('192.0.2.0/24')
    expect(publicRules.filter((r: any) => r.tcpOptions.min === 4434).every((r: any) => r.source !== '0.0.0.0/0')).toBe(true)
    resolve()
   } catch (error) { reject(error) }
  })
 })
 expect(await pulumi.isSecret(stack.bindings.databaseConnection)).toBe(true)
 expect(() => createOciAdbPreset('invalid', { ...({} as any), sshCidr: '0.0.0.0/0' })).toThrow('restricted')
})
