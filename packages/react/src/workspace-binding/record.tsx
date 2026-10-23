import {useMemo,type ComponentType} from 'react'
import type {WorkspaceClient,WorkspaceProviderProps} from '../index'
import type {RecordWorkspaceProps,RecordWorkspaceReference} from '../record-workspace'
import {useWorkspaceConnection,type WorkspaceBindingEnvironment,type WorkspaceConnection,type ConnectedWorkspacePage} from '../workspace-binding'

/** Owner-declared list operation; no implementation discovery or tenant defaults.
 * @see createRecordWorkspaceClient
 */
export interface RecordWorkspaceDefinition {
 /** Canonical feature owner. */
 pluginId:string
 /** Owner-declared list command name. */
 listOperation:string
 /** Explicit list input; absent uses limit 100 while an empty object stays empty. */
 loadInput?:Record<string,unknown>
}
/** Build-selected data-only reference catalog, never an all-feature implementation barrel.
 * @see createRecordWorkspacePages
 */
export interface RecordWorkspaceEnvironment extends WorkspaceBindingEnvironment {
 /** Explicit selected owner/list declarations used by reference selectors. */
 referenceCatalog?:readonly RecordWorkspaceDefinition[]
}
/** Owner-declared browser page and its canonical Provider.
 * @see createRecordWorkspacePages
 */
export interface RecordWorkspaceRoute {
 /** Declared application route. */
 path:string
 /** Navigation fallback supplied by the feature. */
 label:string
 /** Raw owner page accepting optional authorized reference catalogs. */
 Page:ComponentType<RecordWorkspaceProps>
 /** Existing owner context Provider; no replacement context is created. */
 Provider:ComponentType<WorkspaceProviderProps<unknown>>
}
/** Wrap domain results in the existing owner's UI envelope; domain data remains unknown.
 * @param connection - Current verified and adopted request scope.
 * @param definition - Exact owner list mapping and optional input.
 * @returns Load/execute client with owner record identity and revision zero.
 * @throws Operations reject transport failures, expired scopes and foreign embedded tenants.
 * @example
 * import {createRecordWorkspaceClient} from '@alneas/eaos-react/workspace-binding/record'
 * export const connect=(...args:Parameters<typeof createRecordWorkspaceClient>)=>createRecordWorkspaceClient(...args)
 */
export function createRecordWorkspaceClient(connection:WorkspaceConnection,definition:RecordWorkspaceDefinition):WorkspaceClient<unknown>{
 const execute=async(operation:string,input:Record<string,unknown>)=>{
  const data=await connection.command({pluginId:definition.pluginId,operation,input})
  if(data&&typeof data==='object'&&'tenantId' in data&&data.tenantId!==connection.identity?.tenantId)throw Error('Foreign workspace response')
  return {tenantId:connection.identity?.tenantId??'',recordId:definition.pluginId,revision:0,data}
 }
 return {load:()=>execute(definition.listOperation,definition.loadInput??{limit:100}),execute}
}
/** Resolve only an explicitly declared, currently admitted reference list operation.
 * @param connection - Current verified browser scope.
 * @param declarations - Explicit selected feature/list catalog.
 * @param reference - Owner page's declared reference selector.
 * @returns Client restricted to that exact list operation.
 * @throws Unknown/revoked references throw immediately; other operations reject before transport.
 * @example
 * import {createRecordReferenceClient} from '@alneas/eaos-react/workspace-binding/record'
 * export const connect=(...args:Parameters<typeof createRecordReferenceClient>)=>createRecordReferenceClient(...args)
 */
export function createRecordReferenceClient(connection:WorkspaceConnection,declarations:readonly RecordWorkspaceDefinition[],reference:RecordWorkspaceReference):WorkspaceClient<unknown>{
 const target=declarations.find(item=>item.pluginId===reference.pluginId&&item.listOperation===reference.listOperation)
 if(!target||!connection.identity?.enabledPluginIds.includes(target.pluginId))throw Error('Related workspace is unavailable')
 const client=createRecordWorkspaceClient(connection,target)
 return {load:()=>client.execute(target.listOperation,{limit:100}),execute:async(operation,input)=>{
  if(operation!==target.listOperation)throw Error('Related workspace operation is unavailable')
  return client.execute(operation,input)
 }}
}
/** Compose only this owner's declared routes; reference declarations are explicit inputs.
 * @param environment - Canonical Host context and configured API.
 * @param definition - Owner list/record mapping.
 * @param routes - Raw pages and their existing Providers.
 * @param references - Explicit adopted reference lists, defaulting to none.
 * @returns Connected pages still requiring live WorkspaceFeatureBoundary admission.
 * @example
 * import {createRecordWorkspacePages} from '@alneas/eaos-react/workspace-binding/record'
 * export const connect=(...args:Parameters<typeof createRecordWorkspacePages>)=>createRecordWorkspacePages(...args)
 */
export function createRecordWorkspacePages(environment:WorkspaceBindingEnvironment,definition:RecordWorkspaceDefinition,routes:readonly RecordWorkspaceRoute[],references:readonly RecordWorkspaceDefinition[]=[]):readonly ConnectedWorkspacePage[]{
 return routes.map(({Page,Provider,path,label})=>{
  function ConnectedRecord(){
   const connection=useWorkspaceConnection(environment),identity=connection.identity
   const client=useMemo(()=>createRecordWorkspaceClient(connection,definition),[connection])
   const referenceClient=useMemo(()=>(reference:RecordWorkspaceReference)=>createRecordReferenceClient(connection,references,reference),[connection])
   return <Provider tenantId={identity?.tenantId??null} sessionKey={identity?.sessionKey??null} recordId={definition.pluginId} client={client}><Page referenceClient={referenceClient}/></Provider>
  }
  return {pluginId:definition.pluginId,path,label,component:ConnectedRecord}
 })
}
