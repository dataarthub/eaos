import {test,expect} from 'bun:test'
import {createWorkspaceApi} from '../src/client/workspace-api'
import type {WorkspaceConnection} from '../src/workspace-binding'
import {createRecordWorkspaceClient,createRecordReferenceClient} from '../src/workspace-binding/record'
import {createCommandWorkspaceClient} from '../src/workspace-binding/command'

test('record adapters preserve declared inputs and deny undeclared reference commands',async()=>{
 const operations:string[]=[],api=createWorkspaceApi({endpoint:'/api/plugins',fetch:async(url)=>{operations.push(String(url));return Response.json({tenantId:'tenant-a',rows:[]})}})
 const connection:WorkspaceConnection={...api,identity:{tenantId:'tenant-a',userId:'user-a',sessionKey:'a',roles:[],enabledPluginIds:['records']},signal:new AbortController().signal}
 const definition={pluginId:'records',listOperation:'list',loadInput:{}}
 expect(await createRecordWorkspaceClient(connection,definition).load()).toMatchObject({tenantId:'tenant-a',recordId:'records',revision:0})
 const reference=createRecordReferenceClient(connection,[definition],{field:'related',title:'Related',pluginId:'records',listOperation:'list',listKey:'rows',displayFields:['title']})
 await expect(reference.execute('delete',{})).rejects.toThrow();expect(operations).toHaveLength(1)
})
test('command adapter pins an explicit resource scope through write and reload',async()=>{
 const calls:unknown[]=[],api=createWorkspaceApi({endpoint:'/api/plugins',fetch:async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json({tenantId:'tenant-a',recordId:'one',revision:4,data:{tenantId:'tenant-a'}})}})
 const connection:WorkspaceConnection={...api,identity:{tenantId:'tenant-a',userId:'user-a',sessionKey:'a',roles:[],enabledPluginIds:['records']},signal:new AbortController().signal}
 const client=createCommandWorkspaceClient(connection,{pluginId:'records',recordId:'one',scope:{resourceId:'one'}})
 expect(await client.execute('save',{revision:3,resourceId:'other'})).toMatchObject({recordId:'one',revision:4})
 expect(calls).toEqual([{revision:3,resourceId:'one'},{resourceId:'one'}])
})
