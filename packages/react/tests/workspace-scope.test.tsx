import './dom-environment'
import {test,expect} from 'bun:test'
import {act,useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {WorkspaceScope} from '../src/workspace-binding/command'
import {useWorkspaceConnection,type WorkspaceBindingEnvironment} from '../src/workspace-binding'
import {createWorkspaceApi} from '../src/client/workspace-api'

test('explicit query resource changes discard drafts and cancel old connected work',async()=>{
 let search='resourceId=one'
 const signals:AbortSignal[]=[],environment:WorkspaceBindingEnvironment={
  api:createWorkspaceApi({endpoint:'/api/plugins',fetch:(_input,init)=>{if(init?.signal)signals.push(init.signal);return new Promise(()=>{})}}),
  useIdentity:()=>({tenantId:'tenant-a',userId:'user-a',sessionKey:'a',roles:[],enabledPluginIds:['records']}),selectedIds:['records'],
  query:{read:()=>search,replace:value=>{search=value}},
 }
 function Body({id}:{id:string}){
  const connection=useWorkspaceConnection(environment)
  useEffect(()=>{connection.request({pluginId:'records',path:'/items/'+id}).catch(()=>{})},[connection,id])
  return <input aria-label="Draft" defaultValue={id}/>
 }
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container)
 try{
  await act(async()=>root.render(<WorkspaceScope environment={environment} name="resourceId" label="Resource">{id=><Body id={id}/>}</WorkspaceScope>))
  const old=container.querySelector<HTMLInputElement>('[aria-label="Draft"]');if(!old)throw Error('missing draft');old.value='private draft'
  await act(async()=>{const input=container.querySelector<HTMLInputElement>('[name="scope"]'),form=container.querySelector('form');if(!input||!form)throw Error('missing scope');input.value='two';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  expect(signals[0].aborted).toBe(true);expect(signals[1].aborted).toBe(false)
  expect(container.querySelector<HTMLInputElement>('[aria-label="Draft"]')?.value).toBe('two')
  expect(new URLSearchParams(search).get('resourceId')).toBe('two')
 }finally{await act(async()=>root.unmount());container.remove()}
 expect(signals.every(signal=>signal.aborted)).toBe(true)
})
