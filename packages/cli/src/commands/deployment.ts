import type { Command } from 'commander'
import type { DeploymentTarget, DeploymentResult } from '@alneas/eaos-server/platform'
import { createDeploymentPlan, inspectDeploymentStatus, recordDeploymentResult, renderDeploymentStatusMarkdown } from '../platform/index'
import { readDeploymentPlacementConfig } from '../platform/deployment-placement-config'

/**
 * Register artifact planning, status inspection, and operator-evidence recording commands on a Commander tree.
 * @param program - Commander command instance to mutate; its owning host controls argument parsing.
 * @returns No value; command definitions and handlers are attached to the supplied object.
 * @throws Commander configuration errors propagate.
 * @remarks Registration itself does not execute commands. Parsing these commands reads/verifies artifacts and may append an evidence journal or set process.exitCode for incomplete status; it does not execute deployment tasks or apply infrastructure.
 * @example
 * import { registerDeploymentCommands } from '@alneas/eaos-cli/commands/deployment'
 * import { Command } from 'commander'
 * const program = new Command('example')
 * registerDeploymentCommands(program)
 */
export function registerDeploymentCommands(program: Command) {
program.command('platform:deployment-plan <inventories...>').description('Verify artifacts and print a deployment plan; never deploy').option('-c, --config <file>','Existing eaos.platform.json with component placements').action(async (inventories,options) => {
 const config=options.config?await readDeploymentPlacementConfig(process.cwd(),options.config):undefined
 console.log(JSON.stringify(await createDeploymentPlan(inventories,{placements:config?.placements}),null,2))
})

function deploymentTarget(options: { environment?: string; backend?: string; database?: string; tenant?: string }): DeploymentTarget | undefined {
  if (!options.environment) {
    if (options.backend || options.database || options.tenant) throw new Error('--environment is required with backend/database/tenant')
    return undefined
  }
  return { environment: options.environment, ...(options.backend ? { backendId: options.backend } : {}), ...(options.database ? { databaseId: options.database } : {}), ...(options.tenant ? { tenantId: options.tenant } : {}) }
}
program.command('platform:deployment-status <inventories...>')
  .description('Inspect per-plugin work and reported completion; never execute tasks')
  .option('--receipts <files...>', 'Host/operator completion journals')
  .option('--environment <id>').option('--backend <id>').option('--database <id>').option('--tenant <id>')
  .option('--format <format>', 'json or markdown', 'json')
  .option('-c, --config <file>', 'Existing eaos.platform.json with component placements')
  .option('--view <view>', 'plugin or destination', 'plugin')
  .option('--remaining', 'Omit succeeded task rows from the Markdown report')
  .option('--check', 'Exit nonzero unless all required tasks are complete')
  .action(async (inventories, options) => {
    if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be json or markdown')
    if (options.remaining && options.format !== 'markdown') throw new Error('--remaining requires --format markdown')
    if(!['plugin','destination'].includes(options.view))throw Error('--view must be plugin or destination')
    if(options.view==='destination'&&!options.config)throw Error('Destination view requires --config')
    const status = await inspectDeploymentStatus(inventories, { receipts: options.receipts, target: deploymentTarget(options),config:options.config })
    const output = options.format === 'markdown' ? renderDeploymentStatusMarkdown(status, { remaining: options.remaining,view:options.view }) : JSON.stringify(status, null, 2)
    // Large inventories exceed a pipe buffer; keep the command alive until the
    // complete report has been written, including when --check exits nonzero.
    await new Promise<void>((resolve, reject) => process.stdout.write(output + '\n', error => error ? reject(error) : resolve()))
    if (options.check && !status.complete) process.exitCode = 1
  })
program.command('platform:deployment-record <inventory>')
  .description('Append explicit operator evidence; does not execute or authorize work')
  .requiredOption('--plugin <id>').requiredOption('--task <id>')
  .requiredOption('--status <status>', 'running, succeeded or failed')
  .requiredOption('--actor <id>').requiredOption('--evidence <refs...>', 'Non-secret evidence references')
  .requiredOption('--out <file>', 'Project-relative host journal, separate from the artifact')
  .option('-c, --config <file>', 'Existing eaos.platform.json with component placements')
  .option('--destination <id>', 'Assigned destination for environment/tenant evidence')
  .option('--environment <id>').option('--backend <id>').option('--database <id>').option('--tenant <id>')
  .action(async (inventory, options) => {
    const result: DeploymentResult = { pluginId: options.plugin, taskId: options.task, status: options.status, actor: options.actor, evidence: options.evidence, recordedAt: new Date().toISOString(), target: deploymentTarget(options) }
    console.log(JSON.stringify(await recordDeploymentResult(process.cwd(), { inventory, receipt: options.out, result,config:options.config,destination:options.destination }), null, 2))
  })

}
