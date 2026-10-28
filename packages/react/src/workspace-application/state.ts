import type {TenantSnapshot} from '../index'
import type {WorkspaceContext,WorkspaceSession} from './types'
export function resolveWorkspaceState(session:WorkspaceSession,tenant:TenantSnapshot<WorkspaceContext>) {
 if(session.loading)return 'session-loading'
 if(!session.user)return 'signed-out'
 if(!session.verified)return 'session-loading'
 if(tenant.loading)return 'tenant-loading'
 if(session.error||tenant.error)return 'tenant-error'
 if(!tenant.context?.tenantId||tenant.context.userId!==session.user.id)return 'identity-mismatch'
 return 'ready'
}
const authPaths=['/signup','/recovery','/verification','/callback']
export function isPublicAuthPath(path:string,paths:readonly string[]=authPaths){return paths.includes(path)}
