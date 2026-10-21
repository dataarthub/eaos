import {test,expect} from 'bun:test'
import {dataContractTables,resolveDataContracts,assertDataContractBinding,collectSchemaMigrations,type DataContract} from './data-contracts'
const schema=(name='notes')=>({'x-db':{tableName:name},type:'object',properties:{tenant_id:{type:'string'},id:{type:'string'}},required:['tenant_id','id']})
const contract=(id='notes',extras:Partial<DataContract>={}):DataContract=>({id,version:'1.2.0',description:'Isolated fixture',schema:schema(id),migrations:[{id:'initial',scope:'database',sql:{sqlite:[`CREATE TABLE ${id} (tenant_id TEXT NOT NULL, id TEXT)`]}}],...extras})
test('dumped schema-qualified and quoted table DDL retains contract ownership checks',()=>{
 for(const sql of ['CREATE TABLE public.notes(tenant_id TEXT)', 'ALTER TABLE ONLY "public"."notes" ADD id TEXT', 'CREATE TABLE "NOTES" (tenant_id VARCHAR2(80))', 'DROP TABLE IF EXISTS public.notes', 'TRUNCATE TABLE ONLY public.notes'])expect(()=>resolveDataContracts([contract('notes',{migrations:[{id:'baseline',scope:'database',sql:{postgres:[sql]}}]})],{notes:'*'})).not.toThrow()
 for(const sql of ['CREATE TABLE public.foreign_table(id TEXT)', 'ALTER TABLE ONLY "public"."foreign_table" ADD id TEXT', 'DROP TABLE "FOREIGN_TABLE"', 'TRUNCATE TABLE public.foreign_table'])expect(()=>resolveDataContracts([contract('notes',{migrations:[{id:'baseline',scope:'database',sql:{postgres:[sql]}}]})],{notes:'*'})).toThrow('foreign table')
})
test('selected contracts resolve dependencies in order and bindings enforce ownership/version/namespace',()=>{
 const catalog=resolveDataContracts([contract('notes',{dependencies:{base:'^1.0.0'}}),contract('base'),contract('unused')],{notes:'^1.1.0'})
 expect(catalog.contracts.map(c=>c.id)).toEqual(['base','notes']);expect(catalog.tables.map(t=>t.name)).toEqual(['base','notes'])
 expect(()=>assertDataContractBinding(catalog,{contractId:'notes',version:'^1',table:'notes',namespace:'owned_scope'})).not.toThrow()
 for(const binding of [{contractId:'notes',version:'^2',table:'notes'},{contractId:'notes',version:'^1',table:'base'},{contractId:'missing',version:'^1',table:'notes'},{contractId:'notes',version:'?',table:'notes'},{contractId:'notes',version:'^1',table:'notes',namespace:'foreign/scope'}])expect(()=>assertDataContractBinding(catalog,binding)).toThrow('Invalid')
})
test('reject invalid, duplicate, missing-tenant and multiply-owned schemas',()=>{
 for(const value of [{},schema('Unsafe-Name'),{...schema(),required:['id']},{...schema(),properties:{id:{type:'string'}}},{$defs:{a:schema(),b:schema()}}])expect(()=>dataContractTables(value)).toThrow()
 expect(dataContractTables({$defs:{a:schema('one'),b:schema('two')}}).size).toBe(2)
 expect(()=>resolveDataContracts([contract('a',{schema:schema('same'),migrations:[]}),contract('b',{schema:schema('same'),migrations:[]})],{a:'*',b:'*'})).toThrow('multiple data contract owners')
})
test('reject invalid registration, migration identities and SQL ownership before returning a catalog',()=>{
 const invalid=[contract('Bad'),contract('a',{version:'invalid'}),contract('a',{description:' '}),contract('a',{migrationIdentity:'../bad'}),contract('a',{migrations:[{id:'bad/id',scope:'database',sql:{sqlite:['SELECT 1']}}]}),contract('a',{migrations:[{id:'initial',scope:'database',sql:{sqlite:[' ']}}]}),contract('a',{migrations:[{id:'initial',scope:'database',sql:{}}]}),contract('a',{migrations:[{id:'initial',scope:'database',sql:{sqlite:['ALTER TABLE foreign_table ADD name TEXT']}}]})]
 for(const value of invalid)expect(()=>resolveDataContracts([value],{[value.id]:'*'})).toThrow()
 expect(()=>resolveDataContracts([contract(),contract()],{})).toThrow('duplicate')
 expect(()=>resolveDataContracts([contract('a',{migrationIdentity:'shared'}),contract('b',{migrationIdentity:'shared'})],{})).toThrow('duplicate')
 const a=contract();a.migrations.push(structuredClone(a.migrations[0]));expect(()=>resolveDataContracts([a],{})).toThrow('migration')
})
test('reject dependency cycles, incompatible repeated requirements and unknown/range-invalid releases',()=>{
 expect(()=>resolveDataContracts([contract('a',{dependencies:{b:'*'}}),contract('b',{dependencies:{a:'*'}})],{a:'*'})).toThrow('cycle')
 for(const requirements of [{missing:'*'},{notes:'^2'},{notes:'not-a-range'}])expect(()=>resolveDataContracts([contract()],requirements)).toThrow('Unsatisfied')
 expect(()=>resolveDataContracts([contract('a',{dependencies:{notes:'^1'}}),contract('b',{dependencies:{notes:'^2'}}),contract()],{a:'*',b:'*'})).toThrow('Unsatisfied')
})
test('migration inventory deduplicates identical definitions, preserves historical identity and rejects conflicts per release',()=>{
 const c=contract('notes',{migrationIdentity:'retained-notes'}),own={id:'own',scope:'tenant' as const,sql:{sqlite:['SELECT 1']}}
 expect(collectSchemaMigrations([{migrations:[own],schemaDependencies:{notes:'^1'},schemaContracts:[c]},{migrations:[],schemaDependencies:{notes:'^1'},schemaContracts:[structuredClone(c)]}],[c])).toEqual([...c.migrations,own])
 expect(()=>collectSchemaMigrations([{migrations:[],schemaContracts:[{...c,description:'conflict'}]}],[c])).toThrow('Conflicting')
 expect(()=>collectSchemaMigrations([{migrations:[],schemaDependencies:{notes:'^2'}},{migrations:[],schemaDependencies:{notes:'^1'}}],[c])).toThrow('Unsatisfied')
})
