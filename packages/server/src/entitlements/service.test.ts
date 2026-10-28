import { test,expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createSqliteAtomicDriver, verifyAtomicAudit } from '../plugin-data/index'
import { createPluginEntitlementGuard } from './index'
import { Hono } from 'hono'
import { createPlatformEntitlementService, entitlementAuditSql } from './service'
import {tenantEntitlementContract} from './sql'
import { createEntitlementAdminRoutes } from './admin-routes'
const p={tenantId:'alpha',userId:'operator',roles:['admin']}
const rule={tier:'pro' as const,addonId:'addon-quant',metering:{unit:'request',defaultMonthlyQuota:0}}
test('common contracts persist with CAS/audit and gate shared HTTP quota, revocation and tenant isolation',async()=>{
 const db=new Database(':memory:');for(const sql of tenantEntitlementContract.migrations[0].sql.sqlite??[])db.exec(sql);db.exec(entitlementAuditSql.sqlite)
 let active=true
 const service=createPlatformEntitlementService({driver:createSqliteAtomicDriver(db),manifests:[{id:'quant',entitlement:rule}] as any,isActive:async()=>active})
 const app=new Hono().use('*',createPluginEntitlementGuard('quant',rule,service.runtime,async()=>p)).get('/',c=>c.text('real handler'))
 try{
  expect((await app.request('/')).status).toBe(402)
  const input={commandId:'grant-1',revision:0,contract:{tenantId:p.tenantId,plan:'standard' as const,status:'active' as const,addons:['addon-quant'],monthlyQuotas:{'addon-quant':2}}}
  expect((await service.save(p,input)).revision).toBe(1);expect((await service.save(p,input)).revision).toBe(1)
  const results=await Promise.all([app.request('/'),app.request('/'),app.request('/')]);expect(results.map(r=>r.status).sort()).toEqual([200,200,402])
  expect((await service.read({...p,tenantId:'beta'})).contract).toBeNull()
  expect((await service.repository.run(p,tx=>verifyAtomicAudit(tx,p))).count).toBe(3)
  await expect(service.save(p,{...input,commandId:'stale'})).rejects.toMatchObject({status:409})
  await service.save(p,{...input,commandId:'suspend',revision:1,contract:{...input.contract,status:'suspended'}})
  expect((await app.request('/')).status).toBe(402)
  active=false;expect((await app.request('/')).status).toBe(404)
 }finally{db.close()}
},3000)
test('admin route rejects non-admin, forged tenant, cross-origin writes and audit failures roll back contracts',async()=>{
 const db=new Database(':memory:');for(const sql of tenantEntitlementContract.migrations[0].sql.sqlite??[])db.exec(sql);db.exec(entitlementAuditSql.sqlite)
 const service=createPlatformEntitlementService({driver:createSqliteAtomicDriver(db),manifests:[],isActive:async()=>true})
 let admin=false
 const app=createEntitlementAdminRoutes({service:async()=>service,tenantExists:async id=>id==='alpha',authorization:{resolvePrincipal:async()=>({userId:'owner',isPlatformAdmin:admin}),authorize:async()=>admin}})
 const path='/tenants/alpha/entitlements',input={commandId:'grant',revision:0,contract:{tenantId:'alpha',plan:'standard',status:'active',addons:[]}}
 const put=(body:unknown,origin='http://localhost')=>app.request(path,{method:'PUT',headers:{Origin:origin,'X-EAOS-Request':'tenant-contract','Content-Type':'application/json'},body:JSON.stringify(body)})
 try{
  expect((await app.request(path)).status).toBe(403);admin=true
  expect((await put(input,'https://evil.test')).status).toBe(403)
  expect((await put({...input,contract:{...input.contract,tenantId:'beta'}})).status).toBe(400)
  db.exec("CREATE TRIGGER fail_contract_audit BEFORE INSERT ON eaos_entitlement_records BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  expect((await put(input)).status).toBe(503)
  expect((await service.read(p)).revision).toBe(0)
 }finally{db.close()}
})
