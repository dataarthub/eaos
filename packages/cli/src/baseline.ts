import { squashDatabaseContract, type DatabaseBaselineOptions } from './baseline-databases'
export { squashDatabaseContract,baselineImages,type DatabaseBaselineOptions,type DatabaseBaselineCompilation } from './baseline-databases'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDataContractBaseline, type DataContract } from '@alneas/eaos-server/lifecycle-engine'
import { safePath } from './platform/index'

/**
 * Compile database-scoped SQLite migration history into a schema-only baseline and verify an independent rebuild.
 * @param contract - Reviewed Data Contract whose migrations contain complete SQLite DDL.
 * @returns Final schema SQL ordered by tables, indexes, views, then other objects, preserving SQLite schema row order within each group.
 * @throws Rejects missing dialect SQL, external-database operations, virtual/empty schemas, seeded rows and rebuild mismatches.
 * @remarks Runs trusted SQL in temporary in-memory node:sqlite databases and closes them. It does not touch a live database or rebase an existing ledger.
 * @example
 * import { squashSqliteContract } from '@alneas/eaos-cli/baseline'
 * export function compileSqlite(contract: Parameters<typeof squashSqliteContract>[0]) { return squashSqliteContract(contract) }
 */
export function squashSqliteContract(contract: DataContract): string[] {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON')
    for (const migration of contract.migrations) {
      if (migration.scope !== 'database' || !migration.sql.sqlite?.length) throw Error('SQLite baseline requires complete database-scoped SQLite history')
      for (const sql of migration.sql.sqlite) {
        // Trusted DDL still must not reach host files, extensions, or attached databases.
        if (/\b(?:ATTACH|DETACH|VACUUM|PRAGMA|load_extension|readfile|writefile)\b/i.test(sql)) throw Error('Baseline history contains external database operations')
        db.exec(sql)
      }
    }
    const rows = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid").all() as { type: string; name: string; sql: string }[]
    if (!rows.length || rows.some(r => /\bVIRTUAL\s+TABLE\b/i.test(r.sql))) throw Error('Empty or virtual-table baseline needs a provider-specific compiler')
    for (const table of rows.filter(r => r.type === 'table')) {
      if ((db.prepare(`SELECT COUNT(*) AS n FROM "${table.name.replaceAll('"', '""')}"`).get() as { n: number }).n) throw Error('Baseline contains seed/data transformations; provide reviewed data migration separately')
    }
    const statements = rows.map(r => r.sql)
    // Exercise the generated DDL and generated columns in a second empty database.
    const fresh = new DatabaseSync(':memory:')
    try { for (const sql of statements) fresh.exec(sql); for (const table of rows.filter(r => r.type === 'table')) {
      const inspect = `PRAGMA table_xinfo("${table.name.replaceAll('"', '""')}")`
      if (JSON.stringify(db.prepare(inspect).all()) !== JSON.stringify(fresh.prepare(inspect).all())) throw Error('Baseline schema verification differs')
    } } finally { fresh.close() }
    return statements
  } finally { db.close() }
}
/**
 * Create an immutable schema-baseline directory with archived source and per-dialect rebuild evidence.
 * @param cwd - Trusted workspace root for contract and output containment.
 * @param options - Required relative contract path, newer target version and new output directory; optional local compiler image/time settings.
 * @returns The baseline hash, final directory and sourcePreserved=true.
 * @throws Rejects existing output, unsafe paths, invalid versions/dialects or compilation failures; an incomplete stage may remain for inspection.
 * @remarks May start disposable local Docker databases for PostgreSQL/Oracle. Writes only release artifacts; does not apply/rebase a host database or activate tenants.
 * @example
 * import { writeContractBaseline } from '@alneas/eaos-cli/baseline'
 * export function compileRelease(root: string) { return writeContractBaseline(root, { contract: 'contracts/notes.json', version: '1.1.0', out: 'releases/notes-1.1.0' }) }
 */
