import {createHostModulePolicy} from '../extensions'
import {prepareHostCatalog} from './catalog'
import type {StandardHostPolicy,StandardHostPolicyOptions} from './types'
/**
 * Compose selected Host metadata and live module admission without starting services.
 * @param options - Explicit adoption, executable bindings and licensing providers.
 * @returns A fresh selected catalog and the canonical module policy.
 * @throws Invalid identities and conflicting bindings reject before service construction.
 * @example
 * import { createStandardHostPolicy } from '@alneas/eaos-server/host'
 * const policy = createStandardHostPolicy({ manifests: [], loadEnabledModules: async () => [] })
 */
export function createStandardHostPolicy(options:StandardHostPolicyOptions):StandardHostPolicy {
 return policyForCatalog(options,prepareHostCatalog(options).manifests)
}
export function policyForCatalog(options:StandardHostPolicyOptions,manifests:StandardHostPolicy['manifests']):StandardHostPolicy {
 const policy=createHostModulePolicy({manifests:[...manifests],loadEnabledModules:options.loadEnabledModules,moduleAliases:structuredClone(options.moduleAliases??{}),routePrefixes:structuredClone(options.routePrefixes??{}),bypass:options.bypass})
 return Object.freeze({manifests:Object.freeze([...manifests]),...policy,loadEnabledModules:options.loadEnabledModules})
}
