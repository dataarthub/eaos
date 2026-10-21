import { readFileSync } from 'node:fs'
declare const __EAOS_VERSION__: string
declare const __EAOS_FRAMEWORK_VERSION__: string
const sourcePackage = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
/**
 * CLI release version injected by the build, falling back to the source package version when running source.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export const cliVersion: string = typeof __EAOS_VERSION__ !== 'undefined' ? __EAOS_VERSION__ : sourcePackage().version
/**
 * Compatible framework version injected by the build, falling back to the source package version when running source.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export const frameworkVersion: string = typeof __EAOS_FRAMEWORK_VERSION__ !== 'undefined' ? __EAOS_FRAMEWORK_VERSION__ : sourcePackage().version
