import { registerLifecycleCommands } from './lifecycle'
import { Command } from 'commander'
import { generatePlugin, diagnosePlugin, generateMcpTools, syncAgentsMd, detectSecrets, inferContracts, checkContracts, type CommandOptions } from '../plugin-tools/index'
/**
 * Register plugin generation and maintenance commands on a supplied Commander command tree.
 * @param program - Commander command instance to mutate; its owning host controls argument parsing.
 * @returns No value; command definitions and handlers are attached to the supplied object.
 * @throws Commander configuration errors propagate.
 * @remarks Registration itself does not execute commands. Later parsing can invoke filesystem, infrastructure or deployment operations according to the selected command; review them separately.
 * @example
 * import { registerPluginCommands } from '@alneas/eaos-cli/commands/plugin'
 * import { Command } from 'commander'
 * const program = new Command('example')
 * registerPluginCommands(program)
 */
export function registerPluginCommands(program: Command): void {
  const plugin = program.command('plugin').description('Create and maintain application plugins')
  registerLifecycleCommands(plugin)
  const commands = {
    generate: generatePlugin, diagnose: diagnosePlugin, 'generate-mcp': generateMcpTools,
    'sync-agents': syncAgentsMd, 'detect-secrets': detectSecrets, 'infer-contracts': inferContracts, 'contract-check': checkContracts,
  }
  for (const [name, handler] of Object.entries(commands)) {
    plugin.command(name)
      .option('--plugin <id>', 'Existing plugin ID')
      .option('--name <name>', 'New plugin display name')
      .option('--description <text>', 'Plugin description')
      .option('--industry <id>', 'Optional industry tag')
      .option('--tier <tier>', 'public, standard, pro or corporate (free/premium are legacy aliases)')
      .option('--addon-id <id>', 'Pro add-on contract ID')
      .option('--monthly-quota <count>', 'Pro admitted request budget; defaults to zero')
      .option('--allowed-tenants <ids>', 'Comma-separated Corporate tenant allowlist')
      .option('--output <path>', 'New plugin output directory')
      .option('--format <format>', 'Diagnostic output format')
      .option('--check', 'Read-only verification; exit nonzero on failure')
      .option('--write', 'Replace an existing generated draft')
      .option('--against <path>', 'Workspace-relative contract baseline JSON')
      .action(async (options: CommandOptions) => { await handler(process.cwd(), options) })
  }
}