export async function writeContractBaseline(cwd: string, options: { 
/**
 * Workspace-relative canonical source contract JSON path, preserved as archived evidence.
 */
contract: string; 
/**
 * Valid target semantic version strictly newer than the source contract release.
 */
version: string; 
/**
 * New workspace-relative output directory for baseline contract, SQL and compiler verification; an existing output is rejected.
 */
out: string } & DatabaseBaselineOptions) {
  const root = resolve(cwd), sourcePath = await safePath(root, options.contract), out = await safePath(root, options.out)
  try{await lstat(out);throw Error('Baseline output already exists')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const contract = JSON.parse(await readFile(sourcePath, 'utf8')) as DataContract
  const dialects=[...new Set(contract.migrations.flatMap(m=>Object.keys(m.sql)))].sort()
  if(!dialects.length||dialects.some(d=>!['sqlite','postgres','oracle'].includes(d)))throw Error('Unsupported baseline dialect')
  // Validate the immutable contract/version before starting any local sandbox.
  createDataContractBaseline(contract,options.version,Object.fromEntries(dialects.map(d=>[d,contract.migrations.flatMap(m=>(m.sql as Record<string,string[]>)[d]??[])])))
  const sql:Record<string,string[]>={},verification:unknown[]=[]
  for(const dialect of dialects){if(dialect==='sqlite'){sql.sqlite=squashSqliteContract(contract);verification.push({dialect,rebuilt:true})}else{const compiled=await squashDatabaseContract(contract,dialect as 'postgres'|'oracle',options);sql[dialect]=compiled.sql;verification.push(compiled.verification)}}
  const baseline = createDataContractBaseline(contract, options.version, sql)
  const stage = out + `.stage-${baseline.hash}`
  await mkdir(dirname(out),{recursive:true})
  await mkdir(stage)
  try {
    await mkdir(join(stage, 'archive'))
    await writeFile(join(stage, 'archive', `${contract.id}-${contract.version}.json`), JSON.stringify(contract, null, 2) + '\n', { flag: 'wx' })
    await writeFile(join(stage, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' })
    await writeFile(join(stage, 'contract.json'), JSON.stringify(baseline.target, null, 2) + '\n', { flag: 'wx' })
    await writeFile(join(stage,'verification.json'),JSON.stringify({format:1,baselineHash:baseline.hash,compilers:verification},null,2)+'\n',{flag:'wx'})
    for(const dialect of dialects)await writeFile(join(stage, `001_baseline_v${options.version}${dialects.length===1?'':'.'+dialect}.sql`),sql[dialect].map(value=>value.trim().replace(/;\s*$/,'')+';'+(dialect==='oracle'&&/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE)\b/i.test(value)?'\n/':'')).join('\n\n')+'\n',{flag:'wx'})
    await rename(stage, out)
  } catch (error) { throw new Error(`Baseline output incomplete at ${stage}; source preserved`, { cause: error }) }
  return { hash: baseline.hash, path: out, sourcePreserved: true }
}

/**
 * Forward the legacy SQLite-named baseline entry to the current all-dialect compiler.
 * @param cwd - Trusted workspace root for contract and output containment.
 * @param options - Required relative contract path, newer target version and new output directory; optional local compiler image/time settings.
 * @returns The baseline hash, final directory and sourcePreserved=true.
 * @throws Rejects existing output, unsafe paths, invalid versions/dialects or compilation failures; an incomplete stage may remain for inspection.
 * @remarks Compatibility entry for writeContractBaseline; compiles every declared supported dialect, not just SQLite. It does not change the canonical implementation.
 * @example
 * import { writeSqliteBaseline } from '@alneas/eaos-cli/baseline'
 * export function compileRelease(root: string) { return writeSqliteBaseline(root, { contract: 'contracts/notes.json', version: '1.1.0', out: 'releases/notes-1.1.0' }) }
 */
export const writeSqliteBaseline=writeContractBaseline
