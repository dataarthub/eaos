import ts from 'typescript'
import { writeGeneratedFiles } from './generated-files'

/** Data-only package declarations; no functions, source paths or host credentials.
 * @see generateFeatureRegistrations
 */
export interface OfficialFeatureDescriptor {
  /** Stable owner-declared feature identity. */
  id: string
  /** Exact installed owner version, without a range. */
  version: string
  /** Supported package subpath exporting manifest metadata. */
  manifest: string
  /** Optional supported runtime entry, never imported by generated browser metadata. */
  server?: string
  /** Supported lifecycle export required for an adopted feature. */
  lifecycle?: {
    /** Package subpath exporting the lifecycle definition. */
    entry: string
    /** JavaScript export name for that definition. */
    exportName: string
  }
  /** Other feature IDs that must be explicitly adopted together. */
  dependencies?: readonly string[]
  /** Owner-declared client entrypoints without host credentials or implementations. */
  clients: Array<{
    /** Client family; browser output selects web. */
    target: string
    /** Supported client package subpath; a server entry is rejected. */
    entry: string
    /** Component export name, including default where applicable. */
    exportName: string
    /** Declared application route. */
    path: string
    /** Optional package subpath providing its client context. */
    providerEntry?: string
    /** Export name of the client context provider. */
    providerExport?: string
    /** Owner factory contract; false explicitly marks a raw-only route. */
    workspace?: false | {
      /** Published browser-only factory entry. */
      entry: string
      /** Factory export name. */
      exportName: string
      /** Exact owner navigation fallback. */
      label: string
      /** Optional canonical reference list declaration. */
      reference?: {
        /** Owner-declared list operation. */
        listOperation: string
      }
    }
  }>
}
/** Explicit application adoption and separate generated modules.
 * @see generateFeatureRegistrations
 */
export interface FeatureRegistrationOptions {
  /** Trusted owner descriptors; duplicate identities are rejected. */
  descriptors: readonly OfficialFeatureDescriptor[]
  /** Exact reviewed build selection, including required dependencies. */
  selectedIds: readonly string[]
  /** Distinct project-relative generated module destinations. */
  outputs: {
    /** Server-only manifest import module. */
    manifests: string
    /** Server-only lifecycle import module. */
    lifecycle: string
    /** Browser-safe client metadata module. */
    web: string
    /** Optional connected browser factory module. */
    bindings?: string
  }
  /** Validate exact current output without repairing it. */
  check?: boolean
  /** Application-owned routes unavailable to connected feature pages. */
  reservedRoutes?: readonly string[]
  /** Optional Host-owned port modules, imported only for selected connected owners. */
  workspacePorts?: Readonly<Record<string,{
    /** Browser module path relative to the generated bindings module, starting with ./ . */
    entry:string
    /** Named export supplying that owner's required ports. */
    exportName:string
  }>>
}
const quote = JSON.stringify
const entryPattern = /^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/
const symbolPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Generate separate manifest, lifecycle and browser metadata for explicit adoption.
 * @param root - Trusted application project root.
 * @param options - Data-only descriptors, exact adoption IDs and project-relative outputs.
 * @returns Completion after all generated modules are replaced, or after read-only freshness verification.
 * @throws On unknown/duplicate selections, unsafe declarations, missing dependencies/lifecycle, stale output or filesystem failures.
 * @remarks Imports only selected feature entries. Browser output contains client metadata without server imports. Generation never loads a plugin, deploys or activates a tenant.
 * @example
 * import { generateFeatureRegistrations, type FeatureRegistrationOptions } from '@alneas/eaos-cli/platform'
 * export const prepare = (root: string, options: FeatureRegistrationOptions) => generateFeatureRegistrations(root, options)
 */
