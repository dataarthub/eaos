import {Database} from 'bun:sqlite'
import {AsyncLocalStorage} from 'node:async_hooks'
import {Hono,type Context} from 'hono'
import type {PluginManifest} from '@alneas/eaos-core'
import {PluginEntitlementRuntime} from '../entitlements'
import {createAtomicRepository,createSqliteAtomicDriver} from '../plugin-data'
import type {LifecycleRuntime} from '../lifecycle'
import type {StandardHostOptions} from './types'
export const fixtureManifest=(id:string):PluginManifest=>({id,name:id,version:'0.1.0',description:'',icon:'',category:'general',targets:['web'],dependencies:[],tier:'free',industries:[],contracts:[],subscribes:[],publishes:[],navigation:{},schema:{storagePolicy:{maxPayloadBytes:4194304,objectStorage:'optional',historyRetentionDays:null,archive:{mode:'none'}},ownedTables:[],externalReferences:{},migrationOrder:0},api:{prefix:'/api/'+id},entitlement:{tier:'public'}})
export function hostFixture(){
 const db=new Database(':memory:');db.exec('CREATE TABLE usage(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 const scope=new AsyncLocalStorage<Context>();let active=true,member=true;const order:string[]=[]
 const store={readTenant:async()=>({tenantName:'Fixture'}),readMembership:async()=>member?{role:'admin'}:undefined}
 const lifecycle={backendId:'fixture',resolveTenant:async(c:Context)=>c.get('tenantId')??null,lifecycle:{isEnabled:async()=>active}} as LifecycleRuntime
 const options:StandardHostOptions={
  app:{name:'fixture',releaseVersion:'fixture-v1',authSkipPaths:['/health','/metrics','/api/health']},
  adoption:{manifests:[fixtureManifest('a')],routeFactories:{a:()=>new Hono().get('/',c=>{order.push('handler');return c.json({tenant:c.get('tenantId')})}).get('/nested',c=>c.text('nested'))}},
  auth:{verifier:{verifySession:async header=>{order.push('auth');return header==='Bearer valid'?{valid:true,tenantId:'tenant',userId:'user'}:{valid:false}}},membership:async(c,next)=>{if(c.get('userId')){order.push('membership:'+c.res.headers.get('X-EAOS-Release'));c.set('workspaceContext',{tenantId:'tenant',userId:'user',roles:['admin']})}await next()}},
  admission:{store:()=>store,loadEnabledModules:async()=>{order.push('modules');return['all']}},
  runtime:{loadLifecycle:async()=>lifecycle,createEntitlements:input=>new PluginEntitlementRuntime({repository:createAtomicRepository('usage',createSqliteAtomicDriver(db)),load:async tenantId=>({tenantId,plan:'standard',status:'active',addons:[]}),isActive:(p,id)=>input.isPluginEnabled(p.tenantId,id)})},
 }
 return{options,db,order,store,lifecycle,scope,setActive:(value:boolean)=>{active=value},setMember:(value:boolean)=>{member=value},request:(app:Hono,path:string)=>app.request(path,{headers:{Authorization:'Bearer valid'}})}
}
