import { canonicalOracleDdl, oracleMetadataStatements } from './baseline-oracle-metadata'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DataContract } from '@alneas/eaos-server/lifecycle-engine'

/**
 * Checksum-pinned PostgreSQL and Oracle Docker images used by local schema-baseline compilation; acquisition is a separate operator step.
 * @see {@link squashDatabaseContract} for the canonical usage example and runtime requirements.
 */
export const baselineImages = {
 postgres: 'postgres@sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609',
 oracle: 'gvenzl/oracle-free@sha256:6d61d267a3b978c24c5ac1790e62e927416a0aec446bd86e4b3a1527562757bd',
} as const
/**
 * Local Docker compiler image and startup limits for schema-baseline verification.
 * @see {@link squashDatabaseContract} for the canonical usage example and runtime requirements.
 */
export interface DatabaseBaselineOptions { 
    /**
   * Optional locally preloaded digest-pinned PostgreSQL image; defaults to baselineImages.postgres.
   */
  postgresImage?: string; 
    /**
   * Optional locally preloaded digest-pinned Oracle image; defaults to baselineImages.oracle.
   */
  oracleImage?: string; 
    /**
   * Local database startup deadline in milliseconds; defaults to 600000 and must be an integer from 1000 to 900000.
   */
  startupTimeoutMs?: number }
/**
 * Final schema SQL with the exact image and independent rebuild evidence.
 * @see {@link squashDatabaseContract} for the canonical usage example and runtime requirements.
 */
