import { safePath, readJson } from './files'
export { safePath, readJson } from './files'
export { expandPreset, resolveProjectManifest, type PresetManifest } from './preset'
export { acquireFrontendArtifact, stageFrontendArtifacts, type StageFrontendOptions } from './frontend'
export { generateFeatureRegistrations, selectClientBindings, type OfficialFeatureDescriptor, type FeatureRegistrationOptions } from './feature-registrations'
export { createDeploymentPlan } from './deployment-plan'
export { inspectDeploymentStatus, recordDeploymentResult, renderDeploymentStatusMarkdown } from './deployment-status'
export { stagePlatformPackages, platformPackageBundleId, registerPlatformPackage, unregisterPlatformPackage, readPlatformPackages, readPlatformRuntime, verifyPlatformPackages, loadRegisteredPlatformModules } from './packages'
export type { PlatformPackage, DeploymentInventory, PlatformRuntimeConfig } from '@alneas/eaos-server/platform'
export { renderKamalSecretsScript, type KamalSecretsTemplateOptions } from './kamal-secrets'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { cliVersion, frameworkVersion } from '../version'
import { emailIdentitySchema, googleMapperFile, json, registrationBodyFile, renderPlatform, resolveManifest } from './render'
export type { PlatformManifest, PlatformDeployment, ServiceDefinition } from './render'
export type { KamalDeployment } from './kamal'

