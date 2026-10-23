import {createContext,useContext,useRef,useState,useEffect,useMemo,Suspense,Fragment,type ReactElement,type ReactNode} from 'react'
import {useAuth} from '@alneas/appkit-react/tools/auth'
import {TenantModuleProvider,useTenantModule,type TenantModuleStore} from './index'
import {PluginGate} from './plugin-gate'
import {WorkspaceHeader,WorkspaceSidebar} from './workspace-layout'
import {WorkspaceLoginScreen} from './workspace-login'
import {resolveWorkspaceState,isPublicAuthPath} from './workspace-application/state'
import {projectWorkspaceNavigation} from './workspace-application/navigation'
import type {WorkspaceApplicationProps,WorkspaceContext,WorkspaceFeatureBoundaryProps,WorkspaceSession} from './workspace-application/types'
export type * from './workspace-application/types'
export {projectWorkspaceNavigation} from './workspace-application/navigation'
const Settings=createContext<WorkspaceApplicationProps|null>(null)
const defaults={home:'/',account:'/settings/profile',platform:'/settings/tenants',signup:'/signup'}
const loadingDefault=<p role="status">読み込み中…</p>
const unavailableDefault=<p role="status">この機能は現在のワークスペースでは利用できません。</p>
function useSettings(){const value=useContext(Settings);if(!value)throw Error('WorkspaceApplication is required');return value}
function useSession():WorkspaceSession{const auth=useAuth();return {user:auth.user,loading:auth.isLoading,verified:auth.isSessionVerified===true,error:auth.error}}
function Failure({error,retry,renderError}:{error:Error;retry:()=>void;renderError?:WorkspaceFeatureBoundaryProps['renderError']}){
 return renderError?<>{renderError(error,retry)}</>:<div role="alert"><p>{error.message}</p><button type="button" onClick={retry}>再試行</button></div>
}
function Lifecycle(){
 const {store,refreshEvents}=useSettings(),session=useSession(),actions=useContext(Actions)!
 const id=session.verified&&!session.loading&&!session.error?session.user?.id:null
 const eventsKey=JSON.stringify(refreshEvents??['focus'])
 useEffect(()=>{
  store.clear()
  if(!id)return
  void store.refresh()
  const refresh=(event:Event)=>{
   if(event.type==='focus'&&store.getSnapshot().loading)return
   const promise=store.refresh();actions.refresh.current={store,promise}
  }
  const events=JSON.parse(eventsKey) as string[]
  for(const event of new Set(events))window.addEventListener(event,refresh)
  return ()=>{for(const event of new Set(events))window.removeEventListener(event,refresh);store.clear()}
 },[store,id,eventsKey])
 return null
}
type Refresh={store:TenantModuleStore<WorkspaceContext>;promise:Promise<void>}
const Actions=createContext<{pending:{current:symbol|null};refresh:{current:Refresh|null};error:Error|null;setError:(error:Error|null)=>void}|null>(null)
function useLogout(){
 const {store}=useSettings(),auth=useAuth(),actions=useContext(Actions)!
 const mounted=useRef(true),owned=useRef<symbol|null>(null)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(actions.pending.current===owned.current)actions.pending.current=null}},[actions.pending])
 return ()=>{
  if(actions.pending.current)return
  const token=Symbol('logout');owned.current=token;actions.pending.current=token
  store.clear();actions.setError(null)
  void auth.logout().catch(cause=>{if(mounted.current&&actions.pending.current===token)actions.setError(cause instanceof Error?cause:Error('Logout failed'))}).finally(()=>{if(actions.pending.current===token)actions.pending.current=null})
 }
}
function Header(){
 const settings=useSettings(),session=useSession(),logout=useLogout()
 if(!session.user||!session.verified||session.loading)return null
 return <WorkspaceHeader {...settings.branding} user={displayUser(session)} onLogout={logout} userMenuItems={[{label:'プロフィール',href:settings.routes?.account??defaults.account}]}/>
}
function displayUser(session:WorkspaceSession){return {name:session.user?.name||session.user?.email?.split('@')[0]||'ユーザー',email:session.user?.email}}
function Sidebar(){
 const settings=useSettings(),session=useSession(),tenant=useTenantModule<WorkspaceContext>(),logout=useLogout()
 if(!session.user||!session.verified||session.loading)return null
 const ready=resolveWorkspaceState(session,tenant)==='ready'
 const contributions=projectWorkspaceNavigation({session,tenant,pages:settings.pages,...settings.navigation})
 return <WorkspaceSidebar user={displayUser(session)} onLogout={logout} tenantName={ready?tenant.context?.tenantName:undefined} activePath={settings.router.pathname} isPlatformAdmin={ready&&tenant.context?.isSuperAdmin===true} hasTenant={ready} routes={{...defaults,...settings.routes}} contributions={contributions} onNavigate={settings.router.navigate}/>
}
function Content(){
 const props=useSettings(),session=useSession(),tenant=useTenantModule<WorkspaceContext>(),action=useContext(Actions)!,admitted=useRef<{store:typeof props.store;userId:string}|null>(null)
 const state=resolveWorkspaceState(session,tenant),retry=()=>{if(session.error){window.location.reload();return}action.setError(null);void props.store.refresh()}
 if(session.error||action.error)return <Failure error={(action.error??session.error)!} retry={retry} renderError={props.renderError}/>
 if(state==='session-loading')return <>{props.loading??loadingDefault}</>
 if(isPublicAuthPath(props.router.pathname,props.publicAuthPaths))return <>{props.router.outlet}</>
 if(state==='signed-out')return <WorkspaceLoginScreen {...props.login} onRegisterClick={()=>props.router.navigate(props.routes?.signup??defaults.signup)}/>
 if(state==='tenant-loading'){
  if(admitted.current?.store===props.store&&admitted.current.userId===session.user?.id&&action.refresh.current?.store===props.store)throw action.refresh.current.promise
  return <>{props.loading??loadingDefault}</>
 }
 if(state==='tenant-error')return <Failure error={tenant.error!} retry={retry} renderError={props.renderError}/>
 if(state!=='ready')return <>{props.unavailable??unavailableDefault}</>
 admitted.current={store:props.store,userId:session.user!.id}
 return <Fragment key={JSON.stringify([tenant.context!.tenantId,session.user!.id])}>{props.notice}{props.router.outlet}</Fragment>
}
function FrameChildren(){const props=useSettings();return <><Lifecycle/><Suspense fallback={props.loading??loadingDefault}><Content/></Suspense></>}
/**
 * Mounts standard Workspace presentation under a Host-supplied Appkit provider frame.
 * @typeParam T - Host tenant display and admission contract.
 * @param props - Stable tenant store/frame, router bindings, shipped pages and presentation settings.
 * @returns The existing tenant provider and connected workspace UI.
 * @remarks Requires public Appkit 0.2 auth/theme/sidebar providers and its production CSS in frame.
 * Optimistic sessions never admit protected content. This component controls presentation only.
 * @example
 * ```tsx
 * import {WorkspaceApplication, type WorkspaceApplicationProps, type WorkspaceContext} from '@alneas/eaos-react/workspace-application';
 * export function Host(props:WorkspaceApplicationProps<WorkspaceContext>){return <WorkspaceApplication {...props}/>;}
 * ```
 */
