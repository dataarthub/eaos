import {test,expect} from 'bun:test'
import {canonicalOracleDdl,oracleMetadataStatements} from './baseline-oracle-metadata'
test('Oracle trigger enablement is a separate SQL statement after its PL/SQL definition',()=>{
 const body='CREATE OR REPLACE TRIGGER "GUARD" BEFORE INSERT ON "RECORDS" BEGIN NULL; END;'
 expect(oracleMetadataStatements({kind:'TRIGGER',ddl:body+'\nALTER TRIGGER "GUARD" ENABLE'})).toEqual([body,'ALTER TRIGGER "GUARD" ENABLE'])
 expect(oracleMetadataStatements({kind:'TRIGGER',ddl:body+'\n/\nALTER TRIGGER "GUARD" DISABLE;'})).toEqual([body,'ALTER TRIGGER "GUARD" DISABLE'])
})
test('Oracle comparison ignores only independent constraint order while preserving columns, quoted commas and defaults',()=>{
 const a=`CREATE TABLE "RECORDS" ("ID" NUMBER, "LABEL" VARCHAR2(80) DEFAULT 'a,b', PRIMARY KEY("ID"), CHECK ("ID">0))`
 const b=`CREATE TABLE "RECORDS" ("ID" NUMBER, "LABEL" VARCHAR2(80) DEFAULT 'a,b', CHECK ("ID">0), PRIMARY KEY("ID"))`
 expect(canonicalOracleDdl(a)).toEqual(canonicalOracleDdl(b))
 expect(canonicalOracleDdl(a)).not.toEqual(canonicalOracleDdl(b.replace('>0','>=0')))
 expect(canonicalOracleDdl(a)).not.toEqual(canonicalOracleDdl(b.replace("'a,b'","'a,c'")))
 expect(canonicalOracleDdl('CREATE INDEX "I" ON "RECORDS"("ID")')).toBe('CREATE INDEX "I" ON "RECORDS"("ID")')
})
