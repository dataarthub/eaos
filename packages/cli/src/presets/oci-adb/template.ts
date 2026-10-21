import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { safePath, readJson } from '../../platform/index'
import { resolveProjectManifest } from '../../platform/preset'
import { cliVersion } from '../../version'

/**
 * Render the initial host-owned Pulumi source files for the OCI ADB preset.
 * @param appName - Lowercase resource prefix beginning with a letter and containing at most 49 letters/digits/hyphens.
 * @returns Relative Pulumi filenames and complete generated UTF-8 text.
 * @throws If the application name does not match the resource-prefix grammar.
 * @remarks Does not write files, access Pulumi configuration or create resources. The generated project depends on the selected published CLI/Pulumi versions and requires real host configuration.
 * @example
 * import { renderOciAdbTemplate } from '@alneas/eaos-cli/presets/oci-adb'
 * const files = renderOciAdbTemplate('example-platform')
 */
export function renderOciAdbTemplate(appName: string): Record<string, string> {
  if (!/^[a-z][a-z0-9-]{0,48}$/.test(appName)) throw new Error('Invalid preset application name')
  return {
    'pulumi/Pulumi.yaml': `name: ${appName}\nruntime:\n  name: nodejs\n  options:\n    typescript: true\ndescription: EAOS OCI Autonomous Database preset\n`,
    'pulumi/package.json': JSON.stringify({ name: `${appName}-infra`, private: true, type: 'module', dependencies: { '@alneas/eaos-cli': '^' + cliVersion, '@pulumi/pulumi': '^3.268.0', '@pulumi/oci': '^5.3.1' } }, null, 2) + '\n',
    'pulumi/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: true } }, null, 2) + '\n',
    'pulumi/custom.ts': `import type { OciAdbPresetArgs } from '@alneas/eaos-cli/presets/oci-adb'\n// Host-owned escape hatch. Keep credentials as Pulumi Input/secret values.\nexport const customize = (args: OciAdbPresetArgs): OciAdbPresetArgs => args\n`,
    'pulumi/index.ts': `import * as pulumi from '@pulumi/pulumi'\nimport { createOciAdbPreset } from '@alneas/eaos-cli/presets/oci-adb'\nimport { customize } from './custom.js'\nconst config = new pulumi.Config('eaos')\nconst stack = createOciAdbPreset(${JSON.stringify(appName)}, customize({\n  compartmentId: config.require('compartmentId'),\n  availabilityDomain: config.require('availabilityDomain'),\n  edgeImageId: config.require('edgeImageId'),\n  workerImageId: config.require('workerImageId'),\n  sshAuthorizedKeys: config.require('sshAuthorizedKeys'),\n  sshCidr: config.require('sshCidr'),\n  dbName: config.require('dbName'),\n  dbVersion: config.require('dbVersion'),\n  adminPassword: config.requireSecret('adminPassword'),\n  objectStorageNamespace: config.require('objectStorageNamespace'),\n}))\nexport const bindings = stack.bindings\n`,
    'pulumi/.gitignore': 'node_modules/\n.env\n.env.*\n',
  }
}
/**
 * Acquire initial Pulumi source while refusing to replace existing customized files.
 * @param root - Trusted application root with the selected preset.
 * @param config - Workspace-relative application manifest path; defaults to eaos.platform.json.
 * @returns The Pulumi directory path and generated file count.
 * @throws Rejects missing preset selection, unsafe paths or existing files that differ from the generated template; filesystem failures propagate.
 * @remarks Preflights the whole file set and writes new files exclusively. Does not install packages, run preview/update or read credentials; existing customizations stay host-owned.
 * @example
 * import { initializePreset } from '@alneas/eaos-cli/presets/oci-adb'
 * export function initializeHost(root: string) { return initializePreset(root) }
 */
export async function initializePreset(root: string, config = 'eaos.platform.json') {
  root = resolve(root)
  const project = await resolveProjectManifest(root, (await readJson(await safePath(root, config))).data)
  if (!(project.manifest as { preset?: string }).preset) throw new Error('Select an infrastructure preset before initialization')
  const files = renderOciAdbTemplate(project.resolved.config.appName)
  // Preflight the entire set before writing. Preserve every user-owned source/customization.
  for (const [name, content] of Object.entries(files)) {
    const file = await safePath(root, name)
    try {
      const info = await lstat(file)
      if (!info.isFile() || await readFile(file, 'utf8') !== content) throw new Error('Preset source already exists; preserve and customize it in place')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  for (const [name, content] of Object.entries(files)) {
    const file = await safePath(root, name)
    await mkdir(dirname(file), { recursive: true })
    try { await writeFile(file, content, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  return { directory: await safePath(root, 'pulumi'), files: Object.keys(files).length }
}
