import {describe,expect,test} from 'bun:test'
import {projectWorkspaceNavigation} from '../src/workspace-application/navigation'
import {resolveWorkspaceState,isPublicAuthPath} from '../src/workspace-application/state'
const session={user:{id:'u1'},loading:false,verified:true,error:null}
const context={tenantId:'t1',userId:'u1',enabledModules:['reports','legacy_key'],pluginAccess:{reports:{allowed:true},legacy_key:{allowed:true}},isSuperAdmin:true,plugins:[{id:'reports',name:'Reports',navigation:{web:{children:[{path:'/reports',label:'Reports'},{path:'/unshipped',label:'Hidden'}]}}},{id:'legacy_key',name:'Legacy',navigation:{web:{children:[{path:'/legacy',label:'Legacy'}]}}}]}
const tenant={context,loading:false,error:null}
const pages=[{pluginId:'reports',path:'/reports'},{pluginId:'legacy_key',path:'/legacy'}]
describe('workspace state',()=>{
 test('only a verified matching current identity is ready',()=>{
  expect(resolveWorkspaceState(session,tenant)).toBe('ready')
  expect(resolveWorkspaceState({...session,loading:true},tenant)).toBe('session-loading')
  expect(resolveWorkspaceState({...session,verified:false},tenant)).toBe('session-loading')
  expect(resolveWorkspaceState({...session,user:null},tenant)).toBe('signed-out')
  expect(resolveWorkspaceState(session,{...tenant,loading:true})).toBe('tenant-loading')
  expect(resolveWorkspaceState(session,{...tenant,error:Error('offline')})).toBe('tenant-error')
  expect(resolveWorkspaceState(session,{...tenant,context:null})).toBe('identity-mismatch')
  expect(resolveWorkspaceState(session,{...tenant,context:{...context,userId:'old'}})).toBe('identity-mismatch')
 })
 test('public auth routes match exactly',()=>{
  for(const path of ['/signup','/recovery','/verification','/callback'])expect(isPublicAuthPath(path)).toBe(true)
  for(const path of ['/signup/private','/callback-extra','/settings/profile'])expect(isPublicAuthPath(path)).toBe(false)
 })
})
describe('workspace navigation projection',()=>{
 test('intersects owner pages and admission, preserves legacy IDs and order',()=>{
  expect(projectWorkspaceNavigation({session,tenant,pages})).toEqual([{title:'Reports',items:[{label:'Reports',path:'/reports',icon:null}]},{title:'Legacy',items:[{label:'Legacy',path:'/legacy',icon:null}]}])
  expect(projectWorkspaceNavigation({session,tenant,pages:[]})).toEqual([])
  expect(projectWorkspaceNavigation({session,tenant:{...tenant,context:{...context,enabledModules:[]}},pages})).toEqual([])
  expect(projectWorkspaceNavigation({session,tenant:{...tenant,context:{...context,pluginAccess:{}}},pages})).toEqual([])
 })
 test('stale/unverified/loading/failed contexts expose no business links',()=>{
  for(const state of [{...tenant,loading:true},{...tenant,error:Error('failure')},{...tenant,context:null},{...tenant,context:{...context,userId:'other'}}])expect(projectWorkspaceNavigation({session,tenant:state,pages})).toEqual([])
  expect(projectWorkspaceNavigation({session:{...session,verified:false},tenant,pages})).toEqual([])
 })
 test('deduplicates supplied navigation and rejects ambiguous ownership',()=>{
  expect(projectWorkspaceNavigation({session,tenant,pages,resolveNavigation:()=>({children:[{path:'/reports',label:'One'},{path:'/reports',label:'Two'},{path:'/legacy',label:'Foreign'}]})})[0]?.items).toEqual([{path:'/reports',label:'One',icon:null}])
  expect(()=>projectWorkspaceNavigation({session,tenant,pages:[...pages,{pluginId:'other',path:'/reports'}]})).toThrow('Multiple plugins')
 })
 test('results do not mutate caller data or each other and updated props are projected',()=>{
  const one=projectWorkspaceNavigation({session,tenant,pages});one[0]!.items[0]!.label='Changed'
  expect(projectWorkspaceNavigation({session,tenant,pages})[0]?.items[0]?.label).toBe('Reports')
  expect(projectWorkspaceNavigation({session,tenant,pages:[pages[1]!]}).map(x=>x.title)).toEqual(['Legacy'])
 })
 test('malformed metadata is fail closed',()=>{
  expect(projectWorkspaceNavigation({session,tenant:{...tenant,context:{...context,plugins:null as any}},pages})).toEqual([])
 })
})
