import { readFileSync } from 'node:fs'
declare const __EAOS_VERSION__: string
declare const __EAOS_FRAMEWORK_VERSION__: string
const sourcePackage = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
/**
 * CLI release version injected by the build, falling back to the source package version when running source.
 * @see https://github.com/dataarthub/eaos/blob/main/packages/cli/docs/api.md#api-renderPlatform
 */
export const cliVersion: string = typeof __EAOS_VERSION__ !== 'undefined' ? __EAOS_VERSION__ : sourcePackage().version
/**
 * Compatible Core version injected by the build, falling back to the Core source package version.
 * @see https://github.com/dataarthub/eaos/blob/main/packages/cli/docs/api.md#api-renderPlatform
 */
export const frameworkVersion: string = typeof __EAOS_FRAMEWORK_VERSION__ !== 'undefined' ? __EAOS_FRAMEWORK_VERSION__ : JSON.parse(readFileSync(new URL('../../core/package.json', import.meta.url), 'utf8')).version
