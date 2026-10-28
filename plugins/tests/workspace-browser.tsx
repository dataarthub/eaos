import '../../packages/react/tests/dom-environment'
import {act,type ComponentType} from 'react'
import {createRoot} from 'react-dom/client'
import {createWorkspaceApi} from '@alneas/eaos-react/client'
import type {WorkspaceBindingEnvironment,WorkspaceBindingIdentity} from '@alneas/eaos-react/workspace-binding'

export function connection(pluginId:string,request:typeof fetch){
 let identity:WorkspaceBindingIdentity|null={tenantId:'tenant-a',userId:'user-a',sessionKey:'session-a',roles:['member'],enabledPluginIds:[pluginId]}
 const environment:WorkspaceBindingEnvironment={api:createWorkspaceApi({endpoint:'/api/plugins',fetch:request}),selectedIds:[pluginId],useIdentity:()=>identity,query:{read:()=>'',replace:()=>{}}}
 return {environment,replace(next:WorkspaceBindingIdentity|null){identity=next}}
}
export async function mount(Page:ComponentType){
 const container=document.createElement('div');document.body.appendChild(container)
 const root=createRoot(container)
 const settle=()=>act(async()=>{await Bun.sleep(15)})
 const render=()=>act(async()=>{root.render(<Page/>)})
 await render();await settle()
 return {container,settle,render,async close(){await act(async()=>root.unmount());container.remove()}}
}
export async function submit(form:HTMLFormElement){await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await Bun.sleep(15)})}
export async function interact(action:()=>void){await act(async()=>{action();await Bun.sleep(15)})}
export function requiredForm(element:Element|null):HTMLFormElement{if(!(element instanceof HTMLFormElement))throw Error('Expected rendered form');return element}
