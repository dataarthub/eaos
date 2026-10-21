import fs from 'node:fs'
import path from 'node:path'
import { CommandOptions, findPluginDir } from '../utils'

const SECRET_PATTERNS = [
  { name: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{32,}/g },
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Database Connection String', regex: /postgres:\/\/[^:]+:[^@]+@/g },
  { name: 'Private Key', regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g }
]

/**
 * Scan plugin TypeScript, JavaScript and JSON files for configured credential patterns without printing matches.
 * @param workspaceRoot - Trusted workspace containing the plugin.
 * @param options - plugin is required; check rejects findings and autoFix only prints resolver guidance.
 * @returns Resolves without a value after reporting findings; does not edit or remove credentials.
 * @throws Rejects invalid plugin paths, filesystem errors, or detected patterns when check is true.
 * @remarks Skips node_modules, dist and .git. Pattern scanning cannot certify absence of all secrets; findings contain relative paths and redacted categories.
 * @example
 * import { detectSecrets } from '@alneas/eaos-cli/plugin-tools'
 * export async function scanNotes(root: string) { await detectSecrets(root, { plugin: 'notes', check: true }) }
 */
export async function detectSecrets(workspaceRoot: string, options: CommandOptions): Promise<void> {
  const pluginId = options.plugin
  if (!pluginId) {
    throw new Error('--plugin <plugin-id> is required for detect-secrets')
  }

  const pluginDir = findPluginDir(workspaceRoot, pluginId)
  const detected: { file: string; patternName: string }[] = []

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
          scanDir(fullPath)
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        for (const p of SECRET_PATTERNS) {
          const matches = content.matchAll(p.regex)
          for (const _match of matches) {
            detected.push({ file: path.relative(pluginDir, fullPath), patternName: p.name })
          }
        }
      }
    }
  }

  scanDir(pluginDir)

  if (detected.length === 0) {
    console.log(`✅ [detect-secrets] No hardcoded secrets detected in plugin '${pluginId}'.`)
    return
  }

  console.warn(`⚠️ [detect-secrets] Detected ${detected.length} potential hardcoded secret(s) in plugin '${pluginId}':`)
  for (const d of detected) {
    console.warn(`  - [${d.patternName}] in ${d.file} (redacted)`)
  }

  if (options.check) throw new Error('Potential hardcoded secrets detected')

  if (options.autoFix) {
    const manifestPath = path.join(pluginDir, 'manifest.ts')
    if (fs.existsSync(manifestPath)) {
      console.log(`💡 [detect-secrets] Note: Secrets should be declared in manifest.ts under 'secrets' array and populated from SecretResolver.`)
    }
  }
}
