import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { findPluginDir } from './utils'
import type { PluginStoragePolicy } from '@alneas/eaos-core/plugin-sdk'

/**
 * Source-inspected plugin metadata and explicit unresolved issues, without executing plugin code.
 * @see {@link inspectPlugin} for the canonical usage example and runtime requirements.
 */
export interface PluginInspection {
 
    /**
   * Statically declared API route prefix when it can be resolved.
   */
  apiPrefix?: string
 
    /**
   * Statically declared supported runtime/client targets.
   */
  targets?: string[]
 
    /**
   * Declared Data Contract identities and compatible version ranges.
   */
  dataContracts?: Record<string, string>
 
    /**
   * Validated plugin identity read from source declarations.
   */
  pluginId: string
 
    /**
   * Table names inferred from source contracts; not proof of installed physical schemas.
   */
  tables: string[]
 
    /**
   * Statically inspected tool names, input hashes/schema and optional execution contracts.
   */
  tools: {
    /** Statically resolved MCP tool name from the inspected plugin source. */
  name: string;
    /** SHA-256 of JSON.stringify applied to the statically resolved input schema; source object key order therefore affects compatibility comparisons. */
  parametersHash: string;
    /** Optional source-resolved JSON Schema for tool arguments; unresolved expressions are reported as inspection issues. */
  inputSchema?: Record<string, unknown>;
    /** Optional statically resolved execution contract describing version, permission, effects, and output validation. */
  contract?: {
    /** Declared execution-contract version string used for compatibility comparisons. */
  version: string;
    /** Declared permission key required by the execution contract; inspection does not enforce it. */
  permission: string;
    /** Declared effect category: read, write, or external; runtime hosts must enforce the corresponding execution boundary. */
  sideEffect: 'read' | 'write' | 'external';
    /** Optional statically resolved result JSON Schema; absence does not imply result validation. */
  outputSchema?: Record<string, unknown> } }[]
 
    /**
   * Resolved per-tool role, risk and human-approval metadata; runtime hosts still enforce live authorization.
   */
  policies: Record<string, {
    /** Optional source-declared role requirement; live runtime authorization remains host-owned. */
  requiredRole?: string;
    /** Optional source-declared tool risk label, without a runtime policy decision from inspection. */
  riskLevel?: string;
    /** Optional source declaration indicating whether the tool requests human approval. */
  requireHumanApproval?: boolean }>
 
    /**
   * Source contract declarations found by the static reader.
   */
  contracts: string[]
 
    /**
   * Declared secret names, never resolved secret values.
   */
  secrets: string[]
 
    /**
   * Optional declared plugin storage limits and placement rules.
   */
  storagePolicy?: PluginStoragePolicy
 