export async function generateFeatureRegistrations(root: string, options: FeatureRegistrationOptions): Promise<void> {
  const byId = new Map(options.descriptors.map(item => [item.id, item]))
  if (byId.size !== options.descriptors.length || new Set(options.selectedIds).size !== options.selectedIds.length) throw Error('Duplicate feature identity')
  const selected = options.selectedIds.map(id => { const feature = byId.get(id); if (!feature) throw Error('Unknown selected feature: ' + id); return feature })
  for (const feature of selected) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(feature.id) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(feature.version) || !feature.lifecycle || !Array.isArray(feature.clients)) throw Error('Invalid feature version/lifecycle/client declarations: ' + feature.id)
    for (const entry of [feature.manifest, feature.server, feature.lifecycle.entry, ...feature.clients.flatMap(client => [client.entry, client.providerEntry, client.workspace ? client.workspace.entry : undefined])].filter((value): value is string => value !== undefined)) {
      if (!entryPattern.test(entry) || entry.split('/').some(segment => segment === '.' || segment === '..')) throw Error('Invalid feature package export')
    }
    if (!symbolPattern.test(feature.lifecycle.exportName)) throw Error('Invalid lifecycle export')
    for (const id of feature.dependencies ?? []) if (!options.selectedIds.includes(id)) throw Error(`Selected feature ${feature.id} requires explicit adoption of ${id}`)
    for (const client of feature.clients) {
      if (!symbolPattern.test(client.exportName) || client.providerExport && !symbolPattern.test(client.providerExport) || !/^\/[A-Za-z0-9/_-]*$/.test(client.path) || client.entry.split('/').includes('server')) throw Error('Invalid client export or route')
      if(client.workspace&&(!symbolPattern.test(client.workspace.exportName)||!client.workspace.label||client.workspace.entry.split('/').includes('server')||client.workspace.reference&&!client.workspace.reference.listOperation))throw Error('Invalid workspace factory declaration')
    }
  }
  const manifests: string[] = [], lifecycle: string[] = []
  selected.forEach((feature, i) => {
    manifests.push(`import { manifest as manifest${i} } from ${quote(feature.manifest)}`, `if(manifest${i}.id!==${quote(feature.id)}||manifest${i}.version!==${quote(feature.version)})throw Error('Selected feature manifest identity/version differs')`)
    lifecycle.push(`import { ${feature.lifecycle!.exportName} as release${i} } from ${quote(feature.lifecycle!.entry)}`, `if(release${i}.id!==${quote(feature.id)}||release${i}.version!==${quote(feature.version)})throw Error('Selected feature lifecycle identity/version differs')`)
  })
  manifests.push(`export const officialManifests=[${selected.map((_, i) => 'manifest' + i).join(',')}]`)
  lifecycle.push(`export const officialReleases=[${selected.map((_, i) => 'release' + i).join(',')}]`)
  const web = `export const selectedOfficialPluginIds=${quote(options.selectedIds)} as const\nexport const officialFeatureClients=${quote(selected.flatMap(feature => feature.clients.filter(client => client.target === 'web').map(client => ({ pluginId: feature.id, ...client }))))} as const\n`
  const files=[{path:options.outputs.manifests,text:manifests.join('\n')+'\n'},{path:options.outputs.lifecycle,text:lifecycle.join('\n')+'\n'},{path:options.outputs.web,text:web}]
  if(options.outputs.bindings){
    const paths=new Set(options.reservedRoutes??[]),factories:string[]=[],imports:string[]=[],declarations:unknown[]=[],references:unknown[]=[],ports:string[]=[],portImports:string[]=[]
    for(const feature of selected){
      const clients=feature.clients.filter(client=>client.target==='web'&&client.workspace!==false)
      if(!clients.length)continue
      if(clients.some(client=>!client.workspace))throw Error('Missing workspace factory declaration: '+feature.id)
      const binding=clients[0].workspace
      if(!binding)throw Error('Missing workspace factory')
      const routes=clients.map(client=>{
        if(!client.workspace||client.workspace.entry!==binding.entry||client.workspace.exportName!==binding.exportName)throw Error('Inconsistent workspace factory')
        if(paths.has(client.path))throw Error('Duplicate or reserved workspace route: '+client.path)
        paths.add(client.path)
        if(client.workspace.reference)references.push({pluginId:feature.id,...client.workspace.reference})
        return {path:client.path,label:client.workspace.label}
      })
      const name='bind'+imports.length
      imports.push(`import { ${binding.exportName} as ${name} } from ${quote(binding.entry)}`)
      factories.push(`[${quote(feature.id)}]:${name}`)
      declarations.push({pluginId:feature.id,routes})
      const port=options.workspacePorts?.[feature.id]
      if(port){
        if(!/^\.\/[A-Za-z0-9_/-]+$/.test(port.entry)||port.entry.includes('//')||!symbolPattern.test(port.exportName))throw Error('Invalid Host workspace port module')
        const name='ports'+portImports.length
        portImports.push(`import { ${port.exportName} as ${name} } from ${quote(port.entry)}`)
        ports.push(`[${quote(feature.id)}]:${name}`)
      }
    }
    const uniqueReferences=[...new Map(references.map(value=>[quote(value),value])).values()]
    const text=`import {composeWorkspacePages,type WorkspaceBindingEnvironment,type WorkspaceFactoryOptions} from '@alneas/eaos-react/workspace-binding'\n${imports.join('\n')}\n${portImports.join('\n')}\nconst factories={${factories.join(',')}}\nexport type OfficialWorkspaceOptions=WorkspaceFactoryOptions<typeof factories>\n${options.workspacePorts?`export const officialWorkspaceOptions={${ports.join(',')}} satisfies OfficialWorkspaceOptions\n`:''}export function createOfficialWorkspacePages(environment:WorkspaceBindingEnvironment,options:OfficialWorkspaceOptions){return composeWorkspacePages(environment,factories,${quote(declarations)},options,${quote(uniqueReferences)})}\n`
    files.push({path:options.outputs.bindings,text})
  }
  await writeGeneratedFiles(root,files,options.check)

}

