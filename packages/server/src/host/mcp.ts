import {getPlatformPluginAuthorization} from '../extensions'
import {PluginError} from '../plugin-data'
import type {McpRouterOptions} from '../mcp'
import type {HostMcpBindingOptions} from './types'
/**
 * Bind selected tools to the trusted current request and recheck authority before execution.
 * @param options - Selected feature IDs, owning binder and request-local context bridge.
 * @returns An Engine-compatible current tool-context factory.
 * @throws Missing membership or changed tenant/user/grants deny with 403; unavailable tools deny with 404.
 * @example
 * import { createHostMcpToolContext, type HostMcpBindingOptions } from '@alneas/eaos-server/host'
 * export const bindTools = (options: HostMcpBindingOptions) => createHostMcpToolContext(options)
 */
export function createHostMcpToolContext(options:HostMcpBindingOptions):NonNullable<McpRouterOptions['createToolContext']>{
 const selected=new Set(options.pluginIds),currentContext=options.requestContext.current,bind=options.bindPlugin
 return async(principal,id)=>{
  const {tenantId,userId}=principal
  const context=currentContext(),live=await getPlatformPluginAuthorization(context)?.resolvePrincipal()
  if(!selected.has(id)||!live||live.tenantId!==tenantId||live.userId!==userId||!live.enabledPluginIds.includes(id))throw new PluginError(403,'Current MCP membership required')
  const plugin=await bind(context,id)
  if(plugin instanceof Response||!plugin?.mcp)throw new PluginError(404,'Bound plugin tools unavailable')
  return{callPluginTool:async(name:string,args:Record<string,unknown>)=>{
   const current=await getPlatformPluginAuthorization(context)?.resolvePrincipal()
   if(!current||current.tenantId!==tenantId||current.userId!==userId||!current.enabledPluginIds.includes(id))throw new PluginError(403,'MCP access revoked')
   const tool=plugin.mcp!.tools.find(tool=>tool.name===name)
   if(!tool)throw new PluginError(404,'Bound tool unavailable')
   return tool.handler(args,{tenantId:tenantId,userId:userId,roles:[...current.roles]})
  }}
 }
}
