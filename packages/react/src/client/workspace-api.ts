import type {BrowserFetch} from './http'
/** Configured browser endpoint; identity and authorization remain server-owned.
 * @see createWorkspaceApi
 */
export interface WorkspaceApiOptions {
 /** Root-relative same-origin path or credential-free HTTPS URL without query/fragment. */
 endpoint:string
 /** Fetch boundary; defaults to the browser implementation. */
 fetch?:BrowserFetch
 /** Current session/CSRF headers, read for each request. */
 headers?:()=>Record<string,string>
 /** Positive request deadline in milliseconds; defaults to 15000. */
 timeoutMs?:number
}
/** JSON request to a plugin-relative REST route. Payload validation belongs to its owner.
 * @see createWorkspaceApi
 */
export interface WorkspaceApiRequest {
 /** Canonical plugin identifier. */
 pluginId:string
 /** Absolute plugin-relative path; encode record IDs as individual segments. */
 path:string
 /** HTTP verb, defaulting to GET. */
 method?:'GET'|'POST'|'PUT'|'PATCH'|'DELETE'
 /** JSON value or multipart FormData; omitted for read requests. */
 body?:unknown
 /** Caller cancellation, combined with the configured deadline. */
 signal?:AbortSignal
}
/** JSON command request with an encoded operation path segment.
 * @see createWorkspaceApi
 */
export interface WorkspaceApiCommand {
 /** Canonical plugin identifier. */
 pluginId:string
 /** Owner-declared command name. */
 operation:string
 /** Owner-validated command input. */
 input:unknown
 /** Caller cancellation. */
 signal?:AbortSignal
}
/** Browser JSON transport; generic result types are caller assertions, not validators.
 * @see createWorkspaceApi
 */
export interface WorkspaceApi {
 /** Perform one REST request without retries or destination fallback.
  * @typeParam T - Caller-asserted DTO type, validated by its owner.
  * @param input - Plugin-relative path, HTTP verb, optional body and cancellation.
  * @returns Parsed JSON; rejects HTTP, JSON, timeout and cancellation failures.
  * @example
  * import {createWorkspaceApi} from '@alneas/eaos-react/client'
  * export const read=()=>createWorkspaceApi({endpoint:'/api/plugins'}).request({pluginId:'reports',path:'/snapshot'})
  */
 request<T=unknown>(input:WorkspaceApiRequest):Promise<T>
 /** POST one command, without retrying uncertain remote effects.
  * @typeParam T - Caller-asserted DTO type, validated by its owner.
  * @param input - Owner operation, JSON input and optional cancellation.
  * @returns Parsed JSON; rejects transport/HTTP/JSON errors and expired requests.
  * @example
  * import {createWorkspaceApi} from '@alneas/eaos-react/client'
  * export const refresh=()=>createWorkspaceApi({endpoint:'/api/plugins'}).command({pluginId:'reports',operation:'refresh',input:{}})
  */
 command<T=unknown>(input:WorkspaceApiCommand):Promise<T>
}
/** Sanitized transport failure; structured status supports owner error presentation.
 * @see createWorkspaceApi
 * @example
 * import {WorkspaceApiError} from '@alneas/eaos-react/client'
 * export const isConflict=(error:unknown)=>error instanceof WorkspaceApiError&&error.status===409
 */
