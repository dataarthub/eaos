import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,symlinkSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
function fixture(work){const root=mkdtempSync(join(tmpdir(),'eaos-workflow-adapter-'));try{
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});git(['init','-q']);mkdirSync(join(root,'scripts'));mkdirSync(join(root,'node_modules/.bin'),{recursive:true});copyFileSync(new URL('./workflow-adapter.mjs',import.meta.url),join(root,'scripts/workflow-adapter.mjs'));
 symlinkSync(realpathSync(new URL('../node_modules/.bin/biome',import.meta.url)),join(root,'node_modules/.bin/biome'));
 writeFileSync(join(root,'scripts/quality-tools.mjs'),"export const gitleaksVersion='fixture';export const localGitleaks=new URL('../gitleaks.mjs',import.meta.url).pathname;\n");
 writeFileSync(join(root,'gitleaks.mjs'),`#!${process.execPath}\nif(process.argv[2]==='version'){console.log('fixture');}else if(process.env.FIXTURE_SCAN_FAIL){console.error('dummy-scanner-sensitive-output');process.exitCode=1;}else console.log('[]');\n`,{mode:0o755});
 copyFileSync(new URL('../biome.json',import.meta.url),join(root,'biome.json'));writeFileSync(join(root,'.gitleaks.toml'),'title="fixture"\n');writeFileSync(join(root,'.gitignore'),'node_modules/\n');git(['add','biome.json','.gitleaks.toml','.gitignore']);return work({root,git});
}finally{rmSync(root,{recursive:true,force:true});}}
const invoke=(root,phase,patch={})=>spawnSync(process.execPath,['scripts/workflow-adapter.mjs',phase],{cwd:root,encoding:'utf8',env:{...process.env,...patch}});
test('commit verification checks index bytes and preserves partially staged working changes',()=>fixture(({root,git})=>{
 writeFileSync(join(root,'change.ts'),'debugger;\n');git(['add','change.ts']);writeFileSync(join(root,'change.ts'),'export const safe = true;\n');const before=git(['diff','--cached']);
 const result=invoke(root,'commit');assert.notEqual(result.status,0,'staged debugger must block despite clean unstaged code');assert.equal(readFileSync(join(root,'change.ts'),'utf8'),'export const safe = true;\n');assert.equal(git(['diff','--cached']),before);
}));
test('a scanner failure blocks commit without exposing scanner diagnostics',()=>fixture(({root})=>{
 const result=invoke(root,'commit',{FIXTURE_SCAN_FAIL:'1'});assert.notEqual(result.status,0);assert(!result.stderr.includes('dummy-scanner-sensitive-output'));
}));
test('documentation-only verification still enforces release-impact and propagates failure',()=>fixture(({root})=>{
 mkdirSync(join(root,'bin'));writeFileSync(join(root,'bin/bun'),'#!/bin/sh\nif [ "$2" = "check:release-impact" ]; then exit 23; fi\nexit 0\n',{mode:0o755});
 const result=invoke(root,'documentation-safety',{PATH:join(root,'bin')+':'+process.env.PATH});assert.notEqual(result.status,0);assert.match(result.stderr,/Documentation safety gate failed: check:release-impact/);
}));
test('clean staged code and indexed configuration pass without rewriting source',()=>fixture(({root,git})=>{
 writeFileSync(join(root,'clean.ts'),'export const safe = true;\n');git(['add','clean.ts']);const before=git(['diff','--cached']);const result=invoke(root,'commit');assert.equal(result.status,0,result.stderr);assert.equal(git(['diff','--cached']),before);
}));
