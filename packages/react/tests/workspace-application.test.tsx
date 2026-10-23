import './dom-environment'
import {test,expect,beforeEach,afterEach,spyOn} from 'bun:test'
import * as React from 'react'
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {AuthProvider,type AuthAdapter,type User} from '@alneas/appkit-react/tools/auth'
import {ThemeProvider} from '@alneas/appkit-react/tools/theme'
import {SidebarProvider} from '@alneas/appkit-react/tools/sidebar'
import {createTenantModuleStore} from '../src/index'
import {WorkspaceApplication,WorkspaceFeatureBoundary,type WorkspaceFrameProps} from '../src/workspace-application'
let root:Root,container:HTMLDivElement,identity:User|null,notify:(user:User|null)=>void,logouts:number,loadCount:number,mounts:number
let adapter:AuthAdapter,query:QueryClient
beforeEach(()=>{
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
 identity={id:'u1',email:'tester@example.test'};notify=()=>{};logouts=0;loadCount=0;mounts=0
 adapter={loginWithProvider:async()=>{},getCurrentUser:async()=>identity,login:async()=>identity!,register:async()=>identity!,logout:async()=>{logouts++;identity=null;notify(null)},resetPassword:async()=>{},updateEmail:async()=>{},updatePassword:async()=>{},onAuthStateChanged:fn=>{notify=fn;return()=>{notify=()=>{}}}}
 query=new QueryClient({defaultOptions:{queries:{retry:false}}})
})
afterEach(async()=>{await act(async()=>root.unmount());query.clear();container.remove()})
function Frame({header,leftSidebar,children}:WorkspaceFrameProps){return <QueryClientProvider client={query}><AuthProvider adapter={adapter}><ThemeProvider><SidebarProvider>{header}{leftSidebar}{children}</SidebarProvider></ThemeProvider></AuthProvider></QueryClientProvider>}
const context=(id='u1')=>({tenantId:'t1',userId:id,enabledModules:['reports'],pluginAccess:{reports:{allowed:true}},isSuperAdmin:true,plugins:[{id:'reports',name:'Reports',navigation:{web:{children:[{path:'/reports',label:'Report page'}]}}}]})
function Protected(){React.useEffect(()=>{mounts++},[]);return <input aria-label="Draft" defaultValue="unsaved"/>}
const pages=[{pluginId:'reports',path:'/reports'}]
const render=async(store:any,path='/',frame=Frame)=>{await act(async()=>{root.render(<WorkspaceApplication frame={frame} store={store} pages={pages} router={{pathname:path,navigate:()=>{},outlet:<WorkspaceFeatureBoundary pluginId="reports"><Protected/></WorkspaceFeatureBoundary>}} login={{showEmailLogin:false,socialProviders:[{provider:'google',label:'Googleでサインイン'}]}}/>);await Bun.sleep(40)})}
const settle=async()=>act(async()=>{await Bun.sleep(40)})
test('real provider verifies session before loading context and mounting admitted content',async()=>{
 let resolve!:(value:User|null)=>void;adapter.getCurrentUser=()=>new Promise(r=>resolve=r)
 const store=createTenantModuleStore(async()=>{loadCount++;return context()})
 await render(store);expect(loadCount).toBe(0);expect(mounts).toBe(0)
 await act(async()=>resolve(identity));await settle();expect(loadCount).toBe(1);expect(mounts).toBe(1)
 expect(container.textContent).toContain('Report page');expect(container.textContent).toContain('Platform管理')
 const field=container.querySelector('input[aria-label="Draft"]');await render(store);expect(container.querySelector('input[aria-label="Draft"]')===field).toBe(true);expect(loadCount).toBe(1)
})
test('logout clears pending tenant replies and cannot restore protected children',async()=>{
 let resolve!:(value:ReturnType<typeof context>)=>void
 const store=createTenantModuleStore(()=>new Promise(r=>resolve=r))
 await render(store);await settle();expect(mounts).toBe(0)
 await act(async()=>{identity=null;notify(null)});await settle();await act(async()=>resolve(context()))
 expect(store.getSnapshot().context).toBeNull();expect(mounts).toBe(0)
 expect(container.textContent).toContain('Googleでサインイン');expect(container.querySelector('input[type="email"]')).toBeNull()
})
test('context errors expose retry; mismatch and denied features never mount',async()=>{
 let fail=true;const store=createTenantModuleStore(async()=>{if(fail)throw Error('offline');return context('other')})
 await render(store);await settle();expect(container.querySelector('[role="alert"]')?.textContent).toContain('offline');expect(mounts).toBe(0)
 fail=false;await act(async()=>{(container.querySelector('[role="alert"] button') as HTMLButtonElement).click()});await settle();expect(mounts).toBe(0)
})
test('identity switch and store replacement discard old context and clean up listeners',async()=>{
 const old=createTenantModuleStore(async()=>context());await render(old);await settle();expect(mounts).toBe(1)
 await act(async()=>{identity={id:'u2',email:'other@example.test'};notify(identity)});await settle();expect(container.querySelector('input[aria-label="Draft"]')).toBeNull()
 const fresh=createTenantModuleStore(async()=>context('u2'));await render(fresh);await settle();expect(old.getSnapshot().context).toBeNull();expect(container.querySelector('input[aria-label="Draft"]')).not.toBeNull()
 await act(async()=>root.render(null));expect(fresh.getSnapshot().context).toBeNull()
})
test('exact public paths render existing outlet without loading a tenant when anonymous',async()=>{
 identity=null;const store=createTenantModuleStore(async()=>{loadCount++;return context()})
 await act(async()=>{root.render(<WorkspaceApplication frame={Frame} store={store} pages={[]} router={{pathname:'/signup',navigate:()=>{},outlet:<p>Signup flow</p>}}/>);await Bun.sleep(40)})
 await settle();expect(container.textContent).toContain('Signup flow');expect(loadCount).toBe(0)
})
test('header and sidebar share a single pending logout action',async()=>{
 let finish!:()=>void;adapter.logout=()=>{logouts++;return new Promise<void>(r=>finish=r)}
 const store=createTenantModuleStore(async()=>context());await render(store);await settle()
 const logout=container.querySelector('button[aria-label="ログアウト"]') as HTMLButtonElement
 await act(async()=>{logout.click();logout.click()});expect(logouts).toBe(1);expect(store.getSnapshot().context).toBeNull();expect(container.querySelector('input[aria-label="Draft"]')).toBeNull()
 await act(async()=>{identity=null;notify(null);finish()});await settle();expect(mounts).toBe(1)
})
test('same-user auth refresh preserves forms, revoked features and tenant roles never grant Platform',async()=>{
 const store=createTenantModuleStore(async()=>({...context(),isSuperAdmin:false,roles:['tenant_admin']}))
 await render(store);await settle();const field=container.querySelector('input[aria-label="Draft"]');expect(field).not.toBeNull();expect(container.textContent).not.toContain('Platform管理')
 await act(async()=>notify({...identity!}));await settle();expect(container.querySelector('input[aria-label="Draft"]')===field).toBe(true)
})
test('a failed logout stays closed and retry restarts provider verification',async()=>{
 const reload=spyOn(window.location,'reload').mockImplementation(()=>{})
 adapter.logout=async()=>{throw Error('Sign out unavailable')}
 const store=createTenantModuleStore(async()=>context());await render(store);await settle()
 await act(async()=>{(container.querySelector('button[aria-label="ログアウト"]') as HTMLButtonElement).click();await Bun.sleep(0)})
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('Sign out unavailable');expect(container.querySelector('input[aria-label="Draft"]')).toBeNull()
 await act(async()=>{(container.querySelector('[role="alert"] button') as HTMLButtonElement).click();await Bun.sleep(0)})
 await settle();expect(reload).toHaveBeenCalledTimes(1);reload.mockRestore()
})
test('focus refresh hides pending content but preserves the same admitted form and draft',async()=>{
 let next:(()=>Promise<ReturnType<typeof context>>)|undefined,resolve!:(value:ReturnType<typeof context>)=>void
 const store=createTenantModuleStore(()=>next?next():Promise.resolve(context()))
 await render(store);await settle();const field=container.querySelector('input[aria-label="Draft"]') as HTMLInputElement;field.value='Unsaved focus draft'
 next=()=>new Promise(r=>resolve=r)
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(container.querySelector('input[aria-label="Draft"]')===field).toBe(true)
 expect(field.closest('[style*="display: none"]')).not.toBeNull()
 await act(async()=>resolve(context()));await settle()
 expect(container.querySelector('input[aria-label="Draft"]')===field).toBe(true);expect(field.value).toBe('Unsaved focus draft');expect(mounts).toBe(1)
})
test('session change invalidates an outstanding tenant response even for the same user',async()=>{
 const responses:((value:ReturnType<typeof context>)=>void)[]=[]
 const store=createTenantModuleStore(()=>new Promise(r=>responses.push(r)))
 await act(async()=>{root.render(<WorkspaceApplication frame={Frame} store={store} pages={pages} refreshEvents={['ory:session-changed','focus']} router={{pathname:'/',navigate:()=>{},outlet:<Protected/>}}/>);await Bun.sleep(40)})
 await settle();expect(responses).toHaveLength(1)
 await act(async()=>window.dispatchEvent(new Event('ory:session-changed')))
 expect(responses).toHaveLength(2)
 await act(async()=>responses[1]!({...context(),tenantId:'tenant-B'}));await settle()
 await act(async()=>responses[0]!({...context(),tenantId:'tenant-A'}));expect(store.getSnapshot().context?.tenantId).toBe('tenant-B')
})
test('old pending logout cannot block or contaminate a replacement frame/store',async()=>{
 let reject!:(reason:Error)=>void;adapter.logout=()=>new Promise((_r,j)=>reject=j)
 const old=createTenantModuleStore(async()=>context());await render(old);await settle()
 await act(async()=>{(container.querySelector('button[aria-label="ログアウト"]') as HTMLButtonElement).click()})
 adapter={...adapter,logout:async()=>{logouts++;identity=null;notify(null)}}
 function Replacement(props:WorkspaceFrameProps){return <Frame {...props}/>}
 const fresh=createTenantModuleStore(async()=>context());await render(fresh,'/',Replacement);await settle()
 await act(async()=>reject(Error('Old logout failed')));await settle()
 expect(container.querySelector('[role="alert"]')===null).toBe(true)
 await act(async()=>{(container.querySelector('button[aria-label="ログアウト"]') as HTMLButtonElement).click()});expect(logouts).toBe(1)
})
test('replacing auth provider inside the same frame invalidates the old logout',async()=>{
 let reject!:(reason:Error)=>void;adapter.logout=()=>new Promise((_r,j)=>reject=j)
 const store=createTenantModuleStore(async()=>context());await render(store);await settle()
 await act(async()=>{(container.querySelector('button[aria-label="ログアウト"]') as HTMLButtonElement).click()})
 adapter={...adapter,logout:async()=>{logouts++;identity=null;notify(null)}}
 await render(store);await settle()
 await act(async()=>reject(Error('Obsolete provider failure')));await settle()
 expect(container.querySelector('[role="alert"]')===null).toBe(true)
 await act(async()=>{(container.querySelector('button[aria-label="ログアウト"]') as HTMLButtonElement).click()});expect(logouts).toBe(1)
})

test('registered tenant scope denies foreign UI even when the plugin ID is enabled',async()=>{
 const store=createTenantModuleStore(async()=>context())
 const draw=async(tenantIds:string[])=>{await act(async()=>{root.render(<WorkspaceApplication frame={Frame} store={store} pages={pages} router={{pathname:'/',navigate:()=>{},outlet:<WorkspaceFeatureBoundary pluginId="reports" tenantIds={tenantIds}><Protected/></WorkspaceFeatureBoundary>}}/>);await Bun.sleep(40)});await settle()}
 await draw(['other']);expect(mounts).toBe(0)
 await draw(['t1']);expect(mounts).toBe(1)
 await draw(['other']);expect(container.querySelector('input[aria-label="Draft"]')).toBeNull()
})
