import type { ReactNode } from 'react'
import { Home, Users, UserRound, Building2, FileText, MessageSquare, CircleHelp } from 'lucide-react'
import { Header, type HeaderProps } from '@alneas/appkit-react/tools/header'
import { SmartSidebar, useSidebar, type SmartSidebarGroup } from '@alneas/appkit-react/tools/sidebar'
import { Avatar, AvatarFallback, Button, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from '@alneas/appkit-react/tools/core'
import {UserGuide,coreWorkspaceGuide} from './user-guide'

/**
 * Presentation flags, route overrides and pre-admitted sidebar contributions.
 *
 * @see workspaceNavigation for a complete host integration example.
 */
export interface WorkspaceNavigationOptions {
  /**
 * Show platform-management navigation when true; defaults to false.
 */
  isPlatformAdmin?: boolean
  /**
 * Show tenant user-management navigation when true; defaults to false.
 */
  isTenantAdmin?: boolean
  /**
 * Reserved presentation flag; currently does not affect generated navigation.
 */
  hasTenant?: boolean
  /**
 * Optional overrides for the home, users, account and platform default paths.
 */
  routes?: Partial<Record<'home'|'users'|'account'|'platform',string>>
  /**
 * Host-filtered sidebar groups inserted between workspace and platform groups; never grants access.
 *
 * @remarks
 * Host must filter contributions against current server admission before passing them.
 */
  contributions?: SmartSidebarGroup[]
}
/**
 * Builds generic workspace navigation with optional admin entries and admitted host contributions.
 *
 * Generic navigation only; a visible item never grants server authority.
 * @param options - Role flags, route overrides and filtered contributions; defaults to standard workspace/account links.
 * @returns New sidebar groups; isTenantAdmin adds users and isPlatformAdmin adds platform management.
 *
 * @remarks
 * hasTenant is currently accepted but does not change output. Contributions must be filtered by live host admission. Defaults: home /, users /settings/users, account /settings/profile, platform /settings/tenants.
 *
 * @example
 * ```typescript
 * import { workspaceNavigation } from '@alneas/eaos-react/workspace-layout';
 * const groups = workspaceNavigation({ isTenantAdmin: false, routes: { home: '/workspace' } });
 * ```
 */
export function workspaceNavigation(options:WorkspaceNavigationOptions={}):SmartSidebarGroup[] {
  const routes={home:'/',users:'/settings/users',account:'/settings/profile',platform:'/settings/tenants',...options.routes}
  return [{title:'ワークスペース',items:[
    {label:'テナントトップ',path:routes.home,icon:<Home size={18} />},
    ...(options.isTenantAdmin ? [{label:'ユーザー管理',path:routes.users,icon:<Users size={18} />}] : []),
    {label:'所属・招待',path:routes.account,icon:<UserRound size={18} />},
  ]},...(options.contributions ?? []),...(options.isPlatformAdmin ? [{title:'Platform',items:[{label:'Platform管理',path:routes.platform,icon:<Building2 size={18} />}]}] : [])]
}
/**
 * Shared Header properties with an optional live host chat control.
 *
 * @see workspaceNavigation for a complete host integration example.
 *
 * @remarks
 * Shared defaults backed by the public Appkit React Header.
 */
export interface WorkspaceHeaderProps extends HeaderProps {
  /**
 * Optional connected/open state and host onToggle callback; controls is the controlled pane ID for aria-controls. Disconnected chat is hidden.
 *
 * @remarks
 * Host supplies a currently connected, authorized chat pane. Omitted/disconnected chat stays hidden.
 */
  chat?: {
/**
 * Whether the host chat transport is currently connected.
 */
  connected:boolean;
/**
 * Whether the controlled chat pane is currently visible.
 */
  open:boolean;
/**
 * Host callback to toggle chat visibility; no value is returned.
 */
  onToggle:()=>void;
/**
 * DOM ID of the controlled chat pane.
 */
  controls?:string }
}
/**
 * Opens the bundled workspace guide in an accessible dialog.
 * @returns A help icon trigger and scrollable dialog.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { WorkspaceHelpButton } from '@alneas/eaos-react/workspace-layout';
 * export function Help() { return <WorkspaceHelpButton/>; }
 * ```
 */
export function WorkspaceHelpButton(){return <Dialog><DialogTrigger render={<Button variant="ghost" size="icon" aria-label="ワークスペースのヘルプ"/>}><CircleHelp size={20}/></DialogTrigger><DialogContent style={{maxWidth:'90vw',width:'85ch',maxHeight:'90vh',overflowY:'auto'}}><DialogHeader><DialogTitle>ワークスペースのヘルプ</DialogTitle></DialogHeader><UserGuide document={coreWorkspaceGuide} initiallyOpen/></DialogContent></Dialog>}
/**
 * Composes the shared header with help, a compact mobile title and an optional connected host chat toggle.
 * @param props - Inherited Header props and optional chat; title defaults to EAOS and actions precede chat/help. Without a host logo, a width-limited mobile title preserves space for controls and exposes the full title as a tooltip.
 * @returns A Appkit React Header with composed action controls.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { WorkspaceHeader } from '@alneas/eaos-react/workspace-layout';
 * export function Header() { return <WorkspaceHeader title="Workspace"/>; }
 * ```
 */
export function WorkspaceHeader({chat,actions,title="EAOS",logo,...props}:WorkspaceHeaderProps) {
  const chatButton=chat?.connected ? <Button variant="ghost" size="icon" aria-label="AIチャットを開閉" title="AIチャット" aria-expanded={chat.open} aria-controls={chat.controls} onClick={chat.onToggle}><MessageSquare size={20}/></Button> : null
  const compactTitle=logo || <span className="md:hidden truncate" title={title} style={{maxWidth:'max(2rem, calc(100vw - 20rem))'}}>{title}</span>
  return <Header {...props} title={title} logo={compactTitle} actions={<>{actions}{chatButton}<WorkspaceHelpButton/></>} />
}
/**
 * Renders host navigation and identity controls using the shared collapsible sidebar.
 *
 * Both generated and existing hosts use the same navigation and react-tools sidebar.
 * @param props - Navigation options, optional tenant/user/footer, activePath and host onNavigate/onLogout callbacks.
 * @returns A SmartSidebar; selecting links closes its mobile state before notifying the host.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Requires the Appkit React SidebarProvider. A custom footer replaces the default identity/logout controls; absent tenantName displays Workspace.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { WorkspaceSidebar } from '@alneas/eaos-react/workspace-layout';
 * // Render within the host Appkit React SidebarProvider.
 * export function Sidebar({navigate}: {navigate: (path: string) => void}) { return <WorkspaceSidebar onNavigate={navigate}/>; }
 * ```
 */
export function WorkspaceSidebar({tenantName,activePath,onNavigate,onLogout,user,footer,...options}:WorkspaceNavigationOptions & {
  /**
 * Optional tenant heading; omitted or empty displays Workspace.
 */
  tenantName?:string;
/**
 * Current host router path used for active navigation styling.
 */
  activePath?:string;
/**
 * Host route callback; receives the selected path after mobile sidebar is closed.
 */
  onNavigate:(path:string)=>void;
/**
 * Optional host logout callback; it must clear verified UI state and perform real logout.
 */
  onLogout?:()=>void;
/**
 * Optional Header user presentation data; never used to derive API authority.
 */
  user?:HeaderProps['user'];
/**
 * Optional custom footer replacing the default identity/logout controls.
 */
  footer?:ReactNode
}) {
  const {state,toggleSidebar,setOpenMobile}=useSidebar()
  return <SmartSidebar groups={workspaceNavigation(options).map(group=>({...group,items:group.items.map(item=>({...item,icon:item.icon ?? <FileText size={18} />}))}))} activePath={activePath}
    collapsed={state==='collapsed'} onToggleCollapse={toggleSidebar}
    onNavigate={path=>{setOpenMobile(false);onNavigate(path)}}
    header={collapsed=>collapsed?null:<span>{tenantName || 'Workspace'}</span>}
    sidebarFooter={collapsed=>footer ?? <div className="min-w-0 w-full space-y-2">
      {user&&<Button variant="ghost" aria-label={`ログインユーザー: ${user.name}`} className="w-full justify-start gap-3 px-0" onClick={()=>{setOpenMobile(false);onNavigate(options.routes?.account??'/settings/profile')}}>
        <Avatar className="h-8 w-8 shrink-0"><AvatarFallback>{user.initials||user.name.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
        {!collapsed&&<span className="min-w-0 text-left"><span className="block truncate text-sm font-medium">{user.name}</span><span className="block truncate text-xs text-muted-foreground">{user.email}</span></span>}
      </Button>}
      {onLogout&&<Button variant="outline" className="w-full" aria-label="ログアウト" onClick={onLogout}>{collapsed?'↪':'ログアウト'}</Button>}
    </div>} />
}
