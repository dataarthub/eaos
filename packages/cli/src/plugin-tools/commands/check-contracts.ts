import fs from 'node:fs'
import path from 'node:path'
import { compareInputSchemaCompatibility, compareOutputSchemaCompatibility } from '@alneas/eaos-core/plugin-sdk'
import { inspectPlugin, type PluginInspection } from '../inspect'
import { findPluginDir, type CommandOptions } from '../utils'

/**
 * Plugin selection and workspace-relative baseline for static compatibility checking.
 * @see {@link checkContracts} for the canonical usage example and runtime requirements.
 */
export interface ContractCheckOptions extends CommandOptions {
  
    /**
   * Required workspace-relative regular JSON file containing the previously inspected contract.
   */
  against?: string
}

function readBaseline(root: string, file: string): PluginInspection {
  const resolved = path.resolve(root, file)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--against must point inside the workspace')
  if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Contract baseline must be a regular workspace file')
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8')) as PluginInspection
  if (!value || typeof value !== 'object' || typeof value.pluginId !== 'string' || !Array.isArray(value.tools) || !value.policies) throw new Error('Invalid contract baseline')
  return value
}

/**
 * Compare statically inspected plugin contracts against a workspace-owned baseline.
 * @param root - Trusted workspace root containing the plugin and baseline.
 * @param options - Required plugin and against path; against must identify a regular workspace file.
 * @returns Resolves without a value when the baseline is compatible; additions are reported to stdout.
 * @throws Rejects unresolved contracts, mismatched plugin identities, incompatible schemas/policies or an invalid baseline.
 * @remarks Does not import plugin code; checks metadata compatibility rather than runtime authorization or complete semantic equivalence.
 * @example
 * import { checkContracts } from '@alneas/eaos-cli/plugin-tools'
 * export async function checkNotes(root: string) { await checkContracts(root, { plugin: 'notes', against: 'contracts/notes.json' }) }
 */
export async function checkContracts(root: string, options: ContractCheckOptions): Promise<void> {
  if (!options.plugin) throw new Error('--plugin <plugin-id> is required for contract-check')
  if (!options.against) throw new Error('--against <path> is required for contract-check')
  findPluginDir(root, options.plugin)
  const current = inspectPlugin(root, options.plugin), previous = readBaseline(root, options.against)
  if (current.issues.length) throw new Error(`Cannot check unresolved contract: ${current.issues.map(issue => `${issue.code}: ${issue.message}`).join('; ')}`)
  if (previous.pluginId !== current.pluginId) throw new Error('Contract baseline plugin ID does not match')
  const issues: string[] = []
  const oldTools = new Map(previous.tools.map(tool => [tool.name, tool])), newTools = new Map(current.tools.map(tool => [tool.name, tool]))
  for (const oldTool of previous.tools) {
    const nextTool = newTools.get(oldTool.name)
    if (!nextTool) issues.push(`removed tool: ${oldTool.name}`)
    else if (oldTool.inputSchema && nextTool.inputSchema) {
      const inputIssues = compareInputSchemaCompatibility(oldTool.inputSchema, nextTool.inputSchema)
      if (inputIssues.length) issues.push(`input schema changed: ${oldTool.name} (${inputIssues.join(', ')})`)
    } else if (nextTool.parametersHash !== oldTool.parametersHash) issues.push(`input schema changed: ${oldTool.name}`)
    if (oldTool.contract?.outputSchema && nextTool?.contract?.outputSchema) {
      const outputIssues = compareOutputSchemaCompatibility(oldTool.contract.outputSchema, nextTool.contract.outputSchema)
      if (outputIssues.length) issues.push(`output schema changed: ${oldTool.name} (${outputIssues.join(', ')})`)
    }
    if (nextTool && Boolean(oldTool.contract) !== Boolean(nextTool.contract)) issues.push(`execution contract metadata changed: ${oldTool.name}`)
    else if (oldTool.contract && nextTool?.contract) {
      if (oldTool.contract.sideEffect !== nextTool.contract.sideEffect) issues.push(`side effect changed: ${oldTool.name}`)
      if (oldTool.contract.version !== nextTool.contract.version || oldTool.contract.permission !== nextTool.contract.permission) issues.push(`execution contract changed: ${oldTool.name}`)
    }
    const oldPolicy = JSON.stringify(previous.policies[oldTool.name] ?? {}), newPolicy = JSON.stringify(current.policies[oldTool.name] ?? {})
    if (oldPolicy !== newPolicy) issues.push(`execution policy changed: ${oldTool.name}`)
  }
  for (const name of newTools.keys()) if (!oldTools.has(name)) console.log(`ℹ️ added tool: ${name}`)
  if (issues.length) {
    console.error(issues.map(issue => `✖ ${issue}`).join('\n'))
    throw new Error(`Contract compatibility check failed: ${issues.join('; ')}`)
  }
  console.log(`Contract compatible: ${current.pluginId}`)
}
