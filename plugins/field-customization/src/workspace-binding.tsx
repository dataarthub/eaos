import {useMemo,useState} from 'react'
import {createAjvValidator} from '@alneas/appkit-core/data/schema/core'
import {getPlatformNamespaceDocumentContracts} from '@alneas/eaos-core/contracts/platform-records'
import {useWorkspaceConnection,type WorkspaceBindingEnvironment,type ConnectedWorkspacePage} from '@alneas/eaos-react/workspace-binding'
import type {WorkspaceClient} from '@alneas/eaos-react'
import {FieldCustomizationPage,FieldCustomizationProvider,type FieldWorkspaceData} from './workspace'

const document=getPlatformNamespaceDocumentContracts('platform-records','field_customization')[0]
const properties=typeof document.schema.properties==='object'&&document.schema.properties!==null?document.schema.properties:{}
const schema={type:'object',properties:{...properties,id:{type:'string'},revision:{type:'integer',minimum:0},schema:{type:'object',properties:{type:{type:'string'},properties:{type:'object'},required:{type:'array',items:{type:'string'}}},required:['properties'],additionalProperties:true}},required:['id','revision','schema','fields'],additionalProperties:false}
const validate=createAjvValidator({draft:'2020-12'})
function isFieldData(value:unknown):value is FieldWorkspaceData{return validate(schema,value).valid}

/** Explicit adopter resource catalog; the public feature owns no business defaults.
 * @see createWorkspacePages
 */
export interface FieldCustomizationWorkspaceOptions {
 /** Nonempty allowed resource IDs and user-facing labels. */
 resources:readonly {
  /** Server-authorized resource identity. */
  id:string
  /** Visible resource label. */
  label:string
 }[]
}
/** Connect the field editor to an explicit allowed resource catalog.
 * @param environment - Canonical verified identity and scoped browser transport.
 * @param options - Nonempty adopter-owned resource catalog; duplicate IDs are rejected.
 * @returns A connected field editor route with revision-preserving PUT requests.
 * @throws Missing/invalid resource catalogs fail at composition.
 * @example
 * import {createWorkspacePages} from '@alneas/eaos-plugins/field-customization/workspace-binding'
 * import type {WorkspaceBindingEnvironment} from '@alneas/eaos-react/workspace-binding'
 * export const connect=(environment:WorkspaceBindingEnvironment)=>createWorkspacePages(environment,{resources:[{id:'reports',label:'Reports'}]})
 */
export function createWorkspacePages(environment:WorkspaceBindingEnvironment,options:FieldCustomizationWorkspaceOptions):readonly ConnectedWorkspacePage[]{
 if(!options?.resources.length||options.resources.some(item=>!item.id||!item.label)||new Set(options.resources.map(item=>item.id)).size!==options.resources.length)throw Error('Explicit field resources required')
 const resources=options.resources.map(item=>({...item}))
 function ConnectedFields(){
  const connection=useWorkspaceConnection(environment),identity=connection.identity,[resource,setResource]=useState(resources[0].id)
  const client=useMemo<WorkspaceClient<FieldWorkspaceData>>(()=>{
   const path='/resources/'+encodeURIComponent(resource)
   const wrap=(data:unknown)=>{if(!isFieldData(data)||data.id!==resource)throw Error('Invalid field resource response');return {tenantId:identity?.tenantId??'',recordId:resource,revision:data.revision,data}}
   return {load:async()=>wrap(await connection.request({pluginId:'field-customization',path})),execute:async(operation,input)=>{
    if(operation!=='write')throw Error('Invalid field operation')
    return wrap(await connection.request({pluginId:'field-customization',path,method:'PUT',body:input}))
   }}
  },[connection,resource])
  return <><label>対象<select aria-label="対象リソース" value={resource} onChange={event=>{if(resources.some(item=>item.id===event.target.value))setResource(event.target.value)}}>{resources.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><FieldCustomizationProvider tenantId={identity?.tenantId??null} sessionKey={identity?.sessionKey??null} recordId={resource} client={client}><FieldCustomizationPage/></FieldCustomizationProvider></>
 }
 return [{pluginId:'field-customization',path:'/plugins/field-customization/workspace',label:'業務画面',component:ConnectedFields}]
}
