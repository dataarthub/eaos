import {Hono,type Context} from 'hono'
import {PluginError} from '../../plugin-data/index'
import {initialPersonName,personKinds,type AccountMembership,type DirectoryPerson,type PersonKind} from './user-directory'

/** Verified provider identity, separate from business directory records.
 * @see createUserDirectoryRoutes
 */
export interface DirectoryIdentity {
 /** Identity bound to the requested authenticated user. */
 userId:string
 /** Current provider memberships; directory records never supply these grants. */
 memberships:readonly AccountMembership[]
 /** Current provider-controlled platform administrator authority. */
 isPlatformAdmin?:boolean
 /** Verified initial display name; never replaced with an email address. */
 displayName?:string
 /** Optional verified contact address, never an account-linking key. */
 email?:string
}
/** Tenant-scoped contact fields; no account roles or identity assignments are writable.
 * @see createUserDirectoryRoutes
 */
export type DirectoryWrite=Partial<Pick<DirectoryPerson,'name'|'email'|'organizationName'|'kinds'>> & {
 /** Optional business department, independent of login authority. */
 department?:string
}
/** Initial account-person registration, after live membership authorization.
 * @see createUserDirectoryRoutes
 */
export interface AccountPersonInput {
 /** Verified current tenant. */
 tenantId:string
 /** Verified provider identity; email must never link another identity. */
 identityId:string
 /** Verified initial name, checked independently from contact address. */
 displayName:unknown
 /** Optional contact address. */
 email?:string
}
/** Persisted account-person result; existing business names are preserved.
 * @see createUserDirectoryRoutes
 */
export interface AccountPersonResult {
 /** Stored business person identifier. */
 id:string
 /** Stored business name. */
 name:string
 /** Whether this invocation created the record. */
 created:boolean
}
/** Business person response, omitting redundant tenant scope from the wire.
 * @see createUserDirectoryRoutes
 */
export type DirectoryEntry=Omit<DirectoryPerson,'tenantId'> & {
 /** Optional business department. */
 department?:string
}
/** Trusted persistence port. Every operation must enforce its explicit tenant scope.
 * @see createUserDirectoryRoutes
 */
export interface DirectoryRepository {
 /** Register idempotently by tenant/identity, never email; preserve existing names.
  * @param input - Verified tenant, identity and initial person fields.
  * @returns Persisted person and whether it was created.
  * @example
  * import type {DirectoryRepository,AccountPersonInput} from '@alneas/eaos-server/platform'
  * export const ensure=(repo:DirectoryRepository,input:AccountPersonInput)=>repo.ensureAccount(input)
  */
 ensureAccount(input:AccountPersonInput):Promise<AccountPersonResult>
 /** Return at most 500 people, ordered by stored name and ID.
  * @param tenantId - Verified tenant to query.
  * @returns Scoped business people in stable name/ID order.
  * @example
  * import type {DirectoryRepository} from '@alneas/eaos-server/platform'
  * export const people=(repo:DirectoryRepository)=>repo.list('tenant-one')
  */
 list(tenantId:string):Promise<readonly DirectoryEntry[]>
 /** Create a contact without identity or membership authority.
  * @param tenantId - Verified tenant receiving the contact.
  * @param input - Explicit validated business contact fields.
  * @returns Created contact identity and stored name.
  * @example
  * import type {DirectoryRepository} from '@alneas/eaos-server/platform'
  * export const contact=(repo:DirectoryRepository)=>repo.create('tenant-one',{name:'Partner contact',kinds:['partner_contact']})
  */
 create(tenantId:string,input:DirectoryWrite & {
  /** Explicit initial business name, independent of the administrator's profile. */
  name:string;
  /** Validated business relationship categories, independent of account roles. */
  kinds:readonly PersonKind[]
 }):Promise<AccountPersonResult>
 /** Update allowlisted contact fields; false means missing in this tenant.
  * @param tenantId - Verified tenant owning the record.
  * @param id - Business contact identifier.
  * @param input - Validated mutable contact fields.
  * @returns Whether the scoped record was updated.
  * @example
  * import type {DirectoryRepository} from '@alneas/eaos-server/platform'
  * export const rename=(repo:DirectoryRepository)=>repo.update('tenant-one','person-one',{name:'Updated name'})
  */
 update(tenantId:string,id:string,input:DirectoryWrite):Promise<boolean>
}
/** Host-owned identity, repository and origin connections for common directory routes.
 * @see createUserDirectoryRoutes
 */