/**
 * Select static pluginId registrations and their reachable host client adapters.
 * @param source - Trusted TS/TSX host adapter module; registrations use literal pluginId fields.
 * @param selectedIds - Exact build adoption IDs.
 * @returns TypeScript source with unselected registration rows and unreachable imports/declarations removed.
 * @remarks Does not execute the source. Dynamic peer choices may still reference additional features; hosts must validate remaining official import identities against their adoption set.
 * @example
 * import { selectClientBindings } from '@alneas/eaos-cli/platform'
 * const source = selectClientBindings("export const pages=[{pluginId:'one'}]", ['one'])
 */
export function selectClientBindings(source: string, selectedIds: readonly string[]): string {
  const selected = new Set(selectedIds), file = ts.createSourceFile('host.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const transform = ts.transform(file, [context => {
    const visit: ts.Visitor = node => {
      if (ts.isArrayLiteralExpression(node)) {
        const elements = node.elements.filter(element => {
          if (!ts.isObjectLiteralExpression(element)) return true
          const property = element.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(file) === 'pluginId')
          return !property || !ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer) || selected.has(property.initializer.text)
        })
        return ts.visitEachChild(ts.factory.updateArrayLiteralExpression(node, elements), visit, context)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return root => ts.visitNode(root, visit) as ts.SourceFile
  }])
  const result = transform.transformed[0] as ts.SourceFile
  const names = (node: ts.Statement) => ts.isVariableStatement(node) ? node.declarationList.declarations.flatMap(item => ts.isIdentifier(item.name) ? [item.name.text] : []) : (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name ? [node.name.text] : []
  const declarations = new Map<string, ts.Statement>()
  for (const node of result.statements) for (const name of names(node)) declarations.set(name, node)
  const needed = new Set<string>(), queue: string[] = []
  const collect = (node: ts.Node) => { const walk = (value: ts.Node) => { if (ts.isIdentifier(value) && !needed.has(value.text)) { needed.add(value.text); queue.push(value.text) }; ts.forEachChild(value, walk) }; walk(node) }
  for (const node of result.statements) {
    if (ts.isExportAssignment(node)) collect(node.expression)
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) for (const entry of node.exportClause.elements) collect(entry.propertyName ?? entry.name)
  }
  for (const node of result.statements) if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) collect(node)
  for (let i = 0; i < queue.length; i++) { const node = declarations.get(queue[i]); if (node) collect(node) }
  const statements: ts.Statement[] = []
  for (const node of result.statements) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause, bindings = clause.namedBindings
      const name = clause.name && needed.has(clause.name.text) ? clause.name : undefined
      const chosen = bindings && ts.isNamedImports(bindings) ? ts.factory.updateNamedImports(bindings, bindings.elements.filter(item => needed.has(item.name.text))) : bindings && needed.has(bindings.name.text) ? bindings : undefined
      const nonempty = chosen && (!ts.isNamedImports(chosen) || chosen.elements.length) ? chosen : undefined
      if (name || nonempty) statements.push(ts.factory.updateImportDeclaration(node, node.modifiers, ts.factory.updateImportClause(clause, clause.isTypeOnly, name, nonempty), node.moduleSpecifier, node.attributes))
    } else if (!names(node).length || names(node).some(name => needed.has(name))) statements.push(node)
  }
  const printed = ts.createPrinter().printFile(ts.factory.updateSourceFile(result, statements))
  transform.dispose()
  return printed
}
