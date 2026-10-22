import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {localGitleaks} from './quality-tools.mjs';
test('verification cache hashes are excluded while actual source secret patterns still stop the gate',()=>{
 const root=mkdtempSync(join(tmpdir(),'eaos-secret-cache-'));
 try{mkdirSync(join(root,'scripts'));for(const name of ['check-secrets.mjs','quality-tools.mjs'])copyFileSync(new URL(name,import.meta.url),join(root,'scripts',name));copyFileSync(new URL('../.gitleaks.toml',import.meta.url),join(root,'.gitleaks.toml'));mkdirSync(join(root,'.cache/public-quality/tasks'),{recursive:true});const marker='ghp_'+createHash('sha256').update(randomUUID()).digest('hex').slice(0,36);writeFileSync(join(root,'.cache/public-quality/tasks/result.json'),JSON.stringify({key:marker}));writeFileSync(join(root,'source.js'),'export const value=1;');
 const run=()=>spawnSync(process.execPath,['scripts/check-secrets.mjs'],{cwd:root,env:{...process.env,EAOS_GITLEAKS_BINARY:resolve(localGitleaks)},encoding:'utf8'});assert.equal(run().status,0,'Generated verifier cache must not enter source scan');
 writeFileSync(join(root,'source.js'),'export const credential='+JSON.stringify(marker)+';');assert.equal(run().status,1,'Source patterns must still fail');const report=JSON.parse(readFileSync(join(root,'.verification/logs/secrets.json')));assert(report.some(item=>item.File.endsWith('source.js')));assert(report.every(item=>!item.Secret.includes(marker)),'Scanner diagnostics must redact matched bytes');
 }finally{rmSync(root,{recursive:true,force:true});}
});
