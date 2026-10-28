import {test,expect} from 'bun:test'
import {memo} from 'react'
import {createWorkspaceApi} from '../src/client/workspace-api'
import {composeWorkspacePages,type WorkspaceBindingEnvironment} from '../src/workspace-binding'

const environment:WorkspaceBindingEnvironment={api:createWorkspaceApi({endpoint:'/api/plugins'}),selectedIds:['records'],useIdentity:()=>null,query:{read:()=>'',replace:()=>{}}}
const Component=()=>null
test('selected workspace composition validates every returned owner, route and label',()=>{
 const declarations=[{pluginId:'records',routes:[{path:'/records',label:'Records'}]}]
 let references:unknown
 const factories={records:(scope:WorkspaceBindingEnvironment)=>{references=scope.referenceCatalog;return [{pluginId:'records',path:'/records',label:'Records',component:memo(Component)}]}}
 const pages=composeWorkspacePages(environment,factories,declarations,{},[{pluginId:'records',listOperation:'list'}])
 expect(pages.map(page=>page.path)).toEqual(['/records']);expect(references).toEqual([{pluginId:'records',listOperation:'list'}])
 for(const wrong of [[],[{pluginId:'foreign',path:'/records',label:'Records',component:Component}],[{pluginId:'records',path:'/extra',label:'Records',component:Component}],[{pluginId:'records',path:'/records',label:'Wrong',component:Component}]])expect(()=>composeWorkspacePages(environment,{records:()=>wrong},declarations,{})).toThrow()
})
test('composition rejects unknown options, duplicate declarations and unadopted factories before invoking them',()=>{
 let calls=0
 const factories={records:()=>{calls++;return [{pluginId:'records',path:'/records',label:'Records',component:Component}]}},declaration={pluginId:'records',routes:[{path:'/records',label:'Records'}]}
 expect(()=>composeWorkspacePages(environment,factories,[declaration,declaration],{})).toThrow()
 expect(()=>composeWorkspacePages({...environment,selectedIds:[]},factories,[declaration],{})).toThrow()
 expect(()=>Reflect.apply(composeWorkspacePages,undefined,[environment,factories,[declaration],{other:{}}])).toThrow()
 expect(calls).toBe(0)
})
