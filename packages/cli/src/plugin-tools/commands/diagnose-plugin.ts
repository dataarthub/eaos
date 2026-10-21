import { type CommandOptions } from '../utils'
import { inspectPlugin } from '../inspect'
/**
 * Print source-inspection diagnostics and optionally fail when unresolved issues remain.
 * @param root - Trusted workspace root.
 * @param options - plugin is required; format=json prints structured data and check rejects unresolved issues.
 * @returns Resolves without a value after printing the report.
 * @throws Rejects if plugin is missing, source inspection fails, or check finds issues.
 * @example
 * import { diagnosePlugin } from '@alneas/eaos-cli/plugin-tools'
 * export async function diagnoseNotes(root: string) { await diagnosePlugin(root, { plugin: 'notes', check: true }) }
 */
export async function diagnosePlugin(root: string, options: CommandOptions): Promise<void> {
 if (!options.plugin) throw new Error('--plugin <plugin-id> is required for diagnose')
 const report = inspectPlugin(root, options.plugin)
 console.log(options.format === 'json' ? JSON.stringify(report, null, 2) : `${report.pluginId}: ${report.issues.length} issue(s)\n${report.issues.map(i => `${i.code}: ${i.message}`).join('\n')}`)
 if (options.check && report.issues.length) throw new Error('Plugin diagnosis failed')
}
