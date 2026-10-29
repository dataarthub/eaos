import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runPushChecks} from './push-checks.mjs';
test('push performs bounded fresh checks and never builds, tests or stages product artifacts',()=>{
 const commands=[];runPushChecks({run:(bin,args)=>commands.push([bin,...args])});assert(commands.length>=2);assert(commands.some(c=>c.join(' ').includes("secrets:check")));assert(commands.every(c=>!c.some(a=>/^(?:build|test|quality:ci|release:artifact-preflight)(?::|$)/.test(a))));
});
test('an actual child history failure blocks every later push step',()=>{
 const root=mkdtempSync(join(tmpdir(),'eaos-push-check-'));
 try{const bin=join(root,'bin');mkdirSync(bin);const fake=join(bin,'bun');writeFileSync(fake,'#!/bin/sh\nprintf "history\\n" >> "$EAOS_PUSH_LOG"\nexit 19\n');chmodSync(fake,0o755);
 const log=join(root,'calls');const result=spawnSync(process.execPath,[new URL('./push-checks.mjs',import.meta.url).pathname],{cwd:root,env:{...process.env,PATH:bin+':'+process.env.PATH,EAOS_PUSH_LOG:log},encoding:'utf8'});assert.notEqual(result.status,0);assert.equal(readFileSync(log,'utf8'),'history\n');
 }finally{rmSync(root,{recursive:true,force:true})}
});
