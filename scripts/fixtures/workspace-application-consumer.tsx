import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {AuthProvider,type AuthAdapter,type User} from '@alneas/appkit-react/tools/auth'
import {ThemeProvider} from '@alneas/appkit-react/tools/theme'
import {SidebarProvider,SidebarPrimitive} from '@alneas/appkit-react/tools/sidebar'
import {Layout} from '@alneas/appkit-react/ui'
import './application-base.css'
import {WorkspaceApplication,WorkspaceFeatureBoundary,type WorkspaceFrameProps,type WorkspaceContext} from '@alneas/eaos-react/workspace-application'
import {createTenantModuleStore} from '@alneas/eaos-react'
const config=new URLSearchParams(location.search),query=new QueryClient({defaultOptions:{queries:{retry:false}}})
const current=async():Promise<User|null>=>{const response=await fetch('/fixture/session');if(!response.ok)throw Error('Session unavailable');return response.json()}
const signIn=async()=>{const user=await current();if(!user)throw Error('No fixture session');return user}
const adapter:AuthAdapter={getCurrentUser:current,login:signIn,register:signIn,logout:async()=>{await fetch('/fixture/logout',{method:'POST'});window.dispatchEvent(new Event('fixture-session'))},resetPassword:async()=>{},updateEmail:async()=>{},updatePassword:async()=>{},loginWithProvider:current,onAuthStateChanged:callback=>{let active=true;const changed=()=>{void current().then(user=>{if(active)callback(user)})};window.addEventListener('fixture-session',changed);return()=>{active=false;window.removeEventListener('fixture-session',changed)}}}
const store=createTenantModuleStore<WorkspaceContext>(async signal=>{const response=await fetch('/fixture/context',{signal});if(!response.ok)throw Error('Workspace unavailable');return response.json()})
function Frame(props:WorkspaceFrameProps){return <QueryClientProvider client={query}><AuthProvider adapter={adapter}><ThemeProvider defaultTheme={config.get('mode') as 'light'|'dark'} defaultColorTheme={config.get('palette')!}><SidebarProvider><Layout {...props} leftSidebar={props.leftSidebar?<SidebarPrimitive collapsible="icon">{props.leftSidebar}</SidebarPrimitive>:null}/></SidebarProvider></ThemeProvider></AuthProvider></QueryClientProvider>}
function Application(){const [pathname,setPath]=React.useState('/');return <WorkspaceApplication frame={Frame} store={store} pages={[{pluginId:'reports',path:'/reports'}]} router={{pathname,navigate:setPath,outlet:pathname==='/signup'?<h1>Signup flow</h1>:<WorkspaceFeatureBoundary pluginId="reports"><section aria-label="Report editor" className="p-6"><h1>Report editor</h1><label>Draft<input className="border" aria-label="Draft" defaultValue="Unsaved"/></label></section></WorkspaceFeatureBoundary>}} login={{showEmailLogin:false,socialProviders:[{provider:'google',label:'Googleでサインイン'}]}}/>}
createRoot(document.getElementById('root')!).render(<Application/>)
