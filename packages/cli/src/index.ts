#!/usr/bin/env node
import { Command } from 'commander'
import { registerPluginCommands } from './commands/plugin'
import { registerDeploymentCommands } from './commands/deployment'
import { generatePlatform } from './platform/index'
import { acquireFrontendArtifact, stageFrontendArtifacts } from './platform/frontend'
import { registerClientCommands } from './commands/sync-routes'
import { cliVersion } from './version'
import { registerArchitectureCommands } from './commands/architecture'
const program=new Command().name('eaos').description('EAOS public development CLI').version(cliVersion)
registerPluginCommands(program)
registerDeploymentCommands(program)
registerClientCommands(program)
registerArchitectureCommands(program)
const frontend = program.command('frontend').description('Acquire and stage verified frontend contributions')
frontend.command('acquire <inventory>').option('-c, --config <path>', 'Frontend catalog', 'frontend.packages.json').action(async (inventory, options) => { console.log(await acquireFrontendArtifact(process.cwd(), inventory, options)) })
frontend.command('stage').option('-c, --config <path>', 'Frontend catalog', 'frontend.packages.json').requiredOption('--out <path>', 'Generated module').option('--reserved-route <routes...>', 'Exact host-owned routes', []).action(async options => { console.log(await stageFrontendArtifacts(process.cwd(), { config: options.config, output: options.out, reservedRoutes: options.reservedRoute })) })
for(const name of ['platform:generate','platform:check'])program.command(name).option('-c, --config <path>','Platform manifest','eaos.platform.json').action(async o=>{console.log(await generatePlatform(process.cwd(),{config:o.config,check:name==='platform:check'}))})
program.parseAsync(process.argv).catch(error=>{console.error(error.message);process.exitCode=1})