export interface UserDirectoryRouteOptions {
 /** Explicit feature opt-in; false disables all directory routes. */
 enabled:boolean
 /** Only explicit provider-owned memberships enable registration. */
 membershipSource:'legacy-adb'|'kratos'
 /** Allowed browser origins; absent Origin still requires the custom request header. */
 origins?:readonly string[]
 /** Read and normalize the current provider identity without using directory rows.
  * @param userId - Verified provider identity identifier.
  * @returns Current normalized identity; reject inactive/unavailable identities.
  * @example
  * import type {UserDirectoryRouteOptions} from '@alneas/eaos-server/platform'
  * export const current=(ports:UserDirectoryRouteOptions)=>ports.readIdentity('verified-user')
  */
 readIdentity(userId:string):Promise<DirectoryIdentity>
 /** Select the trusted current tenant's persistence adapter.
  * @param tenantId - Verified tenant whose connection must be bound.
  * @returns Repository enforcing every explicit tenant argument.
  * @example
  * import type {UserDirectoryRouteOptions} from '@alneas/eaos-server/platform'
  * export const repository=(ports:UserDirectoryRouteOptions)=>ports.resolveRepository('tenant-one')
  */
 resolveRepository(tenantId:string):Promise<DirectoryRepository>
}
type Variables={userId:string;tenantId:string;workspaceContext:{isSuperAdmin?:boolean};directoryIdentity:DirectoryIdentity}
/** Create common person registration and directory routes over injected persistence.
 * @param options - Explicit provider mode, current identity reader, tenant repository selector and browser origins.
 * @returns Routes for POST /person/ensure and GET/POST/PATCH /directory.
 * @throws Construction retains ports without accessing providers or databases; request failures return bounded HTTP errors.
 * @remarks Mount behind trusted userId/tenantId middleware. Reads require current membership or provider platform administration; writes require current administrator authority and the user-directory request header. Person categories never grant access.
 * @example
 * import {createUserDirectoryRoutes,type UserDirectoryRouteOptions} from '@alneas/eaos-server/platform'
 * export const directory=(ports:UserDirectoryRouteOptions)=>createUserDirectoryRoutes(ports)
 */
