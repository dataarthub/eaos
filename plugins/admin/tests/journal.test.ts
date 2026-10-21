import {test,expect} from 'bun:test'
import {Database} from 'bun:sqlite'
import {createAtomicRepository,createSqliteAtomicDriver,atomicCommand} from '@alneas/eaos-server/plugin-data'
import {createAdminRoutes} from '../src'

test('named journal reads isolate tenant and namespace, require current permission after audit and detect tampering',async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 const p={tenantId:'alpha',userId:'actual-admin',roles:['tenant_admin']},repo=createAtomicRepository('records',createSqliteAtomicDriver(db),{namespace:'estates'});let enabled=true,withdrawAfterAudit=false,audits=0
 try{
  await repo.run(p,tx=>atomicCommand(tx,p,'estate_write',{commandId:'one',privateName:'Private tenant name'},async()=>{await tx.put('one',{tenantId:p.tenantId},0);return{id:'one'}}))
  await createAtomicRepository('records',createSqliteAtomicDriver(db),{namespace:'other'}).run(p,tx=>tx.put('other',{privateName:'other namespace'},0))
  const app=createAdminRoutes({resources:[{id:'estates',label:'Named estate records',table:'records',tenantColumn:'tenant_id',keyColumn:'id',recordNamespace:'estates',columns:[{name:'id',label:'ID',type:'string'}],journal:repo}],authorize:async()=>enabled,driver:()=>({dialect:'sqlite',execute:async(_t,sql,binds)=>({rows:db.query(sql).all(...binds as any[]) as any[]})}),audit:async()=>{audits++;if(withdrawAfterAudit)enabled=false}},async()=>p)
  const call=(op:string,body:any={})=>app.request('/'+op,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  expect(await(await call('admin_journal_catalog')).json()).toEqual({tenantId:'alpha',resources:[{id:'estates',label:'Named estate records'}]})
  const page:any=await(await call('admin_journal_events',{resourceId:'estates',limit:1})).json();expect(page.events).toHaveLength(1);expect(page.events[0]).toMatchObject({operation:'estate_write',actorId:'actual-admin',sequence:1});expect(JSON.stringify(page)).not.toContain('Private tenant name')
  expect(await(await call('admin_journal_verify',{resourceId:'estates'})).json()).toMatchObject({status:'verified',count:1,externalTrustAnchor:false})
  const rows:any=await(await call('resources/estates/query')).json();expect(rows.rows.every((v:any)=>v.id.startsWith('estates:'))).toBe(true)
  p.tenantId='beta';expect(await(await call('admin_journal_events',{resourceId:'estates'})).json()).toMatchObject({events:[]});p.tenantId='alpha'
  expect((await call('admin_journal_events',{resourceId:'estates',tenantId:'beta'})).status).toBe(400)
  expect((await call('admin_journal_events',{resourceId:'estates',limit:101})).status).toBe(400)
  p.roles=['user'];expect((await call('admin_journal_verify',{resourceId:'estates'})).status).toBe(403);p.roles=['tenant_admin']
  withdrawAfterAudit=true;expect((await call('admin_journal_verify',{resourceId:'estates'})).status).toBe(403);withdrawAfterAudit=false;enabled=true
  db.query("UPDATE records SET payload=json_set(payload,'$.actorId','forged') WHERE id LIKE 'estates:audit/event/%'").run()
  expect((await call('admin_journal_verify',{resourceId:'estates'})).status).toBe(409);expect(audits).toBeGreaterThan(0)
 }finally{db.close()}
})
