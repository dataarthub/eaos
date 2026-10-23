import {test,expect} from 'bun:test'
import {Hono} from 'hono'
import type {PluginManifest} from '@alneas/eaos-core'
import {createStandardHostPolicy} from './policy'
const manifest=(id:string)=>({id,name:id,version:'0.1.0',api:{prefix:'/api/'+id},entitlement:{tier:'public'},schema:{},mcp:{tools:[]}} as PluginManifest)
test('explicit empty and narrow adoption excludes static and supplied executable bindings',()=>{
 const manifests=[manifest('a'),manifest('b')],routes={a:()=>new Hono(),b:()=>new Hono()}
 const empty=createStandardHostPolicy({manifests,routeFactories:routes,mcpPluginIds:['a','b'],pluginIds:[],loadEnabledModules:async()=>['all']})
 expect(empty.manifests).toEqual([])
 const selected=createStandardHostPolicy({manifests,routeFactories:routes,pluginIds:['b'],loadEnabledModules:async()=>['all']})
 expect(selected.manifests.map(m=>m.id)).toEqual(['b']);expect(selected.enabledPluginIds(['all'])).toEqual(['b'])
 expect(createStandardHostPolicy({manifests,loadEnabledModules:async()=>[]}).manifests[0].createRoutes).toBeUndefined()
})
test('invalid identities and competing extension ownership reject before constructing routes',()=>{
 let calls=0;const factory=()=>{calls++;return new Hono()};const base={manifests:[manifest('a')],loadEnabledModules:async()=>[]}
 expect(()=>createStandardHostPolicy({...base,pluginIds:['a','a']})).toThrow()
 expect(()=>createStandardHostPolicy({...base,pluginIds:['unknown']})).toThrow()
 expect(()=>createStandardHostPolicy({...base,manifests:[manifest('a'),manifest('a')]})).toThrow()
 expect(()=>createStandardHostPolicy({...base,routeFactories:{unknown:factory}})).toThrow()
 expect(()=>createStandardHostPolicy({...base,extensions:[{apiVersion:1,id:'private',tenantIds:['tenant'],manifests:[manifest('a')],routeFactories:{a:factory}}]})).toThrow()
 expect(calls).toBe(0)
})
test('policy snapshots caller metadata without freezing their arrays or implementations',()=>{
 const manifests=[manifest('a')],pluginIds=['a'],aliases={a:['legacy']},tenantIds=['tenant']
 const extensions=[{apiVersion:1 as const,id:'private',tenantIds,manifests:[manifest('c')],routeFactories:{c:()=>new Hono()}}]
 const policy=createStandardHostPolicy({manifests,pluginIds,extensions,moduleAliases:aliases,loadEnabledModules:async()=>[]})
 pluginIds.push('c');manifests[0].id='changed';aliases.a.push('forged');tenantIds.push('foreign')
 expect(policy.manifests.map(m=>m.id)).toEqual(['a']);expect(policy.enabledPluginIds(['forged'])).toEqual([])
 expect(Object.isFrozen(tenantIds)).toBe(false)
})