export interface DatabaseBaselineCompilation { 
    /**
   * Final schema statements extracted from the temporary database.
   */
  sql: string[]; 
    /**
   * Dialect/image identity, canonical schema hash and rebuilt=true evidence from the independent schema comparison.
   */
  verification: {
    /** Selected compiler dialect, postgres or oracle, recorded with the verification evidence. */
  dialect: string;
    /** Exact digest-pinned local Docker image used to compile and independently rebuild the schema. */
  image: string;
    /** SHA-256 of JSON.stringify applied to the extracted source SQL statement array; Oracle rebuild comparison separately normalizes DDL. */
  schemaSha256: string;
    /** True only after source and independently rebuilt schema metadata compare equal; it is not evidence of host database adoption. */
  rebuilt: true } }
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
/** No remote daemon, existing container, host mount, published port or production DSN is accepted. */
async function docker(args:string[],input='',timeout=120_000,context?:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const env={...process.env};delete env.DOCKER_HOST;delete env.DOCKER_CONTEXT
  const child=spawn('docker',[...(context?['--context',context]:[]),...args],{env,stdio:['pipe','pipe','pipe']})
  let out='',err='',bytes=0,failed=false
  const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');reject(Error('Isolated baseline database command timed out'))},timeout)
  for(const [stream,append]of [[child.stdout,(v:string)=>out+=v],[child.stderr,(v:string)=>err+=v]] as const)stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>32*1024*1024){failed=true;child.kill('SIGKILL');reject(Error('Baseline database output exceeds limit'))}else append(chunk.toString())})
  child.on('error',error=>{clearTimeout(timer);if(!failed)reject(error)})
  child.on('close',code=>{clearTimeout(timer);if(!failed){if(code)reject(Error('Isolated database command failed: '+(err+'\n'+out).slice(-1600)));else resolve(out)}})
  child.stdin.on('error',()=>{});child.stdin.end(input)
 })
}
function validateHistory(contract:DataContract,dialect:'postgres'|'oracle'){
 if(!contract.migrations.length||contract.migrations.some(m=>m.scope!=='database'||!m.sql[dialect]?.length))throw Error('Baseline requires complete database-scoped '+dialect+' history')
 for(const migration of contract.migrations)for(const sql of migration.sql[dialect]!){
  const first=sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g,'').trim()
  if(!/^(CREATE|ALTER|DROP|COMMENT)\b/i.test(first)||/\b(?:DATABASE\s+LINK|FOREIGN\s+DATA|CREATE\s+EXTENSION|COPY\s|ALTER\s+SYSTEM|CREATE\s+USER|CREATE\s+ROLE)\b/i.test(first))throw Error('Automatic baseline accepts schema DDL only; seed/data/admin/external operations need separate reviewed migrations')
  // psql/sqlplus client commands must never be accepted through trusted SQL history.
  if(/^\s*(?:\\|@|HOST\b|CONNECT\b|SPOOL\b|START\b|EXIT\b|QUIT\b|!)/im.test(sql))throw Error('Baseline history contains a database client command')
 }
}
function oracleScript(sql:string){const value=sql.trim().replace(/;\s*$/,'');return /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE)\b|BEGIN\b|DECLARE\b)/i.test(value)?value+';\n/\n':value+';\n'}
const oracleMetadata=`
BEGIN
 DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'SEGMENT_ATTRIBUTES',FALSE);
 DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'STORAGE',FALSE);
 DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'TABLESPACE',FALSE);
 DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'EMIT_SCHEMA',FALSE);
 DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'REF_CONSTRAINTS',FALSE);
 DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'SQLTERMINATOR',FALSE);
END;
/
DECLARE result CLOB; chunk VARCHAR2(32767);
BEGIN
 SELECT JSON_ARRAYAGG(JSON_OBJECT('kind' VALUE kind,'name' VALUE name,'ddl' VALUE ddl RETURNING CLOB) ORDER BY rank,position RETURNING CLOB) INTO result FROM (
 SELECT CASE object_type WHEN 'TYPE' THEN 0 WHEN 'SEQUENCE' THEN 1 WHEN 'TABLE' THEN 2 ELSE 4 END rank,object_id position,object_type kind,object_name name,DBMS_METADATA.GET_DDL(REPLACE(object_type,' ','_'),object_name) ddl FROM user_objects o
 WHERE object_type IN ('TABLE','SEQUENCE','INDEX','VIEW','TRIGGER','FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY','TYPE','TYPE BODY')
 AND NOT(object_type='INDEX' AND (EXISTS(SELECT 1 FROM user_constraints c WHERE c.index_name=o.object_name) OR generated='Y'))
 AND NOT(object_type='SEQUENCE' AND object_name LIKE 'ISEQ$$_%')
 UNION ALL SELECT 3,ROWNUM,'REF_CONSTRAINT',constraint_name,DBMS_METADATA.GET_DDL('REF_CONSTRAINT',constraint_name) FROM user_constraints WHERE constraint_type='R'
 UNION ALL SELECT 5,ROWNUM,'COMMENT',table_name,TO_CLOB('COMMENT ON TABLE "'||table_name||'" IS '''||REPLACE(comments,'''','''''')||'''') FROM user_tab_comments WHERE comments IS NOT NULL
 UNION ALL SELECT 6,ROWNUM,'COMMENT',table_name||'.'||column_name,TO_CLOB('COMMENT ON COLUMN "'||table_name||'"."'||column_name||'" IS '''||REPLACE(comments,'''','''''')||'''') FROM user_col_comments WHERE comments IS NOT NULL
 );
 IF result IS NULL THEN result:='[]'; END IF;
 FOR i IN 0..CEIL(DBMS_LOB.GETLENGTH(result)/3000)-1 LOOP
 chunk:=UTL_RAW.CAST_TO_VARCHAR2(UTL_ENCODE.BASE64_ENCODE(UTL_RAW.CAST_TO_RAW(DBMS_LOB.SUBSTR(result,3000,i*3000+1))));
 DBMS_OUTPUT.PUT_LINE('EAOS_JSON_'||REPLACE(REPLACE(chunk,CHR(10)),CHR(13)));
 END LOOP;
END;
/`
/**
 * Compile PostgreSQL or Oracle schema history in isolated local Docker databases and verify its rebuilt metadata.
 * @param contract - Reviewed database-scoped migration contract with complete SQL for the selected dialect.
 * @param dialect - postgres or oracle; SQLite uses squashSqliteContract instead.
 * @param options - Optional digest-pinned preloaded images and startup timeout; see DatabaseBaselineOptions.
 * @returns Final SQL statements and immutable image/schema rebuild verification metadata.
 * @throws Rejects unsupported history, nonlocal Docker contexts, unavailable/nonpinned images, unsupported objects, seeded data, startup timeouts or metadata mismatch.
 * @remarks Starts disposable local containers/volumes and removes owned resources in cleanup. Never accepts a production DSN, existing container, host mount or published database port; images must already be acquired.
 * @example
 * import { squashDatabaseContract } from '@alneas/eaos-cli/baseline'
 * export function compilePostgres(contract: Parameters<typeof squashDatabaseContract>[0]) { return squashDatabaseContract(contract, 'postgres') }
 */