export function WorkspaceApplication<T extends WorkspaceContext>(props:WorkspaceApplicationProps<T>):ReactElement {
 const Frame=props.frame
 const lifetime=useMemo(()=>({pending:{current:null as symbol|null},refresh:{current:null as Refresh|null},active:true}),[props.frame,props.store])
 const current=useRef(lifetime);current.current=lifetime
 const [failure,setFailure]=useState<{lifetime:typeof lifetime;error:Error|null}|null>(null)
 useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false}},[lifetime])
 const setError=(error:Error|null)=>{if(lifetime.active&&current.current===lifetime)setFailure({lifetime,error})}
 const error=failure?.lifetime===lifetime?failure.error:null
 return <Settings.Provider value={props as unknown as WorkspaceApplicationProps}><Actions.Provider value={{...lifetime,error,setError}}><TenantModuleProvider store={props.store}><Frame header={<Header/>} leftSidebar={<Sidebar/>}><FrameChildren/></Frame></TenantModuleProvider></Actions.Provider></Settings.Provider>
}
/**
 * Admits a feature only for the verified matching identity and current plugin snapshot.
 * @param props - Plugin ID, protected children and optional state presentation.
 * @returns Protected children through PluginGate, or a loading/error/denied presentation.
 * @remarks Mount below the same auth and tenant providers as WorkspaceApplication. Backend authorization is mandatory.
 * @example
 * ```tsx
 * import {WorkspaceFeatureBoundary} from '@alneas/eaos-react/workspace-application';
 * export function Reports(){return <WorkspaceFeatureBoundary pluginId="reports"><p>Reports</p></WorkspaceFeatureBoundary>;}
 * ```
 */
export function WorkspaceFeatureBoundary(props:WorkspaceFeatureBoundaryProps):ReactElement|null {
 const session=useSession(),tenant=useTenantModule<WorkspaceContext>(),state=resolveWorkspaceState(session,tenant)
 if(session.error||tenant.error)return <Failure error={(session.error??tenant.error)!} retry={()=>void tenant.refetchContext()} renderError={props.renderError}/>
 if(state==='session-loading'||state==='tenant-loading')return <>{props.loading??loadingDefault}</>
 if(state!=='ready'||!tenant.context?.plugins?.some(plugin=>plugin.id===props.pluginId))return <>{props.unavailable??unavailableDefault}</>
 return <PluginGate pluginId={props.pluginId} fallback={props.unavailable??unavailableDefault}>{props.children}</PluginGate>
}
