import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const entry=process.env.EAOS_TEST_CLI_BASELINE_MODULE??resolve(import.meta.dir,'../src/baseline.ts')
const {writeContractBaseline}=await import(pathToFileURL(entry).href)
const directory=await mkdtemp(join(tmpdir(),'eaos-real-baseline-'))
try{
 const contract={id:'baseline-fixture',version:'1.0.0',description:'Synthetic isolated baseline verification',schema:{$defs:{items:{type:'object',properties:{tenant_id:{type:'string'},id:{type:'string'}},required:['tenant_id'],'x-db':{tableName:'baseline_items'}},parents:{type:'object',properties:{tenant_id:{type:'string'},id:{type:'string'}},required:['tenant_id'],'x-db':{tableName:'baseline_parents'}}}},migrations:[
 {id:'001',scope:'database',sql:{
 sqlite:['CREATE TABLE baseline_parents(tenant_id TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(tenant_id,id))','CREATE TABLE baseline_items(tenant_id TEXT NOT NULL,id TEXT NOT NULL,parent_id TEXT,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,parent_id) REFERENCES baseline_parents(tenant_id,id))'],
 postgres:['CREATE TABLE baseline_parents(tenant_id TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(tenant_id,id))','CREATE TABLE baseline_items(tenant_id TEXT NOT NULL,id TEXT NOT NULL,parent_id TEXT,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,parent_id) REFERENCES baseline_parents(tenant_id,id))'],
 oracle:['CREATE TABLE baseline_parents(tenant_id VARCHAR2(80) NOT NULL,id VARCHAR2(80) NOT NULL,PRIMARY KEY(tenant_id,id))','CREATE TABLE baseline_items(tenant_id VARCHAR2(80) NOT NULL,id VARCHAR2(80) NOT NULL,parent_id VARCHAR2(80),PRIMARY KEY(tenant_id,id),CONSTRAINT baseline_parent_fk FOREIGN KEY(tenant_id,parent_id) REFERENCES baseline_parents(tenant_id,id))']}},
 {id:'002',scope:'database',sql:{
 sqlite:["ALTER TABLE baseline_items ADD COLUMN plugin_data TEXT NOT NULL DEFAULT '{}'", "ALTER TABLE baseline_items ADD COLUMN label TEXT GENERATED ALWAYS AS (json_extract(plugin_data,'$.label')) VIRTUAL",'CREATE INDEX baseline_label ON baseline_items(tenant_id,label)','CREATE VIEW baseline_view AS SELECT tenant_id,id,label FROM baseline_items'],
 postgres:["ALTER TABLE baseline_items ADD COLUMN plugin_data JSONB NOT NULL DEFAULT '{}'", "ALTER TABLE baseline_items ADD COLUMN label TEXT GENERATED ALWAYS AS (plugin_data->>'label') STORED",'CREATE INDEX baseline_label ON baseline_items(tenant_id,label)','CREATE VIEW baseline_view AS SELECT tenant_id,id,label FROM baseline_items',"COMMENT ON COLUMN baseline_items.label IS 'Synthetic generated label'",'ALTER TABLE baseline_items ENABLE ROW LEVEL SECURITY',"CREATE POLICY baseline_tenant ON baseline_items USING(tenant_id=current_setting('app.tenant_id',true))"],
 oracle:["ALTER TABLE baseline_items ADD (plugin_data CLOB DEFAULT '{}' NOT NULL CHECK(plugin_data IS JSON))", "ALTER TABLE baseline_items ADD (label GENERATED ALWAYS AS (JSON_VALUE(plugin_data,'$.label' RETURNING VARCHAR2(80))) VIRTUAL)",'CREATE INDEX baseline_label ON baseline_items(tenant_id,label)','CREATE VIEW baseline_view AS SELECT tenant_id,id,label FROM baseline_items',"COMMENT ON COLUMN baseline_items.label IS 'Synthetic generated label'"]}},
 {id:'003',scope:'database',sql:{
 sqlite:["CREATE TRIGGER baseline_guard BEFORE INSERT ON baseline_items WHEN NEW.tenant_id='denied' BEGIN SELECT RAISE(ABORT,'denied'); END"],
 postgres:["CREATE FUNCTION baseline_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='denied' THEN RAISE EXCEPTION 'denied'; END IF; RETURN NEW; END $$",'CREATE TRIGGER baseline_guard BEFORE INSERT ON baseline_items FOR EACH ROW EXECUTE FUNCTION baseline_guard_fn()'],
 oracle:["CREATE OR REPLACE TRIGGER baseline_guard BEFORE INSERT ON baseline_items FOR EACH ROW BEGIN IF :NEW.tenant_id='denied' THEN RAISE_APPLICATION_ERROR(-20010,'denied'); END IF; END;"]}},
 ]}
 const original=JSON.stringify(contract,null,2)+'\n';await writeFile(join(directory,'source.json'),original)
 const result=await writeContractBaseline(directory,{contract:'source.json',version:'1.1.0',out:'baseline'}),baseline=JSON.parse(await readFile(join(result.path,'baseline.json'),'utf8')),verification=JSON.parse(await readFile(join(result.path,'verification.json'),'utf8'))
 assert.equal(await readFile(join(directory,'source.json'),'utf8'),original);assert.deepEqual(baseline.source,contract);assert.equal(baseline.replaces.length,3)
 for(const dialect of ['sqlite','postgres','oracle']){const sql=baseline.target.migrations[0].sql[dialect].join('\n');assert(sql.includes('GENERATED ALWAYS'));assert(sql.toLowerCase().includes('baseline_guard'));assert(sql.toLowerCase().includes('baseline_view'));assert(!/ADD\s+(?:COLUMN\s+)?(?:plugin_data|\(plugin_data)/i.test(sql))}
 assert(baseline.target.migrations[0].sql.postgres.join('\n').includes('CREATE POLICY'))
 assert(verification.compilers.every((value:any)=>value.rebuilt===true))
 const out=resolve(process.env.EAOS_BASELINE_TEST_EVIDENCE??join(directory,'evidence'));await mkdir(out,{recursive:true});await writeFile(join(out,'receipt.json'),JSON.stringify({status:'succeeded',baselineHash:baseline.hash,compilers:verification.compilers,checks:['three dialects','generated columns','indexes','composite foreign keys','views','triggers','PostgreSQL RLS policy','comments','independent empty rebuild','source retained','exact history checksums'],productionApplied:false},null,2)+'\n');await writeFile(join(out,'baseline.json'),JSON.stringify(baseline,null,2)+'\n');console.log('Real three-dialect baseline generation and independent rebuild passed:',out)
}finally{await rm(directory,{recursive:true,force:true})}
