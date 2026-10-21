import { version, peerDependencies } from '../../package.json'
import type { LifecyclePlugin } from '@alneas/eaos-server/lifecycle-engine'
import { getPlatformRecordsContract } from '@alneas/eaos-core/contracts/platform-records'
/**
 * Exposes the canonical platform-records schema used by the plugin storage contract.
 *
 * @remarks
 * This references getPlatformRecordsContract().schema; the plugin does not own a separate table schema.
  * @example
 * import { recordSchema } from '@alneas/eaos-plugins/field-customization'
 * console.log(recordSchema.type, recordSchema.properties)
 */
export const recordSchema = getPlatformRecordsContract().schema
/**
 * Declares lifecycle compatibility and schema dependencies for host orchestration.
 *
 * @remarks
 * The host lifecycle engine owns installation and tenant admission; importing this value performs no migrations.
  * @example
 * import { lifecycle } from '@alneas/eaos-plugins/field-customization'
 * console.log(lifecycle.id, lifecycle.version)
 */
export const lifecycle: LifecyclePlugin = {"id":"field-customization","version":version,"framework":peerDependencies['@alneas/eaos-server'],"migrations":[],"schemaDependencies":{"platform-records":"^1.1.0"},schemaContracts:[getPlatformRecordsContract()]}
