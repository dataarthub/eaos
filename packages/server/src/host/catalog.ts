import {createHostManifestCatalog,validateExtensions,scopeExtensionFactories} from '../extensions'
import type {StandardHostPolicyOptions} from './types'

// Snapshot metadata without cloning executable functions or caller-owned router objects.
function snapshot<T>(value:T):T {
 if(Array.isArray(value))return value.map(snapshot) as T
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,snapshot(item)])) as T
 return value
}
export function prepareHostCatalog(options:StandardHostPolicyOptions){
 const extensions=validateExtensions(snapshot([...(options.extensions??[])]))
 const manifests=[...snapshot([...options.manifests]),...extensions.flatMap(item=>(item.manifests??[]).map(manifest=>({...manifest,tier:'corporate' as const,entitlement:{...manifest.entitlement,tier:'corporate' as const,allowedTenants:[...item.tenantIds]}})))]
 const routes={...options.routeFactories}
 for(const item of extensions.map(scopeExtensionFactories))for(const [id,factory]of Object.entries(item.routeFactories??{})){
  if(id in routes)throw Error('Conflicting host route factory: '+id)
  routes[id]=factory
 }
 const mcpPluginIds=[...(options.mcpPluginIds??[])]
 if(new Set(mcpPluginIds).size!==mcpPluginIds.length)throw Error('Duplicate MCP plugin id')
 const catalog=createHostManifestCatalog({manifests,routeFactories:routes,mcpPluginIds})
 const ids=options.pluginIds?[...options.pluginIds]:catalog.map(item=>item.id),byId=new Map(catalog.map(item=>[item.id,item]))
 if(new Set(ids).size!==ids.length)throw Error('Duplicate selected host plugin id')
 for(const id of ids)if(!byId.has(id))throw Error('Unknown selected host plugin: '+id)
 const selected=new Set(ids),selectedExtensions=extensions.map(item=>({...item,manifests:item.manifests?.filter(m=>selected.has(m.id)),routeFactories:Object.fromEntries(Object.entries(item.routeFactories??{}).filter(([id])=>selected.has(id))),routes:item.routes?.filter(route=>selected.has(route.moduleId))}))
 const prefixes=new Map<string,Set<string>>()
 for(const item of selectedExtensions)for(const route of item.routes??[]){
  const tenants=prefixes.get(route.prefix)??new Set<string>()
  if(item.tenantIds.some(id=>tenants.has(id)))throw Error('Conflicting extension API prefix for tenant')
  item.tenantIds.forEach(id=>tenants.add(id));prefixes.set(route.prefix,tenants)
 }
 return {manifests:ids.map(id=>byId.get(id)!),extensions:selectedExtensions,mcpPluginIds:mcpPluginIds.filter(id=>selected.has(id))}
}
