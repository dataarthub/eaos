import {useMemo} from 'react'
import {useWorkspaceConnection,type WorkspaceBindingEnvironment,type ConnectedWorkspacePage} from '@alneas/eaos-react/workspace-binding'
import type {WorkspaceClient} from '@alneas/eaos-react'
import JournalPage,{WorkspaceProvider} from './journal-workspace'

/** Connect the audit journal workspace to the current verified Host session.
 * @param environment - Explicit adopted features, verified identity and browser API.
 * @returns The journal route, Provider and allowlisted audit operation mapping.
 * @remarks The journal page validates tenant/resource response scope; server authorization remains mandatory.
 * @example
 * import {createWorkspacePages} from '@alneas/eaos-plugins/admin/workspace-binding'
 * import type {WorkspaceBindingEnvironment} from '@alneas/eaos-react/workspace-binding'
 * export const connect=(environment:WorkspaceBindingEnvironment)=>createWorkspacePages(environment)
 */
export function createWorkspacePages(environment:WorkspaceBindingEnvironment):readonly ConnectedWorkspacePage[]{
 function ConnectedJournal(){
  const connection=useWorkspaceConnection(environment),identity=connection.identity
  const client=useMemo<WorkspaceClient>(()=>{
   const execute=async(operation:string,input:Record<string,unknown>)=>{
    if(!['admin_journal_catalog','admin_journal_events','admin_journal_verify'].includes(operation))throw Error('Invalid journal operation')
    return {tenantId:identity?.tenantId??'',recordId:'admin',revision:0,data:await connection.command({pluginId:'admin',operation,input})}
   }
   return {load:()=>execute('admin_journal_catalog',{}),execute}
  },[connection])
  return <WorkspaceProvider tenantId={identity?.tenantId??null} sessionKey={identity?.sessionKey??null} recordId="admin" client={client}><JournalPage/></WorkspaceProvider>
 }
 return [{pluginId:'admin',path:'/plugins/admin',label:'業務画面',component:ConnectedJournal}]
}
