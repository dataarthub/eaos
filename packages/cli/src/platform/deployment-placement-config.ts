import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readJson, safePath } from './index'
import { resolveProjectManifest } from './preset'

/**
 * Load explicit destination placements from the application manifest without discovering plugin code.
 * @param root - Existing application root, canonicalized through realpath.
 * @param config - Workspace-relative application manifest path.
 * @returns The resolved placement catalog and host placement bindings.
 * @throws Rejects missing placements, invalid manifest paths/configuration and read failures.
 * @example
 * import { readDeploymentPlacementConfig } from '@alneas/eaos-cli/platform/deployment-placement-config'
 * export function placements(root: string) { return readDeploymentPlacementConfig(root, 'eaos.platform.json') }
 */
export async function readDeploymentPlacementConfig(root: string, config: string) {
  root=await realpath(resolve(root))
  const {data}=await readJson(await safePath(root,config))
  const {resolved:{deployment}}=await resolveProjectManifest(root,data)
  if(!deployment.placements)throw Error('Declare deployment.placements in eaos.platform.json')
  return {placements:deployment.placements,bindings:deployment.placementBindings!}
}
