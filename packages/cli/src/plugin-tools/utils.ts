import fs from 'node:fs'
import path from 'node:path'

/**
 * Command-specific plugin authoring arguments; each command validates the subset it consumes.
 * @see {@link generatePlugin} for the canonical usage example and runtime requirements.
 */
export interface CommandOptions {
  
    /**
   * Existing plugin ID consumed by inspection/maintenance commands.
   */
  plugin?: string
  
    /**
   * Read-only equality/diagnostic verification where supported; failures reject.
   */
  check?: boolean
  
    /**
   * Explicit permission to replace an existing generated draft where supported.
   */
  write?: boolean
  
    /**
   * Command-specific guidance flag; secret detection does not rewrite matched content.
   */
  autoFix?: boolean
  
    /**
   * New plugin name used to derive a validated identifier.
   */
  name?: string
  
    /**
   * Human-readable plugin description written into generated metadata.
   */
  description?: string
  
    /**
   * Optional author-selected industry label for generated metadata.
   */
  industry?: string
  
    /**
   * Public, standard, pro or corporate policy selection; supported legacy aliases are normalized by the generator.
   */
  tier?: string
  
    /**
   * Explicit Pro addon identity; generator otherwise derives its default from the plugin ID.
   */
  addonId?: string
  
    /**
   * Text form of the nonnegative admitted-request budget; zero grants no metered calls.
   */
  monthlyQuota?: string
  
    /**
   * Comma-separated explicit Corporate tenant allowlist; Corporate generation requires it.
   */
  allowedTenants?: string
  
    /**
   * Command-specific selected client/runtime target hints.
   */
  targets?: string
  
    /**
   * Command-specific optional generated feature hints.
   */
  features?: string
  
    /**
   * Optional new scaffold destination, subject to the generator's path and existence checks.
   */
  output?: string
  
    /**
   * Diagnostic format; json requests structured source inspection.
   */
  format?: string
  
    /**
   * Workspace-relative contract-baseline JSON used for compatibility checks.
   */
  against?: string
}

/**
 * Resolve an existing plugin directory while rejecting symbolic links and paths outside the plugin root.
 * @param workspaceRoot - Trusted workspace containing the plugins directory.
 * @param pluginId - Lowercase hyphen-separated plugin identifier.
 * @returns The joined plugin directory path using the supplied workspaceRoot; containment is checked using real paths, but the returned path is not canonicalized.
 * @throws If the identifier, directory or resolved containment is invalid; filesystem errors propagate.
 * @example
 * import { findPluginDir } from '@alneas/eaos-cli/plugin-tools'
 * export function locateNotes(root: string) { return findPluginDir(root, 'notes') }
 */
export function findPluginDir(workspaceRoot: string, pluginId: string): string {
  assertPluginId(pluginId)
  const plugins = path.join(workspaceRoot, 'plugins')
  if (fs.existsSync(plugins) && fs.lstatSync(plugins).isSymbolicLink()) throw new Error('Plugin symlinks are not supported')
  const dir = path.join(plugins, pluginId)
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Plugin symlinks are not supported')
  if (!fs.existsSync(dir)) {
    throw new Error(`Plugin directory not found: ${dir}`)
  }
  const base = fs.realpathSync(path.join(workspaceRoot, 'plugins'))
  const relative = path.relative(base, fs.realpathSync(dir))
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Plugin path escapes plugins directory')
  return dir
}

/**
 * List direct plugin directories that contain a manifest.ts file.
 * @param workspaceRoot - Workspace whose plugins directory is inspected.
 * @returns Discovered directory names, or an empty array when plugins is absent; ordering follows the filesystem.
 * @throws Filesystem enumeration errors propagate.
 * @remarks This is discovery only; names are not an activation or authorization decision.
 * @example
 * import { getAllPluginIds } from '@alneas/eaos-cli/plugin-tools'
 * export function listPlugins(root: string) { return getAllPluginIds(root) }
 */
export function getAllPluginIds(workspaceRoot: string): string[] {
  const pluginsDir = path.join(workspaceRoot, 'plugins')
  if (!fs.existsSync(pluginsDir)) return []
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && fs.existsSync(path.join(pluginsDir, dirent.name, 'manifest.ts')))
    .map((dirent) => dirent.name)
}

/**
 * Reject identifiers outside the lowercase hyphen-separated plugin naming grammar.
 * @param id - Identifier beginning with a lowercase letter; segments contain lowercase letters or digits.
 * @returns No value; normal completion means the identifier matches the naming grammar.
 * @throws If the identifier does not match the required grammar.
 * @example
 * import { assertPluginId } from '@alneas/eaos-cli/plugin-tools'
 * assertPluginId('notes-api')
 */
export function assertPluginId(id: string): void {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Invalid plugin ID: ${id}`)
}
/**
 * Convert a nonempty hyphen-separated identifier into concatenated capitalized segments.
 * @param id - Validated identifier with nonempty hyphen-separated segments.
 * @returns The concatenated PascalCase identifier.
 * @throws Empty segments cause a TypeError; validate untrusted identifiers first.
 * @example
 * import { pascalCase } from '@alneas/eaos-cli/plugin-tools'
 * const typeName = pascalCase('notes-api')
 */
export function pascalCase(id: string): string {
  return id.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')
}
/**
 * Write a generated draft or check exact equality without replacing a protected existing draft.
 * @param file - Destination file, resolved by the trusted caller.
 * @param content - Complete desired UTF-8 content.
 * @param options - check compares without writing; otherwise write must be true to replace an existing file.
 * @returns No value; the draft matches or has been written.
 * @throws When check finds missing/stale content, replacement lacks write, or filesystem access fails.
 * @remarks Creates parent directories when writing; does not establish containment or inspect symlink components itself.
 * @example
 * import { writeDraft } from '@alneas/eaos-cli/plugin-tools'
 * export function checkDraft(file: string, content: string) { writeDraft(file, content, { check: true }) }
 */
export function writeDraft(file: string, content: string, options: CommandOptions): void {
  if (options.check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) throw new Error(`Generated draft is out of date: ${file}`)
    return
  }
  if (fs.existsSync(file) && !options.write) throw new Error(`Draft exists; use --write to regenerate: ${file}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