    /**
   * Unresolved/unsupported source findings; callers must not silently treat them as a complete executable contract.
   */
  issues: {
    /** Stable diagnostic category identifying unsupported, unresolved, or conflicting inspected source. */
  code: string;
    /** Human-readable diagnostic context; callers must review these findings before treating metadata as complete. */
  message: string }[]
}
/** Parse source only. Never import/evaluate a plugin while checking its documentation. */
class SourceReader {
 private cache = new Map<string, ts.SourceFile>()
 private externalFiles = new Set<string>()
 private externalRoots = new Map<string, string>()
 constructor(private root: string, private workspaceRoot = root) {}
 read(file: string) {
  const rel = path.relative(this.root, file)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Source escapes plugin directory')
  let current = this.root
  for (const part of rel.split(path.sep)) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Source symlinks are not supported') }
  if (!this.cache.has(file)) {
   const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
   if ((source as any).parseDiagnostics?.length) throw new Error('Invalid TypeScript syntax')
   this.cache.set(file, source)
  }
  return this.cache.get(file)!
 }
 private trustedExternalPath(specifier: string): string | null {
  // Only framework-owned, public static contracts may participate in a
  // metadata inspection. Arbitrary package imports remain runtime review.
  const standalone = specifier === '@alneas/eaos-core/plugin-sdk'
  const publicManifest = /^@alneas\/eaos-plugins\/(?:approval|field-customization|admin)\/manifest$/.test(specifier)
  if (!standalone && !publicManifest && specifier !== '@dataarthub/eaos-framework/core/plugin-sdk') return null
  const packageName = publicManifest ? '@alneas/eaos-plugins' : standalone ? '@alneas/eaos-core' : '@dataarthub/eaos-framework'
  let current = this.workspaceRoot
  while (true) {
   const packageDir = path.join(current, 'node_modules', ...packageName.split('/'))
   const packageJson = path.join(packageDir, 'package.json')
   if (fs.existsSync(packageJson)) {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { exports?: Record<string, unknown> }
    const entry = pkg.exports?.[publicManifest ? '.' + specifier.slice(packageName.length) : standalone ? './plugin-sdk' : './*']
    const rawTarget = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' && 'import' in entry ? (entry as { import?: unknown }).import : undefined)
    if (typeof rawTarget !== 'string') return null
    const target = standalone || publicManifest ? rawTarget : rawTarget.replace('*', 'core/plugin-sdk')
    const resolved = path.resolve(packageDir, target)
    const relative = path.relative(packageDir, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(resolved)) return null
    const actual = fs.realpathSync(resolved), packageRoot = fs.realpathSync(packageDir)
    if (!actual.startsWith(packageRoot + path.sep)) return null
    this.externalFiles.add(resolved)
    this.externalRoots.set(resolved, packageRoot)
    return resolved
   }
   const parent = path.dirname(current)
   if (parent === current) return null
   current = parent
  }
 }
 private relativeModule(source: string, specifier: string): string {
  const direct = path.resolve(path.dirname(source), specifier)
  const base = direct.replace(/\.js$/, '')
  const target = [direct, base + '.ts', path.join(base, 'index.ts'), path.join(base, 'index.js')].find(f => fs.existsSync(f) && fs.statSync(f).isFile())
  if (!target) throw new Error('Local metadata import not found')
  const scope = this.externalRoots.get(source)
  if (scope) {
   if (!fs.realpathSync(target).startsWith(scope + path.sep)) throw new Error('External metadata import escapes SDK package')
   this.externalFiles.add(target)
   this.externalRoots.set(target, scope)
  }
  return target
 }
 private readExternal(file: string) {
  if (!this.externalFiles.has(file)) throw new Error('Untrusted external metadata source')
  if (!this.cache.has(file)) {
   const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
   if ((source as any).parseDiagnostics?.length) throw new Error('Invalid external TypeScript/JavaScript syntax')
   this.cache.set(file, source)
  }
  return this.cache.get(file)!
 }
 resolve(node: ts.Node, seen = new Set<ts.Node>()): ts.Node {
  if (seen.has(node)) throw new Error('Cyclic static declaration')
  seen = new Set(seen).add(node)
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) return this.resolve(node.expression, seen)
  if (!ts.isIdentifier(node)) return node
  const source = node.getSourceFile()
  for (const statement of source.statements) {
   if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.name.text === node.text && declaration.initializer) {
     if (!(statement.declarationList.flags & ts.NodeFlags.Const) && !this.externalFiles.has(source.fileName)) throw new Error('Mutable declarations require runtime review')
     return this.resolve(declaration.initializer, seen)
    }
   }
   if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
    const binding = statement.importClause.namedBindings.elements.find(b => b.name.text === node.text)
    if (!binding || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    let target: string | undefined
    if (specifier.startsWith('.')) {
     target = this.relativeModule(source.fileName, specifier)
    } else {
     target = this.trustedExternalPath(specifier) ?? undefined
     if (!target) throw new Error('External metadata imports require runtime review')
    }
    return this.exported(target, binding.propertyName?.text ?? binding.name.text, seen)
   }
  }
  throw new Error(`Unresolved static identifier: ${node.text}`)
 }
 exported(file: string, name: string, seen = new Set<ts.Node>()): ts.Node {
  const source = this.externalFiles.has(file) ? this.readExternal(file) : this.read(file)
  for (const statement of source.statements) if (ts.isVariableStatement(statement) && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
   for (const decl of statement.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) return this.resolve(decl.initializer, seen)
  }
  for (const statement of source.statements) if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause) && !statement.moduleSpecifier) {
   const specifier = statement.exportClause.elements.find(element => (element.name.text === name || element.propertyName?.text === name))
   if (specifier) {
    const localName = specifier.propertyName?.text ?? specifier.name.text
    for (const declaration of source.statements) if (ts.isVariableStatement(declaration)) {
     const value = declaration.declarationList.declarations.find(item => ts.isIdentifier(item.name) && item.name.text === localName && item.initializer)
     if (value?.initializer) return this.resolve(value.initializer, seen)
    }
    return this.resolve(specifier.propertyName ?? specifier.name, seen)
   }
  }
  for (const statement of source.statements) if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
   if (seen.has(statement)) throw new Error('Cyclic static declaration')
   const chain = new Set(seen).add(statement)
   const specifier = statement.moduleSpecifier.text
   const target = specifier.startsWith('.') ? this.relativeModule(source.fileName, specifier) : this.trustedExternalPath(specifier)
   if (!target) continue
   if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    const binding = statement.exportClause.elements.find(element => element.name.text === name)
    if (binding) return this.exported(target, binding.propertyName?.text ?? binding.name.text, chain)
   } else if (!statement.exportClause) {
    try { return this.exported(target, name, chain) } catch (error) { if (!(error instanceof Error) || !error.message.startsWith('Static exported const ')) throw error }
   }
  }
  throw new Error(`Static exported const ${name} not found`)
 }
 object(node: ts.Node): Map<string, ts.Node> {
  node = this.resolve(node)
  if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected static object literal')
  const result = new Map<string, ts.Node>()
  for (const prop of node.properties) {
   if (ts.isSpreadAssignment(prop) || !prop.name || ts.isComputedPropertyName(prop.name)) throw new Error('Spread/computed metadata requires runtime review')
   const name = prop.name.getText().replace(/^['"]|['"]$/g, '')
   if (result.has(name)) throw new Error(`Duplicate metadata key: ${name}`)
   if (ts.isPropertyAssignment(prop)) result.set(name, prop.initializer)
   else if (ts.isShorthandPropertyAssignment(prop)) result.set(name, prop.name)
   else if (ts.isMethodDeclaration(prop)) result.set(name, prop)
  }
  return result
 }
 array(node: ts.Node): readonly ts.Expression[] {
  node = this.resolve(node)
  if (!ts.isArrayLiteralExpression(node) || node.elements.some(ts.isSpreadElement)) throw new Error('Expected static array without spreads')
  return node.elements
 }
 string(node: ts.Node): string {
  node = this.resolve(node)
  if (!ts.isStringLiteralLike(node)) throw new Error('Expected static string')
  return node.text
 }
 strings(node?: ts.Node) { return node ? this.array(node).map(n => this.string(n)) : [] }
 literal(node: ts.Node, seen = new Set<ts.Node>()): unknown {
  node = this.resolve(node)
  if (seen.has(node)) throw new Error('Cyclic argument schema')
  seen = new Set(seen).add(node)
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text)
  if (ts.isBinaryExpression(node)) {
   const left = this.literal(node.left, seen), right = this.literal(node.right, seen)
   if (typeof left === 'number' && typeof right === 'number') {
    const operations: Record<number, () => number> = {
     [ts.SyntaxKind.PlusToken]: () => left + right,
     [ts.SyntaxKind.MinusToken]: () => left - right,
     [ts.SyntaxKind.AsteriskToken]: () => left * right,
     [ts.SyntaxKind.SlashToken]: () => left / right,
    }
    const value = operations[node.operatorToken.kind]?.()
    if (value !== undefined && Number.isFinite(value)) return value
   }
   throw new Error('Only finite numeric literal arithmetic is supported in static metadata')
  }
  if (ts.isArrayLiteralExpression(node)) return this.array(node).map(n => this.literal(n, seen))
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries([...this.object(node)].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, this.literal(v, seen)]))
  throw new Error('Argument schema must be static JSON Schema; dynamic/Zod factories require runtime review')
 }
 tools(node: ts.Node) {
  return this.array(node).map(n => {
   const obj = this.object(n), name = this.string(obj.get('name')!)
   const parameters = obj.get('parameters') ?? obj.get('inputSchema')
   if (!parameters) throw new Error(`Missing argument schema: ${name}`)
   const contract = this.literal(parameters)
   if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error(`Invalid argument schema: ${name}`)
   const contractNode = obj.get('contract')
   let executionContract: { version: string; permission: string; sideEffect: 'read' | 'write' | 'external'; outputSchema?: Record<string, unknown> } | undefined
   if (contractNode) {
    const value = this.literal(contractNode)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid execution contract: ${name}`)
    const metadata = value as Record<string, unknown>
    if (typeof metadata.version !== 'string' || !metadata.version.trim() || typeof metadata.permission !== 'string' || !metadata.permission.trim() || !['read', 'write', 'external'].includes(String(metadata.sideEffect))) throw new Error(`Invalid execution contract: ${name}`)
    if (metadata.outputSchema !== undefined && (!metadata.outputSchema || typeof metadata.outputSchema !== 'object' || Array.isArray(metadata.outputSchema))) throw new Error(`Invalid execution output schema: ${name}`)
    executionContract = { version: metadata.version, permission: metadata.permission, sideEffect: metadata.sideEffect as 'read' | 'write' | 'external', ...(metadata.outputSchema === undefined ? {} : { outputSchema: metadata.outputSchema as Record<string, unknown> }) }
   }
   return { name, parametersHash: createHash('sha256').update(JSON.stringify(contract)).digest('hex'), inputSchema: contract as Record<string, unknown>, ...(executionContract ? { contract: executionContract } : {}) }
  })
 }
}
/**
 * Statically inspect a plugin manifest and source contracts without executing the plugin.
 * @param root - Trusted workspace root.
 * @param pluginId - Plugin identifier whose manifest and sources are read.
 * @returns Source-derived plugin metadata, tools, policies and unresolved inspection issues.
 * @throws Invalid plugin paths and source/filesystem failures propagate.
 * @remarks Inspection issues must be resolved before generated metadata is treated as an executable contract.
 * @example
 * import { inspectPlugin } from '@alneas/eaos-cli/plugin-tools'
 * export function inspectNotes(root: string) { return inspectPlugin(root, 'notes') }
 */
export function inspectPlugin(root: string, pluginId: string): PluginInspection {
 const dir = findPluginDir(root, pluginId), reader = new SourceReader(dir, root)
 const result: PluginInspection = { pluginId, tables: [], tools: [], policies: {}, contracts: [], secrets: [], issues: [] }
 const issue = (code: string, message: string) => result.issues.push({ code, message })
 let manifest: Map<string, ts.Node> | undefined, declaredStorageTable: string | undefined, dataRequirements: Record<string, string> = {}
 try {
  manifest = reader.object(reader.exported(path.join(dir, 'manifest.ts'), 'manifest'))
  if (reader.string(manifest.get('id')!) !== pluginId) issue('manifest.id', 'Manifest ID differs from directory name')
  const api = manifest.get('api')
  if (api) result.apiPrefix = reader.string(reader.object(api).get('prefix')!)
  result.targets = reader.strings(manifest.get('targets'))
  const schema = manifest.get('schema')
  if (schema) {
   const schemaObject = reader.object(schema)
   result.tables = reader.strings(schemaObject.get('ownedTables'))
   const contracts = schemaObject.get('dataContracts')
   if (contracts) dataRequirements = reader.literal(contracts) as Record<string, string>
   if (Object.keys(dataRequirements).length) result.dataContracts = dataRequirements
   const storage = schemaObject.get('storage')
   if (storage) declaredStorageTable = reader.string(reader.object(storage).get('table')!)
   const storagePolicy = schemaObject.get('storagePolicy')
   if (!storagePolicy) {
    issue('schema.storage-policy.missing', 'Manifest schema.storagePolicy is required')
   } else {
    const value = reader.literal(storagePolicy)
    if (!value || typeof value !== 'object' || Array.isArray(value)) issue('schema.storage-policy', 'Storage policy must be a static object')
    else result.storagePolicy = value as PluginStoragePolicy
   }
  }
  result.contracts = reader.strings(manifest.get('contracts'))
  const mcp = manifest.get('mcp')
  if (mcp) { const tools = reader.object(mcp).get('tools'); if (tools) result.tools = reader.tools(tools) }
  const agent = manifest.get('agentCapabilities'), policies = agent && reader.object(agent).get('gatekeeperPolicies')
  if (policies) for (const [name, value] of reader.object(policies)) {
   const policy = reader.object(value), p: PluginInspection['policies'][string] = {}
   for (const key of ['requiredRole', 'riskLevel'] as const) if (policy.has(key)) p[key] = reader.string(policy.get(key)!)
   if (policy.has('requireHumanApproval')) {
    const bool = reader.resolve(policy.get('requireHumanApproval')!)
    if (![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(bool.kind)) throw new Error('Expected static approval boolean')
    p.requireHumanApproval = bool.kind === ts.SyntaxKind.TrueKeyword
   }
   result.policies[name] = p
   if (!result.tools.some(t => t.name === name)) issue('policy.unregistered', `Policy references unregistered tool: ${name}`)
   if (p.riskLevel && !['low', 'medium', 'high', 'critical'].includes(p.riskLevel)) issue('policy.risk', `Invalid riskLevel: ${name}`)
  }
  const secrets = manifest.get('secrets')
  if (secrets) for (const n of reader.array(secrets)) { const env = reader.object(n).get('envKey'); if (env) result.secrets.push(reader.string(env)) }
 } catch (error) { issue('source.unresolved', (error as Error).message) }
 const schemaPath = path.join(dir, 'src/db/schema.json')
 try {
  if (fs.existsSync(schemaPath)) {
   // Check symlink components without evaluating source.
   let current = dir
   for (const part of ['src', 'db', 'schema.json']) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Schema symlinks are not supported') }
   const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')), names: string[] = []
   for (const table of schema.tables ?? []) { const name = table.tableName ?? table.name; if (typeof name !== 'string') throw new Error('Invalid tables entry'); names.push(name) }
   for (const def of Object.values(schema.$defs ?? {}) as any[]) if (def['x-db']?.tableName) names.push(def['x-db'].tableName)
   if (schema.tableName ?? schema['x-db']?.tableName) names.push(schema.tableName ?? schema['x-db'].tableName)
   if (names.some(n => typeof n !== 'string') || new Set(names).size !== names.length) throw new Error('Invalid/duplicate schema table names')
   const reference = schema['x-data-contract']
   if (reference) {
    if (dataRequirements[reference.contractId] !== reference.version || schema.$ref !== `urn:eaos:data-contract:${reference.contractId}` || schema.properties || schema.$defs || schema['x-db']) issue('schema.contract-reference', 'Schema must reference its declared data contract without copying table definitions')
    if (declaredStorageTable && reference.table !== declaredStorageTable) issue('schema.contract-binding', 'Storage table differs from schema contract reference')
   }
   const expectedNames = result.tables.length ? result.tables : (declaredStorageTable ? [declaredStorageTable] : [])
   if (!reference && JSON.stringify([...names].sort()) !== JSON.stringify([...expectedNames].sort())) issue('schema.ownership', 'Schema tables differ from manifest.schema.ownedTables or declared shared storage')
  } else if (result.tables.length) issue('schema.missing', 'Owned tables require src/db/schema.json')
 } catch (error) { issue('schema.invalid', (error as Error).message) }
 if (new Set(result.tools.map(t => t.name)).size !== result.tools.length) issue('tools.duplicate', 'Duplicate registered MCP tool names')
 if (new Set(result.tables).size !== result.tables.length) issue('schema.duplicate', 'Duplicate owned tables')
 // Compare actual exported tool arrays with manifest registration, not nested properties named "name".
 const toolsFile = path.join(dir, 'src/mcp/tools.ts')
 if (fs.existsSync(toolsFile)) try {
  const declared: { name: string; parametersHash: string }[] = []
  for (const statement of reader.read(toolsFile).statements) if (ts.isVariableStatement(statement) && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
   for (const d of statement.declarationList.declarations) if (d.initializer && ts.isIdentifier(d.name) && /tools$/i.test(d.name.text)) declared.push(...reader.tools(d.initializer))
  }
  if (JSON.stringify(declared.map(t => t.name).sort()) !== JSON.stringify(result.tools.map(t => t.name).sort())) issue('tools.registration', 'Exported MCP tools differ from manifest.mcp.tools')
 } catch (error) { issue('tools.unresolved', (error as Error).message) }
 for (const file of ['README.md', 'AGENTS.md', 'docs/user-guide.md', 'docs/maintainer-guide.md']) {
  const full = path.join(dir, file)
  let current = dir, linked = false
  for (const part of file.split('/')) { current = path.join(current, part); if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) linked = true }
  if (linked) { issue('docs.symlink', `Document symlink: ${file}`); continue }
  if (!fs.existsSync(full) || !fs.readFileSync(full, 'utf8').trim()) issue('docs.missing', `Missing document: ${file}`)
 }
 result.tables.sort(); result.tools.sort((a,b) => a.name.localeCompare(b.name)); result.contracts.sort(); result.secrets.sort()
 result.policies = Object.fromEntries(Object.entries(result.policies).sort(([a],[b]) => a.localeCompare(b)))
 return result
}