export class WorkspaceApiError extends Error {
 /** HTTP status returned by the destination. */
 readonly status:number
 /** Construct a failure without exposing arbitrary provider response text.
  * @param status - Failed HTTP response status.
  */
 constructor(status:number){super(`Workspace request failed (${status})`);this.name='WorkspaceApiError';this.status=status}
}
function safePath(path:string):void {
 if(!path.startsWith('/')||path.startsWith('//')||/[\\?#\s]/.test(path))throw Error('Invalid workspace path')
 let decoded=decodeURIComponent(path)
 for(let i=0;i<4;i++){
  if(decoded.split('/').some(segment=>segment==='.'||segment==='..')||decoded.includes('\\')||/[\u0000-\u001f\u007f]/u.test(decoded))throw Error('Invalid workspace path')
  const next=decoded.replace(/%(2e|2f|5c|25)/gi,(_,hex:string)=>String.fromCharCode(Number.parseInt(hex,16)))
  if(next===decoded)return
  decoded=next
 }
 throw Error('Excessively encoded workspace path')
}
/** Create a cancellable, credentialed JSON transport for explicit Host plugin routes.
 * @param options - Trusted endpoint, fetch/header adapters and optional bounded deadline.
 * @returns REST and command methods; callers validate the returned DTO.
 * @throws Invalid configuration throws immediately; methods reject unsafe paths, aborts, HTTP or JSON failures.
 * @remarks No retries or fallback. Cancellation discards replies; remote writes may already have committed.
 * @example
 * import {createWorkspaceApi} from '@alneas/eaos-react/client'
 * export const api=createWorkspaceApi({endpoint:'/api/plugins'})
 */
export function createWorkspaceApi(options:WorkspaceApiOptions):WorkspaceApi {
 let endpoint=options.endpoint
 if(endpoint.startsWith('/'))safePath(endpoint)
 else{
  const url=new URL(endpoint)
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid workspace endpoint')
  // Inspect the original path too: URL parsing normalizes dot segments.
  const pathIndex=endpoint.indexOf('/',8)
  safePath(pathIndex<0?'/':endpoint.slice(pathIndex))
  endpoint=url.href
 }
 const timeoutMs=options.timeoutMs??15000
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>2147483647)throw Error('Invalid workspace deadline')
 const fetcher=options.fetch??fetch
 const request=async<T=unknown>(input:WorkspaceApiRequest):Promise<T>=>{
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.pluginId))throw Error('Invalid workspace plugin ID')
  safePath(input.path)
  const method=input.method??'GET'
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)||method==='GET'&&input.body!==undefined)throw Error('Invalid workspace request method/body')
  const multipart=typeof FormData!=='undefined'&&input.body instanceof FormData
  const headers=new Headers(options.headers?.())
  headers.set('Accept','application/json');headers.set('X-EAOS-Request','plugin-command')
  if(multipart)headers.delete('Content-Type');else headers.set('Content-Type','application/json')
  const controller=new AbortController(),abort=()=>controller.abort(input.signal?.reason)
  input.signal?.throwIfAborted();input.signal?.addEventListener('abort',abort,{once:true})
  let rejectAbort:(reason:unknown)=>void=()=>{}
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject})
  const onAbort=()=>rejectAbort(controller.signal.reason)
  controller.signal.addEventListener('abort',onAbort,{once:true})
  const timer=setTimeout(()=>controller.abort(new DOMException('Workspace request deadline exceeded','TimeoutError')),timeoutMs)
  try{
   return await Promise.race([aborted,(async()=>{
   const response=await fetcher(`${endpoint.replace(/\/$/,'')}/${encodeURIComponent(input.pluginId)}${input.path}`,{
    method,credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,
    headers:Object.fromEntries(headers),
    ...(input.body===undefined?{}:{body:multipart?input.body as FormData:JSON.stringify(input.body)}),
   })
   controller.signal.throwIfAborted()
   if(!response.ok)throw new WorkspaceApiError(response.status)
   const value:unknown=await response.json()
   controller.signal.throwIfAborted()
   return value as T
   })()])
  }finally{clearTimeout(timer);input.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort)}
 }
 return {request,command:<T=unknown>(input:WorkspaceApiCommand)=>{
  if(!input.operation||/[\u0000-\u001f\u007f]/u.test(input.operation))return Promise.reject(Error('Invalid workspace operation'))
  return request<T>({pluginId:input.pluginId,path:'/'+encodeURIComponent(input.operation),method:'POST',body:input.input,signal:input.signal})
 }}
}
