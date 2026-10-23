import type {ConnectedWorkspacePage,WorkspaceBindingEnvironment,WorkspaceReferenceDeclaration} from '../workspace-binding'

type Factories=Record<string,(...args:never[])=>readonly ConnectedWorkspacePage[]>
type Tail<F extends (...args:never[])=>unknown>=Parameters<F> extends [unknown,...infer Rest]?Rest:[]
type RequiredKeys<T extends Factories>={[K in keyof T]:Tail<T[K]> extends [unknown,...unknown[]]?K:never}[keyof T]
type OptionalKeys<T extends Factories>={[K in keyof T]:Tail<T[K]> extends []?never:K}[keyof T]
/** Factory-specific options, preserving mandatory ports for the selected owners.
 * @typeParam T - Explicit selected factory map.
 * @see composeWorkspacePages
 */
export type WorkspaceFactoryOptions<T extends Factories>=
 {[K in RequiredKeys<T>]:Tail<T[K]>[0]} & {[K in Exclude<OptionalKeys<T>,RequiredKeys<T>>]?:Tail<T[K]>[0]}

/** Selected owner routes used to verify factory output without loading a catalog.
 * @see composeWorkspacePages
 */
export interface WorkspacePageDeclaration {
 /** Canonical adopted owner. */
 pluginId:string
 /** Complete connected route set for that owner. */
 routes:readonly {
  /** Absolute application route. */
  path:string
  /** Owner navigation fallback. */
  label:string
 }[]
}
const validPath=(path:string)=>/^\/[A-Za-z0-9/_-]*$/.test(path)&&!path.includes('//')
const isComponent=(value:unknown)=>typeof value==='function'||!!value&&typeof value==='object'&&'$$typeof' in value&&[Symbol.for('react.memo'),Symbol.for('react.forward_ref'),Symbol.for('react.lazy')].includes(value.$$typeof as symbol)

/** Compose selected owner factories and verify their exact declared route sets.
 * @typeParam T - Explicit selected factory map.
 * @param environment - Canonical Host identity and browser ports.
 * @param factories - Explicit selected factory imports; no runtime feature discovery.
 * @param declarations - Complete owner/path/label contracts.
 * @param options - Factory-specific ports, including required second arguments.
 * @param references - Selected data-only reference list declarations.
 * @returns Connected pages whose identities and routes match the declarations.
 * @throws Before rendering on unknown options, unadopted owners or incompatible factory output.
 * @remarks Factories are trusted installed code. This validates composition contracts, not server authorization.
 * @example
 * import {composeWorkspacePages,type WorkspaceBindingEnvironment} from '@alneas/eaos-react/workspace-binding'
 * export const emptyPages=(environment:WorkspaceBindingEnvironment)=>composeWorkspacePages(environment,{},[],{})
 */
export function composeWorkspacePages<T extends Factories>(environment:WorkspaceBindingEnvironment,factories:T,declarations:readonly WorkspacePageDeclaration[],options:WorkspaceFactoryOptions<T>,references:readonly WorkspaceReferenceDeclaration[]=[]):readonly ConnectedWorkspacePage[]{
 const selected=new Set(environment.selectedIds),owners=new Set<string>(),paths=new Set<string>()
 for(const declaration of declarations){
  if(owners.has(declaration.pluginId)||!selected.has(declaration.pluginId)||!Object.hasOwn(factories,declaration.pluginId)||!declaration.routes.length)throw Error('Invalid selected workspace owner')
  owners.add(declaration.pluginId)
  for(const route of declaration.routes){
   if(!validPath(route.path)||paths.has(route.path)||!route.label)throw Error('Invalid or duplicate workspace route')
   paths.add(route.path)
  }
 }
 if(Object.keys(factories).some(id=>!owners.has(id))||Object.keys(options).some(id=>!owners.has(id)))throw Error('Unknown workspace factory or options')
 if(references.some(reference=>!selected.has(reference.pluginId)||!reference.listOperation))throw Error('Invalid workspace reference declaration')
 const scope={...environment,referenceCatalog:references},pages:ConnectedWorkspacePage[]=[]
 for(const declaration of declarations){
  const value:unknown=Reflect.apply(factories[declaration.pluginId],undefined,[scope,options[declaration.pluginId as keyof typeof options]])
  if(!Array.isArray(value)||value.length!==declaration.routes.length)throw Error('Incomplete workspace factory output')
  const remaining=new Map(declaration.routes.map(route=>[route.path,route.label]))
  for(const page of value){
   if(!page||page.pluginId!==declaration.pluginId||!remaining.has(page.path)||remaining.get(page.path)!==page.label||!isComponent(page.component))throw Error('Workspace factory output differs from declaration')
   remaining.delete(page.path);pages.push(page)
  }
 }
 return pages
}
