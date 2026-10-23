import {useMemo,useState,type ComponentType,type ReactNode} from 'react'
import type {WorkspaceClient,WorkspaceProviderProps} from '../index'
import {useWorkspaceConnection,type WorkspaceBindingEnvironment,type WorkspaceConnection,type ConnectedWorkspacePage} from '../workspace-binding'

/** Explicit command aggregate identity and immutable query scope.
 * @see createCommandWorkspaceClient
 */
export interface CommandWorkspaceDefinition {
 /** Canonical feature owner. */
 pluginId:string
 /** Aggregate record identity; defaults to state. */
 recordId?:string
 /** Scope values override caller command input and remain pinned through reload. */
 scope?:Readonly<Record<string,string>>
}
/** Adapt aggregate snapshot and command/reload sequencing to the existing owner client.
 * T is the owner's DTO contract, not a claim that this adapter validates its business fields.
 * Identity, record/revision and embedded tenant are checked here; owners retain domain validation.
 * @typeParam T - Owner DTO type asserted at the transport boundary.
 * @param connection - Current verified browser connection.
 * @param definition - Owner aggregate and pinned query scope.
 * @returns Load/execute client rejecting foreign or malformed snapshot envelopes.
 * @throws Methods reject invalid envelopes, conflicts, transport failures and expired requests.
 * @example
 * import {createCommandWorkspaceClient} from '@alneas/eaos-react/workspace-binding/command'
 * export const connect=(...args:Parameters<typeof createCommandWorkspaceClient>)=>createCommandWorkspaceClient(...args)
 */
export function createCommandWorkspaceClient<T=unknown>(connection:WorkspaceConnection,definition:CommandWorkspaceDefinition):WorkspaceClient<T>{
 const recordId=definition.recordId??'state',scope={...definition.scope}
 const load=async()=>{
  const value=await connection.command<{tenantId:string;recordId?:string;revision:number;data?:T}>({pluginId:definition.pluginId,operation:'snapshot',input:scope})
  if(!value||typeof value!=='object'||value.tenantId!==connection.identity?.tenantId||!Number.isSafeInteger(value.revision)||value.revision<0||value.recordId!==undefined&&value.recordId!==recordId)throw Error('Invalid workspace snapshot')
  const data=value.data===undefined?value:value.data
  if(!data||typeof data!=='object'||'tenantId' in data&&data.tenantId!==value.tenantId)throw Error('Foreign workspace snapshot')
  // A legacy raw state and a current data envelope carry the same owner DTO.
  // The explicit owner generic is a transport boundary assertion, like WorkspaceApi.request<T>.
  return {tenantId:value.tenantId,recordId,revision:value.revision,data:data as T}
 }
 return {load,execute:async(operation,input)=>{await connection.command({pluginId:definition.pluginId,operation,input:{...input,...scope}});return load()}}
}
/** One explicitly chosen query resource and its descendant render function.
 * @see WorkspaceScope
 */
export interface WorkspaceScopeProps {
 /** Host-owned current query and replacement adapter. */
 environment:WorkspaceBindingEnvironment
 /** URL query field declared by the owning feature. */
 name:string
 /** Accessible resource field label supplied by its owner. */
 label:string
 /** Submit button label, defaulting to Open. */
 submitLabel?:string
 /** Render the chosen resource; descendants remount when it changes. */
 children:(id:string)=>ReactNode
}
/** Explicit router query scope, without an invented resource identity.
 * @param props - Query field/labels and resource render callback.
 * @returns Resource chooser plus keyed content only after explicit selection.
 * @example
 * import * as React from 'react'
 * import {WorkspaceScope,type WorkspaceScopeProps} from '@alneas/eaos-react/workspace-binding/command'
 * export function Scope(props:WorkspaceScopeProps){return <WorkspaceScope {...props}/>}
 */
export function WorkspaceScope({environment,name,label,submitLabel='Open',children}:WorkspaceScopeProps){
 const [id,setId]=useState(()=>new URLSearchParams(environment.query.read()).get(name)??'')
 return <><form onSubmit={event=>{
  event.preventDefault();const value=new FormData(event.currentTarget).get('scope')
  if(typeof value!=='string'||!value.trim()||value.length>128)return
  const next=value.trim(),query=new URLSearchParams(environment.query.read());query.set(name,next);environment.query.replace(query.toString());setId(next)
 }}><label>{label}<input name="scope" required maxLength={128} defaultValue={id}/></label><button type="submit">{submitLabel}</button></form>{id&&<section key={id}>{children(id)}</section>}</>
}
/** Connected aggregate route, scope and canonical owner Provider.
 * @typeParam T - Owner snapshot data contract.
 * @see createCommandWorkspacePages
 */
export interface CommandWorkspacePageDefinition<T> {
 /** Canonical feature owner. */
 pluginId:string
 /** Declared application route. */
 path:string
 /** Owner navigation fallback. */
 label:string
 /** Optional explicit query resource field and labels. */
 scope?:{
  /** Query parameter name. */
  name:string
  /** Accessible resource label. */
  label:string
  /** Optional submit button label. */
  submitLabel?:string
 }
 /** Raw owner page. */
 Page:ComponentType
 /** Existing canonical context Provider. */
 Provider:ComponentType<WorkspaceProviderProps<T>>
}
/** Connect a typed owner Provider without importing another feature's implementation.
 * @typeParam T - Owner DTO type; owners retain domain response validation.
 * @param environment - Canonical Host identity, API and router ports.
 * @param definition - Explicit page, Provider, route and optional resource query.
 * @returns One connected route using the current scoped connection.
 * @example
 * import {createCommandWorkspacePages} from '@alneas/eaos-react/workspace-binding/command'
 * export const connect=(...args:Parameters<typeof createCommandWorkspacePages>)=>createCommandWorkspacePages(...args)
 */
export function createCommandWorkspacePages<T>(environment:WorkspaceBindingEnvironment,definition:CommandWorkspacePageDefinition<T>):readonly ConnectedWorkspacePage[]{
 function Body({recordId='state'}:{recordId?:string}){
  const connection=useWorkspaceConnection(environment),identity=connection.identity
  const client=useMemo(()=>createCommandWorkspaceClient<T>(connection,{pluginId:definition.pluginId,recordId,scope:definition.scope?{[definition.scope.name]:recordId}:undefined}),[connection,recordId])
  const {Page,Provider}=definition
  return <Provider tenantId={identity?.tenantId??null} sessionKey={identity?.sessionKey??null} recordId={recordId} client={client}><Page/></Provider>
 }
 function ConnectedCommand(){return definition.scope?<WorkspaceScope environment={environment} name={definition.scope.name} label={definition.scope.label} submitLabel={definition.scope.submitLabel}>{recordId=><Body recordId={recordId}/>}</WorkspaceScope>:<Body/>}
 return [{pluginId:definition.pluginId,path:definition.path,label:definition.label,component:ConnectedCommand}]
}