export async function squashDatabaseContract(contract:DataContract,dialect:'postgres'|'oracle',options:DatabaseBaselineOptions={}):Promise<DatabaseBaselineCompilation>{
 validateHistory(contract,dialect)
 const image=(dialect==='postgres'?options.postgresImage:options.oracleImage)??baselineImages[dialect]
 if(!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image))throw Error('Baseline database image must be checksum-pinned')
 const timeout=options.startupTimeoutMs??600_000;if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>900_000)throw Error('Invalid baseline startup timeout')
 const contextName=(await docker(['context','show'])).trim()
 if(!/^[A-Za-z0-9_.-]+$/.test(contextName))throw Error('Invalid local Docker context')
 const endpoint=JSON.parse(await docker(['context','inspect',contextName,'--format','{{json .Endpoints.docker.Host}}'])) as string
 if(!endpoint.startsWith('unix://'))throw Error('Baseline only uses a local Docker Unix socket')
 const command=(args:string[],input='',timeout=120_000)=>docker(args,input,timeout,contextName)
 const name='eaos-baseline-'+randomUUID(),password='Eaos'+randomBytes(20).toString('hex');let created=false,networkCreated=false
 try{
  if(dialect==='oracle'){await command(['network','create','--internal','--label','org.alneas.eaos.baseline='+name,name]);networkCreated=true}
  await command(['run','--detach','--pull=never','--name',name,'--label','org.alneas.eaos.baseline='+name,'--network',networkCreated?name:'none','--cpus','2','--memory',dialect==='oracle'?'4g':'512m','--pids-limit','1024',...(dialect==='oracle'?['--shm-size','512m','--env','ORACLE_PASSWORD='+password]:['--env','POSTGRES_PASSWORD='+password]),image]);created=true
  const pg=(db:string,sql:string)=>command(['exec','-i',name,'psql','-X','--set','ON_ERROR_STOP=1','--username',db==='postgres'?'postgres':'eaos_owner','--dbname',db,'--tuples-only','--no-align'],sql)
  const ora=async(user:string,sql:string)=>{const out=await command(['exec','-i',name,'sqlplus','-s','-L','/nolog'],`WHENEVER SQLERROR EXIT FAILURE ROLLBACK\nWHENEVER OSERROR EXIT FAILURE\nSET ECHO OFF FEEDBACK OFF HEADING OFF PAGESIZE 0 VERIFY OFF DEFINE OFF LINESIZE 32767 TRIMSPOOL ON SERVEROUTPUT ON SIZE UNLIMITED\nCONNECT ${user}/${password}@//localhost:1521/FREEPDB1\n${sql}\nEXIT\n`);if(/(?:^|\n)\s*(?:ORA-\d+|SP2-\d+)/.test(out))throw Error('Isolated Oracle SQL failed: '+out.slice(-1500));return out.trim()}
  const start=Date.now();let ready=false
  while(Date.now()-start<timeout){try{if(dialect==='postgres')await command(['exec',name,'pg_isready','-U','postgres']);else await command(['exec',name,'healthcheck.sh']);ready=true;break}catch{await new Promise(resolve=>setTimeout(resolve,1000))}}
  if(!ready)throw Error('Isolated '+dialect+' startup failed')
  let source:string[],fresh:string[]
  if(dialect==='postgres'){
   await pg('postgres',"CREATE ROLE eaos_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; CREATE DATABASE eaos_source OWNER eaos_owner;").catch(async()=>{throw Error('Could not provision isolated PostgreSQL roles/databases')})
   await pg('postgres','CREATE DATABASE eaos_fresh OWNER eaos_owner;')
   for(const m of contract.migrations)for(const sql of m.sql.postgres!)await pg('eaos_source',sql)
   const rows=await pg('eaos_source',"SELECT format('SELECT count(*) FROM %I.%I',schemaname,tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')\n\\gexec\n")
   if(rows.split(/\s+/).filter(Boolean).some(v=>v!=='0'))throw Error('Baseline contains seed/data transformations')
   const snapshot=async(db:string)=>{const dump=await command(['exec',name,'pg_dump','--username','eaos_owner','--dbname',db,'--schema-only','--no-owner','--no-privileges','--restrict-key=EAOSBASELINE']);return dump.replace(/^\\(?:un)?restrict EAOSBASELINE\r?\n/gm,'').trim()}
   source=[await snapshot('eaos_source')]
   await pg('eaos_fresh',source[0]);fresh=[await snapshot('eaos_fresh')]
  }else{
   await ora('system',`CREATE USER EAOS_SOURCE IDENTIFIED BY ${password} QUOTA 128M ON USERS;\nCREATE USER EAOS_FRESH IDENTIFIED BY ${password} QUOTA 128M ON USERS;\nGRANT CREATE SESSION,CREATE TABLE,CREATE VIEW,CREATE SEQUENCE,CREATE TRIGGER,CREATE PROCEDURE,CREATE TYPE TO EAOS_SOURCE,EAOS_FRESH;`)
   for(const m of contract.migrations)for(const sql of m.sql.oracle!)await ora('EAOS_SOURCE',oracleScript(sql))
   const inspect=async(user:string)=>{await ora(user,`DECLARE n NUMBER; c NUMBER; BEGIN SELECT COUNT(*) INTO n FROM user_policies; IF n>0 THEN RAISE_APPLICATION_ERROR(-20001,'RLS policies need an explicit policy compiler'); END IF; SELECT COUNT(*) INTO n FROM user_objects WHERE status='INVALID' OR object_type NOT IN ('TABLE','INDEX','LOB','SEQUENCE','VIEW','TRIGGER','FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY','TYPE','TYPE BODY','TABLE PARTITION','INDEX PARTITION','LOB PARTITION'); IF n>0 THEN RAISE_APPLICATION_ERROR(-20002,'Unsupported or invalid schema objects'); END IF; FOR t IN(SELECT table_name FROM user_tables WHERE nested='NO' AND secondary='N') LOOP EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM "'||t.table_name||'"' INTO c; IF c>0 THEN RAISE_APPLICATION_ERROR(-20003,'Baseline contains seed data'); END IF; END LOOP; END;\n/`).catch(async error=>{const details=await ora(user,"SELECT object_type||':'||object_name||':'||status FROM user_objects ORDER BY object_id;\nSELECT name||':'||line||':'||text FROM user_errors ORDER BY name,sequence;");throw new Error(String(error)+'\n'+details)})
    const output=await ora(user,oracleMetadata),parts=[...output.matchAll(/^EAOS_JSON_([A-Za-z0-9+/=]+)$/gm)];if(!parts.length)throw Error('Oracle metadata export is empty');return JSON.parse(parts.map(part=>Buffer.from(part[1],'base64').toString('utf8')).join('')) as {kind:string;name:string;ddl:string}[]}
   const original=await inspect('EAOS_SOURCE');if(!original.some(o=>o.kind==='TABLE'))throw Error('Empty baseline')
   source=original.flatMap(oracleMetadataStatements);for(const sql of source)await ora('EAOS_FRESH',oracleScript(sql));fresh=(await inspect('EAOS_FRESH')).flatMap(oracleMetadataStatements)
  }
  if(JSON.stringify(dialect==='oracle'?source.map(canonicalOracleDdl):source)!==JSON.stringify(dialect==='oracle'?fresh.map(canonicalOracleDdl):fresh))throw Error('Generated '+dialect+' baseline metadata differs after rebuild')
  return{sql:source,verification:{dialect,image,schemaSha256:digest(JSON.stringify(source)),rebuilt:true}}
 }finally{try{if(created)await command(['rm','--force','--volumes',name])}finally{if(networkCreated)await command(['network','rm',name])}}
}