const outputPath = '.eaos/generated/platform'
const receiptName = 'receipt.json'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const managedName = (name: string) => ['runtime.json', 'packages.json', 'deployment-plan.json', 'deployment-placements.json', 'resolved.json', 'hono.json', 'services.json', 'compose.yml', 'kamal-backend.yml', 'kamal-frontend.yml', 'kamal-worker.yml', 'kamal-agent-runtime.yml', 'kamal-operations.json', 'runtime-contract.json', 'runtime-policy.json', 'nginx/nginx.conf', 'kratos/kratos.yml', registrationBodyFile, googleMapperFile].includes(name) || /^kratos\/identity-[A-Za-z0-9_-]{1,128}\.json$/.test(name)
function fail(message: string): never { throw new Error(`Platform generation: ${message}`) }
async function stat(path: string) {
  try { return await lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function readJsonnet(root: string, relative: string): Promise<string> {
  if (relative.replace(/^\.\//, '').startsWith('.eaos/')) fail('Jsonnet sources must live outside generated state')
  const path = await safePath(root, relative), item = await stat(path)
  if (!item?.isFile() || item.size === 0 || item.size > 1024 * 1024) fail('expected a regular Jsonnet file of 1 byte to 1 MiB')
  const bytes = await readFile(path)
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail('Jsonnet source must be UTF-8 (contents omitted)') }
  if (!content.trim() || content.includes('\0')) fail('Jsonnet source must be non-empty text without NUL (contents omitted)')
  return content
}
interface Receipt { formatVersion: 1; cliVersion: string; frameworkVersion: string; inputHash: string; schemaHashes: Record<string, string>; files: Record<string, string> }
function validHashes(value: unknown, validKey: (key: string) => boolean): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, digest]) => validKey(key) && typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest))
}
async function readReceipt(root: string): Promise<Receipt | undefined> {
  const path = await safePath(root, `${outputPath}/${receiptName}`)
  if (!await stat(path)) return undefined
  const { data } = await readJson(path)
  const r = data as Receipt
  if (!r || typeof r !== 'object' || Object.keys(r).sort().join(',') !== 'cliVersion,files,formatVersion,frameworkVersion,inputHash,schemaHashes' || r.formatVersion !== 1 ||
      typeof r.cliVersion !== 'string' || typeof r.frameworkVersion !== 'string' || !/^[a-f0-9]{64}$/.test(r.inputHash) ||
      !validHashes(r.files, managedName) || Object.keys(r.files).length === 0 || !validHashes(r.schemaHashes, key => /^[A-Za-z0-9_-]{1,128}$/.test(key))) fail('invalid receipt; restore the committed receipt before regenerating')
  return r
}
async function inventory(root: string, relative: string): Promise<string[]> {
  const path = await safePath(root, relative)
  const item = await stat(path)
  if (!item) return []
  if (!item.isDirectory()) fail('generated output must be a directory')
  const files: string[] = []
  for (const name of (await readdir(path)).sort()) {
    const child = await safePath(root, `${relative}/${name}`)
    const entry = await stat(child)
    if (entry?.isDirectory()) files.push(...await inventory(root, `${relative}/${name}`))
    else if (entry?.isFile()) files.push(`${relative}/${name}`.slice(outputPath.length + 1))
    else fail('unsupported generated output entry')
  }
  return files
}
async function prepare(root: string, configPath: string) {
  if (configPath.replace(/^\.\//, '').startsWith('.eaos/')) fail('configuration must live outside generated state')
  const input = await readJson(await safePath(root, configPath))
  const { resolveProjectManifest } = await import('./preset')
  const { resolved: { config, deployment, packages, runtime }, inventories } = await resolveProjectManifest(root, input.data)
  const schemas: Record<string, unknown> = Object.create(null)
  const schemaHashes: Record<string, string> = Object.create(null)
  for (const schema of config.kratos.identitySchemas) {
    if (schema.source.type === 'builtin') schemas[schema.id] = emailIdentitySchema
    else {
      if (schema.source.path.replace(/^\.\//, '').startsWith('.eaos/')) fail('identity schemas must live outside generated state')
      const source = await readJson(await safePath(root, schema.source.path))
      const value = source.data as { type?: unknown; properties?: { traits?: { type?: unknown } } }
      if (!value || value.type !== 'object' || value.properties?.traits?.type !== 'object') fail('identity schema requires object root and object traits')
      schemas[schema.id] = source.data
      schemaHashes[schema.id] = hash(source.text)
    }
  }
  const hook = config.kratos.registrationHook
  const registrationBody = hook && hook.body && typeof hook.body === 'object' ? await readJsonnet(root, hook.body.path) : undefined
  const oidc = config.kratos.oidc
  const googleMapper = oidc && typeof oidc.google.mapper === 'object' ? await readJsonnet(root, oidc.google.mapper.path) : undefined
  // Jsonnet is copied, never executed. Output hashes also track custom body source changes.
  const files = renderPlatform(config, deployment, schemas, { registrationBody, googleMapper })
  if (runtime) files['runtime.json'] = json(runtime)
  if (packages.length) {
    const { verifyPlatformPackages } = await import('./packages')
    const plan = await verifyPlatformPackages(root, packages, runtime)
    files['packages.json'] = json(packages)
    files['deployment-plan.json'] = json(plan)
  }
  if(deployment.placements) {
    const {createDeploymentPlan}=await import('./deployment-plan')
    const paths=[...new Set([...inventories,...await Promise.all(packages.map(p=>safePath(root,p.inventory)))])]
    const owners=new Set((await createDeploymentPlan(paths)).contributions.map(p=>p.owner))
    for(const owner of new Set(deployment.placements.plugins.map(p=>p.owner))) {
      if(owners.has(owner))continue
      if(!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(owner))fail('placement owner must be a registered package or an installed npm package')
      paths.push(createRequire(join(root,'package.json')).resolve(owner+'/deployment.json'))
      owners.add(owner)
    }
    const plan=await createDeploymentPlan(paths,{placements:deployment.placements})
    files['deployment-placements.json']=json({placements:deployment.placements,bindings:deployment.placementBindings,components:plan.componentPlacements})
  }
  const receipt: Receipt = { formatVersion: 1, cliVersion, frameworkVersion, inputHash: hash(input.text), schemaHashes, files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, hash(content)])) }
  return { files, receipt }
}

/**
 * Render managed platform configuration from reviewed installed package metadata.
 * @param projectRoot - Trusted application project root.
 * @param options - Optional config path and check flag; check verifies generated outputs without replacing them.
 * @returns Generation summary for the selected project and managed files.
 * @throws Rejects invalid manifests, unresolved placements, edited/unmanaged generated files and filesystem failures.
 * @remarks Generates configuration and staging metadata, not live infrastructure or tenant activation. Source scripts and package runtime factories retain their separate host trust boundaries.
 * @example
 * import { generatePlatform } from '@alneas/eaos-cli/platform'
 * export function checkPlatform(root: string) { return generatePlatform(root, { check: true }) }
 */
export async function generatePlatform(projectRoot: string, options: { 
/**
 * Workspace-relative application manifest path; defaults to eaos.platform.json.
 */
config?: string; 
/**
 * When true, verify managed output is current without replacing files; false/omitted generates only reviewed managed changes.
 */
check?: boolean } = {}): Promise<{ 
/**
 * Generated when managed outputs were written, or current when existing outputs already match the receipt (including successful check mode).
 */
status: 'generated' | 'current'; 
/**
 * Resolved managed output directory under the trusted application project root.
 */
directory: string; 
/**
 * Count of rendered managed content files represented by the generation receipt.
 */
files: number }> {
  const root = await realpath(resolve(projectRoot))
  if (await stat(await safePath(root, '.eaos/platform-generate.lock'))) fail('another generator or interrupted write holds .eaos/platform-generate.lock')
  const prepared = await prepare(root, options.config || 'eaos.platform.json')
  const directory = await safePath(root, outputPath)
  // Fail before writing if any output is unmanaged, manually edited or missing.
  const preflight = async () => {
    const previous = await readReceipt(root)
    const existing = await inventory(root, outputPath)
    for (const name of existing) {
      if (name === receiptName && previous) continue
      if (!previous || !Object.hasOwn(previous.files, name)) fail('unmanaged file in generated directory; move it outside before generating')
    }
    if (previous) for (const [name, digest] of Object.entries(previous.files)) {
      const path = await safePath(root, `${outputPath}/${name}`)
      if (!(await stat(path))?.isFile() || hash(await readFile(path, 'utf8')) !== digest) fail('generated file was edited or removed; restore it before regenerating')
    }
    return previous
  }
  let previous = await preflight()
  const current = previous && json(previous) === json(prepared.receipt)
  if (options.check) {
    if (!current) fail('generated configuration is stale or absent; run platform:generate')
    return { status: 'current', directory, files: Object.keys(prepared.files).length }
  }
  if (current) return { status: 'current', directory, files: Object.keys(prepared.files).length }
  // Lock is outside the managed tree, so an interrupted writer fails closed on its next run.
  const lock = await safePath(root, '.eaos/platform-generate.lock')
  await mkdir(dirname(lock), { recursive: true })
  try { await writeFile(lock, 'EAOS platform generator lock\n', { flag: 'wx' }) } catch { fail('another generator or interrupted write holds .eaos/platform-generate.lock') }
  try {
    previous = await preflight()
    for (const [name, content] of Object.entries(prepared.files)) {
      const path = await safePath(root, `${outputPath}/${name}`)
      await mkdir(dirname(path), { recursive: true })
      const temp = await safePath(root, `${outputPath}/${name}.tmp`)
      await writeFile(temp, content, { flag: 'wx' })
      await rename(temp, path)
    }
    for (const name of Object.keys(previous?.files || {})) if (!Object.hasOwn(prepared.files, name)) await unlink(await safePath(root, `${outputPath}/${name}`))
    const receiptPath = await safePath(root, `${outputPath}/${receiptName}`)
    const temp = await safePath(root, `${outputPath}/${receiptName}.tmp`)
    await writeFile(temp, json(prepared.receipt), { flag: 'wx' })
    await rename(temp, receiptPath)
    return { status: 'generated', directory, files: Object.keys(prepared.files).length }
  } finally { await unlink(lock) }
}

export { deployPlatformImage, type PlatformImageDeployOptions } from './deploy'
export { definePlatformOperations, planPlatformOperation, executePlatformOperation, upPlatform, type PlatformOperations, type PlatformOperationOptions, type ReleaseContext, type OperationReceipt } from './operations'
