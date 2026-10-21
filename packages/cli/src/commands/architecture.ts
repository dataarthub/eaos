import { executePlatformOperation, upPlatform } from '../platform/operations'
import type { Command } from 'commander'
import { startPluginDev } from '../dev'
import { writeContractBaseline } from '../baseline'
/**
 * Register architecture and site operation commands on a supplied Commander command tree.
 * @param program - Commander command instance to mutate; its owning host controls argument parsing.
 * @returns No value; command definitions and handlers are attached to the supplied object.
 * @throws Commander configuration errors propagate.
 * @remarks Registration itself does not execute commands. Later parsing can invoke filesystem, infrastructure or deployment operations according to the selected command; review them separately.
 * @example
 * import { registerArchitectureCommands } from '@alneas/eaos-cli/commands/architecture'
 * import { Command } from 'commander'
 * const program = new Command('example')
 * registerArchitectureCommands(program)
 */
export function registerArchitectureCommands(program: Command): void {
  program.command('preset:init').option('--config <path>', 'Platform manifest', 'eaos.platform.json').action(async options => { const { initializePreset } = await import('../presets/oci-adb/template'); console.log(await initializePreset(process.cwd(), options.config)) })
  program.command('up').option('--config <path>', 'Platform manifest', 'eaos.platform.json').option('--plan', 'Inspect local commands without executing').action(async options => console.log(await upPlatform(process.cwd(), options)))
  for (const operation of ['bootstrap', 'release'] as const) program.command(operation).option('--config <path>', 'Platform manifest', 'eaos.platform.json').option('--operations <path>', 'Trusted host adapters (executes code)', 'eaos.operations.ts').option('--stack <name>', 'Explicit infrastructure stack for bootstrap').option('--plan', 'Inspect without executing host code or infrastructure').action(async options => console.log(await executePlatformOperation(process.cwd(), operation, options)))
  program.command('dev').option('--config <path>', 'Trusted plugin/dev config entry', 'src/index.ts').option('--port <port>', 'Loopback port', '4310').action(async options => { await startPluginDev(process.cwd(), options) })
  program.command('db:baseline').requiredOption('--version <version>').option('--contract <path>', 'Canonical contract JSON', 'data-contract.json').option('--out <path>', 'New baseline directory', 'baseline').option('--postgres-image <digest>', 'Local checksum-pinned PostgreSQL sandbox image').option('--oracle-image <digest>', 'Local checksum-pinned Oracle sandbox image').action(async options => console.log(await writeContractBaseline(process.cwd(), options)))
}
