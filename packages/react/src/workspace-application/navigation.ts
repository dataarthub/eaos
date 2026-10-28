import type {WorkspaceContext,WorkspaceNavigationOptions,WorkspaceNavigationGroup} from './types'
import {resolveWorkspaceState} from './state'
/**
 * Projects current admitted plugin links intersected with shipped owner routes.
 * @typeParam T - Host tenant display and admission contract.
 * @param options - Verified session, current tenant snapshot, registrations and optional labels.
 * @returns Fresh ordered groups; stale, loading or denied plugins contribute no links.
 * @throws Error when multiple plugins claim one registered path.
 * @remarks UI presentation only; the Host must authorize every backend request.
 * @example
 * ```typescript
 * import {projectWorkspaceNavigation, type WorkspaceNavigationOptions} from '@alneas/eaos-react/workspace-application';
 * export function links(options:WorkspaceNavigationOptions){return projectWorkspaceNavigation(options);}
 * ```
 */
export function projectWorkspaceNavigation<T extends WorkspaceContext>(options:WorkspaceNavigationOptions<T>):WorkspaceNavigationGroup[] {
 const owners=new Map<string,string>()
 for(const page of options.pages){
  const owner=owners.get(page.path)
  if(owner&&owner!==page.pluginId)throw Error('Multiple plugins claim the same workspace path')
  owners.set(page.path,page.pluginId)
 }
 if(resolveWorkspaceState(options.session,options.tenant)!=='ready')return []
 const context=options.tenant.context!,seen=new Set<string>(),groups:WorkspaceNavigationGroup[]=[]
 for(const plugin of Array.isArray(context.plugins)?context.plugins:[]){
  if(!plugin||typeof plugin.id!=='string'||!context.enabledModules.includes(plugin.id)||context.pluginAccess?.[plugin.id]?.allowed!==true)continue
  const web=options.resolveNavigation?.(plugin)??plugin.navigation?.web
  if(!Array.isArray(web?.children))continue
  const items:WorkspaceNavigationGroup['items']=[]
  for(const item of web.children){
   if(!item||typeof item.path!=='string'||typeof item.label!=='string'||owners.get(item.path)!==plugin.id||seen.has(item.path))continue
   seen.add(item.path);items.push({label:item.label,path:item.path,icon:null})
  }
  if(items.length)groups.push({title:web?.label||plugin.name,items})
 }
 return groups
}
