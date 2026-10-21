import { expect, test } from 'bun:test'
import { squashSqliteContract } from './baseline'
import type { DataContract } from '@alneas/eaos-server/lifecycle-engine'
const contract: DataContract = { id: 'sample', version: '1.0.0', description: 'Sample', schema: {}, migrations: [
  { id: '001', scope: 'database', sql: { sqlite: ['CREATE TABLE records(tenant_id TEXT,id TEXT,PRIMARY KEY(tenant_id,id))'] } },
  { id: '002', scope: 'database', sql: { sqlite: ["ALTER TABLE records ADD COLUMN plugin_data TEXT DEFAULT '{}'", "ALTER TABLE records ADD COLUMN label TEXT GENERATED ALWAYS AS (json_extract(plugin_data,'$.label')) VIRTUAL", 'CREATE INDEX records_label ON records(tenant_id,label)'] } },
] }
test('baseline introspects final CREATE definitions including generated columns and indexes', () => {
  const sql = squashSqliteContract(contract)
  expect(sql.join('\n')).not.toContain('ALTER TABLE')
  expect(sql.join('\n')).toContain('GENERATED ALWAYS')
  expect(sql.join('\n')).toContain('CREATE INDEX')
})
test('squash rejects filesystem access and data transforms that would lose seeds', () => {
  expect(() => squashSqliteContract({ ...contract, migrations: [...contract.migrations, { id: '003', scope: 'database', sql: { sqlite: ["ATTACH DATABASE '/tmp/private.db' AS external"] } }] })).toThrow('external')
  expect(() => squashSqliteContract({ ...contract, migrations: [...contract.migrations, { id: '003', scope: 'database', sql: { sqlite: ["INSERT INTO records(tenant_id,id) VALUES('a','seed')"] } }] })).toThrow('seed')
})

test('baseline compiler refuses unpinned images and incomplete or data-bearing histories before starting Docker',async()=>{
 const {squashDatabaseContract}=await import('./baseline')
 const pg={...contract,migrations:contract.migrations.map(m=>({...m,sql:{postgres:m.sql.sqlite}}))}
 await expect(squashDatabaseContract(pg,'postgres',{postgresImage:'postgres:latest'})).rejects.toThrow('checksum-pinned')
 await expect(squashDatabaseContract({...pg,migrations:[...pg.migrations,{id:'003',scope:'database',sql:{postgres:["INSERT INTO records(tenant_id,id) VALUES('a','seed')"]}}]},'postgres')).rejects.toThrow('schema DDL only')
 await expect(squashDatabaseContract({...pg,migrations:[{id:'001',scope:'tenant',sql:{postgres:['CREATE TABLE records(id TEXT)']}}]},'postgres')).rejects.toThrow('complete database-scoped')
 await expect(squashDatabaseContract({...pg,migrations:[{id:'001',scope:'database',sql:{postgres:['CREATE TABLE records(id TEXT);\n\\! touch /tmp/unsafe']}}]},'postgres')).rejects.toThrow('client command')
})

test('baseline output is immutable and carries complete source checksums and compiler evidence',async()=>{
 const {mkdtemp,readFile,writeFile,rm,mkdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{writeContractBaseline}=await import('./baseline')
 const root=await mkdtemp(join(tmpdir(),'eaos-baseline-output-'))
 const valid={...contract,schema:{$defs:{records:{type:'object',properties:{tenant_id:{type:'string'},id:{type:'string'}},required:['tenant_id'],'x-db':{tableName:'records'}}}}}
 try{const source=JSON.stringify(valid);await writeFile(join(root,'source.json'),source);const result=await writeContractBaseline(root,{contract:'source.json',out:'release/baseline',version:'1.1.0'});const baseline=JSON.parse(await readFile(join(result.path,'baseline.json'),'utf8'))
 expect(baseline.replaces).toHaveLength(2);expect(baseline.source).toEqual(valid);expect(baseline.target.migrations).toHaveLength(1);expect(await readFile(join(root,'source.json'),'utf8')).toBe(source);expect(JSON.parse(await readFile(join(result.path,'verification.json'),'utf8')).compilers).toEqual([{dialect:'sqlite',rebuilt:true}]);await expect(writeContractBaseline(root,{contract:'source.json',out:'release/baseline',version:'1.1.0'})).rejects.toThrow('already exists')
 }finally{await rm(root,{recursive:true,force:true})}
})
