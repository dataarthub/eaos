import type {ComponentType,ReactNode} from 'react'
import type {TenantModuleStore,TenantSnapshot} from '../index'
import type {PluginTenantContext} from '../plugin-gate'
import type {WorkspaceLoginScreenProps} from '../workspace-login'
import type {WorkspaceHeaderProps} from '../workspace-layout'

/** Display session derived from the canonical Appkit auth provider; never server authority.
 * @see WorkspaceApplication
 */
export interface WorkspaceSession {
 /** Current displayed identity; cached identities require separate verification. */
 user:{
  /** Verified identity key once the session is verified. */
  id:string
  /** Optional display name. */
  name?:string
  /** Optional display email. */
  email?:string
 }|null
 /** Whether session initialization is pending. */
 loading:boolean
 /** True only after the current session has been verified by its provider. */
 verified:boolean
 /** Authentication failure, if any. */
 error:Error|null
}
/** Owner-supplied display labels intersected with shipped page registrations.
 * @see WorkspaceApplication
 */
export interface WorkspaceNavigationDefinition {
 /** Optional navigation heading. */
 label?:string
 /** Ordered display links; unregistered paths are omitted. */
 children?:readonly {
  /** Exact registered route path. */
  path:string
  /** Visible link text. */
  label:string
 }[]
}
/** Server-admitted plugin display metadata, without executable components.
 * @see WorkspaceApplication
 */
export interface WorkspacePluginMetadata {
 /** Canonical plugin identifier, including existing legacy keys. */
 id:string
 /** Default navigation heading. */
 name:string
 /** Optional server display navigation. */
 navigation?:{
  /** Optional browser navigation labels. */
  web?:WorkspaceNavigationDefinition
 }
}
/** Authenticated tenant snapshot augmented with workspace display metadata.
 * @see WorkspaceApplication
 */
export interface WorkspaceContext extends PluginTenantContext {
 /** Human-readable workspace name. */
 tenantName?:string
 /** Explicit platform privilege; never inferred from tenant roles. */
 isSuperAdmin?:boolean
 /** Current server-admitted plugins. */
 plugins?:readonly WorkspacePluginMetadata[]
}
/** Build-time registration; actual page components remain router-owned.
 * @see WorkspaceApplication
 */
export interface WorkspacePageRegistration {
 /** Plugin owning the page. */
 pluginId:string
 /** Exact registered route path. */
 path:string
}
/** Fresh navigation projection accepted by the existing workspace sidebar.
 * @see WorkspaceApplication
 */
export interface WorkspaceNavigationGroup {
 /** Group heading. */
 title:string
 /** Ordered unique links, with icons supplied by the canonical shell. */
 items:{
  /** Visible link text. */
  label:string
  /** Registered route destination. */
  path:string
  /** Shell supplies the default icon. */
  icon:null
 }[]
}
/** Inputs to fail-closed navigation projection.
 * @typeParam T - Host tenant display and admission contract.
 * @see WorkspaceApplication
 */
export interface WorkspaceNavigationOptions<T extends WorkspaceContext=WorkspaceContext> {
 /** Current canonical session. */
 session:WorkspaceSession
 /** Current canonical tenant snapshot. */
 tenant:TenantSnapshot<T>
 /** Effective shipped page registrations. */
 pages:readonly WorkspacePageRegistration[]
 /** Owner label resolver; undefined falls back to server navigation. */
 resolveNavigation?:(plugin:WorkspacePluginMetadata)=>WorkspaceNavigationDefinition|undefined
}
/** Slots rendered under the Host's existing auth/theme/sidebar provider frame.
 * @see WorkspaceApplication
 */
export interface WorkspaceFrameProps {
 /** Connected standard header. */
 header:ReactNode
 /** Connected standard sidebar. */
 leftSidebar:ReactNode
 /** Connected lifecycle and content. */
 children:ReactNode
}
/** Standard composition settings; concrete providers and router remain Host-owned.
 * @typeParam T - Host tenant display and admission contract.
 * @see WorkspaceApplication
 */
export interface WorkspaceApplicationProps<T extends WorkspaceContext=WorkspaceContext> {
 /** Stable Host-owned tenant store. */
 store:TenantModuleStore<T>
 /** Stable component mounting existing Appkit providers around all slots. */
 frame:ComponentType<WorkspaceFrameProps>
 /** Current router bindings and descendant outlet. */
 router:{
  /** Current exact location pathname. */
  pathname:string
  /** Host navigation callback. */
  navigate:(path:string)=>void
  /** Existing router outlet. */
  outlet:ReactNode
 }
 /** Effective shipped page registrations. */
 pages:readonly WorkspacePageRegistration[]
 /** Optional owner label resolver. */
 navigation?:Pick<WorkspaceNavigationOptions<T>,'resolveNavigation'>
 /** Authentication presentation; methods/flows remain provider-owned. */
 login?:Omit<WorkspaceLoginScreenProps,'onRegisterClick'>
 /** Header brand overrides. */
 branding?:Pick<WorkspaceHeaderProps,'title'|'logo'>
 /** Exact navigation destinations; defaults match the existing shell. */
 routes?:Partial<Record<'home'|'account'|'platform'|'signup',string>>
 /** Exact public auth paths; defaults to signup, recovery, verification and callback. */
 publicAuthPaths?:readonly string[]
 /** Window refresh events; defaults to focus. */
 refreshEvents?:readonly string[]
 /** Host notice rendered only with a ready matching identity. */
 notice?:ReactNode
 /** Loading presentation override. */
 loading?:ReactNode
 /** Missing/mismatched tenant presentation override. */
 unavailable?:ReactNode
 /** Accessible error renderer with a tenant retry action. */
 renderError?:(error:Error,retry:()=>void)=>ReactNode
}
/** Feature presentation gate; backend authorization remains mandatory.
 * @see WorkspaceApplication
 */
export interface WorkspaceFeatureBoundaryProps {
 /** Explicit registered tenant scope for a private contribution; omission allows the Host's live admission. */
 tenantIds?:readonly string[]
 /** Plugin owning protected children. */
 pluginId:string
 /** Content mounted only after verified admission. */
 children:ReactNode
 /** Loading presentation override. */
 loading?:ReactNode
 /** Denied presentation override. */
 unavailable?:ReactNode
 /** Accessible error renderer with a tenant retry action. */
 renderError?:(error:Error,retry:()=>void)=>ReactNode
}
