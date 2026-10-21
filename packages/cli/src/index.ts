#!/usr/bin/env node
import { Command } from 'commander'
import { registerPluginCommands } from './commands/plugin'
import { registerDeploymentCommands } from './commands/deployment'
import { generatePlatform } from './platform/index'
import { registerClientCommands } from './commands/sync-routes'
import { cliVersion } from './version'
import { registerArchitectureCommands } from './commands/architecture'
const program=new Command().name('eaos').description('EAOS public development CLI').version(cliVersion)
registerPluginCommands(program)
registerDeploymentCommands(program)
registerClientCommands(program)
registerArchitectureCommands(program)
for(const name of ['platform:generate','platform:check'])program.command(name).option('-c, --config <path>','Platform manifest','eaos.platform.json').action(async o=>{console.log(await generatePlatform(process.cwd(),{config:o.config,check:name==='platform:check'}))})
program.parseAsync(process.argv).catch(error=>{console.error(error.message);process.exitCode=1})
