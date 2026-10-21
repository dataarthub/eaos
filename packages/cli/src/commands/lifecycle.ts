import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Command } from 'commander'
import { PluginLifecycle, type LifecycleProject, type LifecyclePlan, type LifecycleBundlePlan, type Operation } from '@alneas/eaos-server/lifecycle-engine'
async function load(path: string): Promise<{ manager: PluginLifecycle; project: LifecycleProject }> {
  const module = await import(pathToFileURL(resolve(path)).href)
  const project: LifecycleProject = typeof module.default === 'function' ? await module.default() : module.default
  if (!project?.store || typeof project.migrate !== 'function') throw new Error('Export a LifecycleProject from the trusted local config')
  return { manager: new PluginLifecycle(project), project }
}
/**
 * Register plugin lifecycle inspection and administration commands on a supplied Commander command tree.
 * @param plugin - Commander command instance to mutate; its owning host controls argument parsing.
 * @returns No value; command definitions and handlers are attached to the supplied object.
 * @throws Commander configuration errors propagate.
 * @remarks Registration itself does not execute commands. Later parsing can invoke filesystem, infrastructure or deployment operations according to the selected command; review them separately.
 * @example
 * import { registerLifecycleCommands } from '@alneas/eaos-cli/commands/lifecycle'
 * import { Command } from 'commander'
 * const program = new Command('example')
 * registerLifecycleCommands(program)
 */
export function registerLifecycleCommands(plugin: Command): void {
  plugin.command('schema-catalog')
    .description('Print canonical tables, owners and contract versions without applying DB changes')
    .option('--config <file>', 'Trusted lifecycle project', 'eaos.lifecycle.ts')
    .option('--plugins <ids>', 'Select comma-separated feature IDs')
    .action(async options => {
      const { manager } = await load(options.config)
      console.log(JSON.stringify(manager.schemaCatalog(options.plugins?.split(',').map((id: string) => id.trim())), null, 2))
    })
  plugin.command('list')
    .description('Inspect registered code, installed releases and current tenant activation (read-only)')
    .option('--config <file>', 'Trusted lifecycle project', 'eaos.lifecycle.ts')
    .option('--backend <id>', 'Filter a configured or recorded backend')
    .option('--tenant <id>', 'Show effective activation for one tenant')
    .option('--json', 'Print a machine-readable snapshot')
    .action(async options => {
      const { manager, project } = await load(options.config)
      const inventory = await manager.list({ backendId: options.backend, tenantId: options.tenant })
      if (options.json) { console.log(JSON.stringify(inventory, null, 2)); return }
      console.log(`Lifecycle revision ${inventory.revision}; framework ${inventory.frameworkVersion}`)
      for (const [bundleId, pluginIds] of Object.entries(project.bundles ?? {})) console.log(`BUNDLE ${bundleId}: ${pluginIds.length} internal plugins`)
      if (!inventory.plugins.length) { console.log('No registered or recorded plugins.'); return }
      const bundleNames = new Map<string, string[]>()
      for (const [bundleId, pluginIds] of Object.entries(project.bundles ?? {})) for (const pluginId of pluginIds) bundleNames.set(pluginId, [...(bundleNames.get(pluginId) ?? []), bundleId])
      const rows = [['PLUGIN', 'BUNDLE(S)', 'BACKEND', 'CODE', 'INSTALLED', 'STATE', 'TENANTS'], ...inventory.plugins.map(p => [
        p.pluginId, bundleNames.get(p.pluginId)?.join(', ') ?? 'individual', p.backendId ?? '-', p.registeredVersion ?? '(missing)', p.installedVersion ?? '-',
        [p.installationStatus, ...(p.releaseMatches === false ? ['release-mismatch'] : []), ...(p.backendId && !p.backendConfigured ? ['backend-missing'] : [])].join(', '),
        p.tenants.map(t => `${t.tenantId}:${t.enabled ? 'enabled' : t.requestedEnabled ? 'blocked' : 'disabled'}`).join(', ') || '-',
      ])]
      const widths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i].length)))
      for (const row of rows) console.log(row.map((value, i) => value.padEnd(widths[i])).join('  ').trimEnd())
    })
  for (const operation of ['install', 'update', 'enable', 'disable', 'uninstall'] as Operation[]) {
    plugin.command(`${operation} <id>`)
      .description(`${operation}: print a reviewable plan; use --apply to execute`)
      .requiredOption('--backend <id>', 'Configured backend target')
      .requiredOption('--tenant <id>', 'Configured tenant')
      .option('--config <file>', 'Trusted lifecycle project', 'eaos.lifecycle.ts')
      .option('--out <file>', 'Save plan for subsequent preview/apply')
      .option('--apply', 'Apply this operation explicitly')
      .action(async (id, options) => {
        const { manager, project } = await load(options.config)
        const request = { operation, pluginId: id, backendId: options.backend, tenantId: options.tenant } as const
        const plan = project.bundles?.[id] ? await manager.planBundle(request) : await manager.plan(request)
        if (options.out) { const file = resolve(options.out); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(plan, null, 2) + '\n') }
        console.log(JSON.stringify(plan, null, 2))
        if (options.apply) { if ('plans' in plan) await manager.applyBundle(plan); else await manager.apply(plan); console.log(`Applied ${plan.id}; application data retained`) }
      })
  }
  for (const operation of ['apply', 'infra-preview']) {
    plugin.command(`${operation} <plan>`).option('--config <file>', 'Trusted lifecycle project', 'eaos.lifecycle.ts')
      .action(async (file, options) => {
        const { manager } = await load(options.config), plan: LifecyclePlan | LifecycleBundlePlan = JSON.parse(await readFile(resolve(file), 'utf8'))
        if (operation === 'apply') { if ('plans' in plan) await manager.applyBundle(plan); else await manager.apply(plan); console.log(`Applied ${plan.id}; application data retained`) }
        else if ('plans' in plan) console.log(JSON.stringify((await Promise.all(plan.plans.map(child => manager.preview(child)))).flat(), null, 2))
        else console.log(JSON.stringify(await manager.preview(plan), null, 2))
      })
  }
}