export function createUserDirectoryRoutes(options:UserDirectoryRouteOptions){
 const router=new Hono<{Variables:Variables}>()
 router.onError((error,c)=>error instanceof PluginError?c.json({error:error.message},error.status):c.json({error:'User directory unavailable'},503))
 const available=()=>{if(!options.enabled||options.membershipSource!=='kratos')throw new PluginError(409,'User directory unavailable')}
 const origin=(header:string|undefined,requestHeader:string|undefined)=>{if(requestHeader!=='user-directory'||header&&!(options.origins??[]).includes(header))throw new PluginError(403,'Request origin unavailable')}
 const identity=async(userId:string|undefined,tenantId:string|undefined)=>{
  if(!userId||!tenantId||userId.startsWith('api-key:'))throw new PluginError(403,'Account membership required')
  const value=await options.readIdentity(userId)
  if(value.userId!==userId)throw Error('Identity binding differs')
  return value
 }
 router.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
 router.post('/person/ensure',async c=>{
  available();origin(c.req.header('Origin'),c.req.header('X-EAOS-Request'))
  const userId=c.get('userId'),tenantId=c.get('tenantId'),current=await identity(userId,tenantId)
  if(!current.memberships.some(member=>member.tenantId===tenantId&&member.active)){
   if(c.get('workspaceContext')?.isSuperAdmin)return c.json({skipped:true})
   throw new PluginError(403,'Account membership required')
  }
  if(!current.displayName?.trim())throw new PluginError(422,'Display name required')
  return c.json(await (await options.resolveRepository(tenantId)).ensureAccount({tenantId,identityId:userId,displayName:current.displayName,email:current.email}))
 })
 router.use('/directory*',async(c,next)=>{
  available();const tenantId=c.get('tenantId'),current=await identity(c.get('userId'),tenantId)
  const member=current.memberships.find(value=>value.tenantId===tenantId&&value.active)
  if(!member&&!current.isPlatformAdmin)throw new PluginError(403,'Account membership required')
  if(c.req.method!=='GET'){
   origin(c.req.header('Origin'),c.req.header('X-EAOS-Request'))
   if(!current.isPlatformAdmin&&!['admin','tenant_admin'].includes(member?.role??''))throw new PluginError(403,'Directory administrator required')
  }
  await next()
 })
 router.get('/directory',async c=>c.json({people:await (await options.resolveRepository(c.get('tenantId'))).list(c.get('tenantId')),limit:500}))
 const parse=async(c:Context<{Variables:Variables}>,partial:boolean):Promise<DirectoryWrite>=>{
  if(!c.req.header('Content-Type')?.startsWith('application/json'))throw new PluginError(400,'Invalid person')
  const text=await c.req.text();if(text.length>4096)throw new PluginError(400,'Invalid person')
  let data:any;try{data=JSON.parse(text)}catch{throw new PluginError(400,'Invalid person')}
  if(!data||typeof data!=='object'||Array.isArray(data)||partial&&!Object.keys(data).length||Object.keys(data).some(key=>!['name','email','organizationName','kinds','department'].includes(key)))throw new PluginError(400,'Invalid person')
  if(!partial||data.name!==undefined){try{data.name=initialPersonName(data.name,undefined)}catch{throw new PluginError(400,'Person name required')}}
  if(!partial&&data.kinds===undefined)data.kinds=['other']
  if(data.kinds!==undefined&&(!Array.isArray(data.kinds)||!data.kinds.length||new Set(data.kinds).size!==data.kinds.length||data.kinds.some((kind:any)=>!personKinds.includes(kind))))throw new PluginError(400,'Invalid person kind')
  for(const key of ['email','organizationName','department'])if(data[key]!==undefined&&(typeof data[key]!=='string'||data[key].length>(key==='organizationName'?4000:200)))throw new PluginError(400,'Invalid person')
  if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw new PluginError(400,'Invalid email')
  return data
 }
 router.post('/directory',async c=>{const data=await parse(c,false);return c.json(await (await options.resolveRepository(c.get('tenantId'))).create(c.get('tenantId'),data as DirectoryWrite&{name:string;kinds:readonly PersonKind[]}),201)})
 router.patch('/directory/:id',async c=>{
  const id=c.req.param('id');if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new PluginError(400,'Invalid person')
  const data=await parse(c,true),changed=await (await options.resolveRepository(c.get('tenantId'))).update(c.get('tenantId'),id,data)
  return changed?c.json({saved:true}):c.json({error:'Person unavailable'},404)
 })
 return router
}
/** Normalize provider display-name traits without inventing a name from an email.
 * @param traits - Verified provider traits with either string name or first/last name fields.
 * @returns The supplied name, joined first/last name, or undefined when absent.
 * @example
 * import {accountDisplayName} from '@alneas/eaos-server/platform'
 * const name=accountDisplayName({name:{first:'Ada',last:'Lovelace'}})
 */
export function accountDisplayName(traits:Record<string,unknown>={}):string|undefined{
 if(typeof traits.name==='string')return traits.name
 if(traits.name&&typeof traits.name==='object'){const name=traits.name as Record<string,unknown>;return [name.first,name.last].filter((part):part is string=>typeof part==='string').join(' ').trim()||undefined}
 return undefined
}
