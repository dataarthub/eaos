import './dom-environment'
import {expect,test,afterEach} from 'bun:test'
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {createWorkspaceApi} from '../src/client/workspace-api'
import {useWorkspaceConnection,type WorkspaceBindingEnvironment,type WorkspaceBindingIdentity} from '../src/workspace-binding'

let root:Root|undefined,container:HTMLDivElement|undefined
afterEach(async()=>{await act(async()=>root?.unmount());container?.remove();root=undefined})
const identity=(tenantId='tenant-a'):WorkspaceBindingIdentity=>({tenantId,userId:'user-1',sessionKey:tenantId,roles:['member'],enabledPluginIds:['records']})
async function mount(environment:WorkspaceBindingEnvironment){
 let connection:ReturnType<typeof useWorkspaceConnection>|undefined
 function Page(){connection=useWorkspaceConnection(environment);return <p>{connection.identity?.tenantId}</p>}
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
 const render=async()=>act(async()=>root?.render(<Page/>))
 await render()
 return {render,current:()=>{if(!connection)throw Error('missing connection');return connection}}
}
test('unsafe_suffix_and_unselected_owner_rejected before requests',async()=>{
 let calls=0
 const view=await mount({api:createWorkspaceApi({endpoint:'/api/plugins',fetch:async()=>{calls++;return Response.json({})}}),useIdentity:()=>identity(),selectedIds:['records'],query:{read:()=>'',replace:()=>{}}})
 await expect(view.current().request({pluginId:'other',path:'/'})).rejects.toThrow()
 expect(calls).toBe(0)
})
test('identity_revocation_aborts_pending_requests and ignores fetch which does not abort',async()=>{
 let current:WorkspaceBindingIdentity|null=identity(),finish:(response:Response)=>void=()=>{}
 const view=await mount({api:createWorkspaceApi({endpoint:'/api/plugins',fetch:()=>new Promise(resolve=>{finish=resolve})}),useIdentity:()=>current,selectedIds:['records'],query:{read:()=>'',replace:()=>{}}})
 const previous=view.current(),pending=previous.request({pluginId:'records',path:'/'}).catch(error=>error)
 current=identity('tenant-b');await view.render();expect(previous.signal.aborted).toBe(true)
 finish(Response.json({tenantId:'tenant-a'}));expect(await pending).toBeInstanceOf(Error)
 current={...identity('tenant-b'),enabledPluginIds:[]};const before=view.current();await view.render();expect(before.signal.aborted).toBe(true)
 await expect(view.current().request({pluginId:'records',path:'/'})).rejects.toThrow()
})
test('late_command_reload_is_discarded and unmount closes the connection',async()=>{
 let current:WorkspaceBindingIdentity|null=identity(),finish:(response:Response)=>void=()=>{},calls=0
 const view=await mount({api:createWorkspaceApi({endpoint:'/api/plugins',fetch:()=>{calls++;return new Promise(resolve=>{finish=resolve})}}),useIdentity:()=>current,selectedIds:['records'],query:{read:()=>'',replace:()=>{}}})
 const old=view.current()
 const pending=old.command({pluginId:'records',operation:'save',input:{}}).then(()=>old.request({pluginId:'records',path:'/'})).catch(error=>error)
 current=null;await view.render();finish(Response.json({ok:true}));expect(await pending).toBeInstanceOf(Error);expect(calls).toBe(1)
 const latest=view.current();await act(async()=>root?.unmount());root=undefined;expect(latest.signal.aborted).toBe(true)
})
