import {useMemo} from 'react'
import {createAjvValidator} from '@alneas/appkit-core/data/schema/core'
import {getPlatformNamespaceDocumentContracts} from '@alneas/eaos-core/contracts/platform-records'
import {useWorkspaceConnection,type WorkspaceBindingEnvironment,type ConnectedWorkspacePage} from '@alneas/eaos-react/workspace-binding'
import type {WorkspaceClient} from '@alneas/eaos-react'
import {ApprovalPage,ApprovalProvider,type ApprovalList} from './workspace'

const document=getPlatformNamespaceDocumentContracts('platform-records','approval')[0]
const schema={type:'array',items:{type:'object',properties:{id:{type:'string',minLength:1},revision:{type:'integer',minimum:1},value:document.schema},required:['id','revision','value'],additionalProperties:true}}
const validate=createAjvValidator({draft:'2020-12'})
function isRequests(value:unknown):value is ApprovalList['requests']{return validate(schema,value).valid}

/** Connect the approval workspace to verified Host browser capabilities.
 * @param environment - Canonical identity hook, explicit adoption and API transport.
 * @returns The approval route with its Provider and REST command mapping.
 * @remarks Backend membership, resource authorization and revision checks remain mandatory.
 * @example
 * import {createWorkspacePages} from '@alneas/eaos-plugins/approval/workspace-binding'
 * import type {WorkspaceBindingEnvironment} from '@alneas/eaos-react/workspace-binding'
 * export const connect=(environment:WorkspaceBindingEnvironment)=>createWorkspacePages(environment)
 */
export function createWorkspacePages(environment:WorkspaceBindingEnvironment):readonly ConnectedWorkspacePage[]{
 function ConnectedApproval(){
  const connection=useWorkspaceConnection(environment),identity=connection.identity
  const client=useMemo<WorkspaceClient<ApprovalList>>(()=>{
   const load=async()=>{
    const requests=await connection.request({pluginId:'approval',path:'/requests'})
    if(!isRequests(requests))throw Error('Invalid approval response')
    return {tenantId:identity?.tenantId??'',recordId:'requests',revision:0,data:{requests}}
   }
   return {load,execute:async(operation,input)=>{
    const {id,...body}=input
    let path:string
    if(operation==='submit')path='/requests'
    else if((operation==='decide'||operation==='withdraw')&&typeof id==='string'&&id)path='/requests/'+encodeURIComponent(id)+(operation==='decide'?'/decisions':'/withdraw')
    else throw Error('Invalid approval operation')
    await connection.request({pluginId:'approval',path,method:'POST',body})
    return load()
   }}
  },[connection])
  return <ApprovalProvider tenantId={identity?.tenantId??null} sessionKey={identity?.sessionKey??null} recordId="requests" client={client}><ApprovalPage/></ApprovalProvider>
 }
 return [{pluginId:'approval',path:'/plugins/approval/workspace',label:'業務画面',component:ConnectedApproval}]
}
