import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createSqlRecordStore } from '@alneas/eaos-server/plugin-data'
import { FieldCustomizationService } from '../src/service'
test('authoritative camel-case fields retain validation, CAS and live resource admission',async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 let enabled=true
 const service=new FieldCustomizationService({store:createSqlRecordStore('records',{dialect:'sqlite',execute:async(_tenant,sql,binds)=>sql.startsWith('SELECT')?{rows:db.query(sql).all(...binds as any[]) as any[]}:{affectedRows:db.query(sql).run(...binds as any[]).changes}}),authorize:async(p,_operation,resource)=>enabled&&p.tenantId==='alpha'&&resource==='crm.leads',resolveSchema:async()=>({type:'object',properties:{companyName:{type:'string',minLength:1},contactName:{type:'string'}},required:['companyName']})})
 const p={tenantId:'alpha',userId:'author',roles:['admin']}
 try{
  const saved=await service.write(p,'crm.leads',{revision:0,fields:{companyName:{display_label:'取引先名'},contactName:{is_hidden:true}}})
  expect(saved.schema.properties!.companyName).toMatchObject({title:'取引先名',minLength:1});expect(saved.schema.required).toEqual(['companyName'])
  await expect(service.write(p,'crm.leads',{revision:0,fields:{}})).rejects.toMatchObject({status:409})
  await expect(service.write(p,'crm.leads',{revision:1,fields:{companyName:{is_hidden:true}}})).rejects.toMatchObject({status:400})
  expect((await service.read(p,'crm.leads')).fields.companyName.display_label).toBe('取引先名')
  enabled=false;await expect(service.read(p,'crm.leads')).rejects.toMatchObject({status:403})
 }finally{db.close()}
})

test('field read and write recheck admission after the SQL lookup',async()=>{
 for(const action of ['read','write'] as const){
  let allowed=true,written=false
  const service=new FieldCustomizationService({store:{read:async()=>{allowed=false;return null},list:async()=>[],create:async()=>{written=true},replace:async()=>{written=true;return true}},authorize:async()=>allowed,resolveSchema:async()=>({type:'object',properties:{companyName:{type:'string'}},required:['companyName']})})
  const principal={tenantId:'tenant-a',userId:'author',roles:['admin']}
  await expect(action==='read'?service.read(principal,'crm.leads'):service.write(principal,'crm.leads',{revision:0,fields:{companyName:{display_label:'取引先'}}})).rejects.toMatchObject({status:403})
  expect(written).toBe(false)
 }
})
