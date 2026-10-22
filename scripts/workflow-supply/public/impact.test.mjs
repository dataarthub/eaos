import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {packageImpact} from './impact.mjs';
function fixture(work){const root=mkdtempSync(join(tmpdir(),'package-impact-'));const config={packages:['packages/core','packages/adapter','packages/ui']};writeFileSync(join(root,'package.json'),JSON.stringify({workspaces:config.packages}));try{for(const id of ['core','adapter','ui']){mkdirSync(join(root,'packages',id,'src'),{recursive:true});writeFileSync(join(root,'packages',id,'package.json'),JSON.stringify({name:'@fixture/'+id,peerDependencies:id==='adapter'?{'@fixture/core':'*'}:{},scripts:{test:'node test.mjs'}}));}return work(root,config);}finally{rmSync(root,{recursive:true,force:true});}}
test('package tests include reverse transitive peer consumers and omit unrelated packages',()=>fixture((root,config)=>{
 assert.deepEqual(packageImpact(root,config,{trusted:true,changes:['packages/core/src/a.ts']}).test,['packages/core','packages/adapter']);
 assert.deepEqual(packageImpact(root,config,{trusted:true,changes:['packages/adapter/src/a.ts']}).test,['packages/adapter']);
 assert.deepEqual(packageImpact(root,config,{trusted:true,changes:['packages/ui/src/a.test.ts']}).test,['packages/ui']);
}));
test('cross-workspace relative source imports add otherwise undeclared consumer edges',()=>fixture((root,config)=>{
 writeFileSync(join(root,'packages/ui/src/a.ts'),"export {x} from '../../core/src/a';");assert.deepEqual(packageImpact(root,config,{trusted:true,changes:['packages/core/src/a.ts']}).test,config.packages);
}));
test('unknown paths, package metadata and untrusted evidence fall back to full coverage',()=>fixture((root,config)=>{
 for(const changes of [['bun.lock'],['package.json'],['packages/core/package.json'],['packages/core/tsconfig.json'],['scripts/helper.mjs'],['unknown.ts']])assert.deepEqual(packageImpact(root,config,{trusted:true,changes}).test,config.packages);
 assert.deepEqual(packageImpact(root,config,{trusted:false,changes:['packages/ui/src/a.ts']}).test,config.packages);
 assert.deepEqual(packageImpact(root,config,{trusted:true,changes:[]}).test,[]);
}));
test('deleted source paths still select owners and consumers',()=>fixture((root,config)=>{assert.deepEqual(packageImpact(root,config,{trusted:true,changes:['packages/core/src/deleted.ts']}).test,['packages/core','packages/adapter']);}));
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {workspaceTestCommands} from './impact.mjs';
test('real selected workspace scripts execute without running an unrelated failing test',()=>fixture((root,config)=>{
 for(const id of ['core','adapter','ui']){const file=join(root,'packages',id,'package.json'),manifest=JSON.parse(readFileSync(file));manifest.scripts.test='node test.mjs';writeFileSync(file,JSON.stringify(manifest));writeFileSync(join(root,'packages',id,'test.mjs'),id==='ui'?'process.exit(19);':"import{writeFileSync}from'node:fs';writeFileSync('tested','yes');");}
 const selection=packageImpact(root,config,{trusted:true,changes:['packages/core/src/changed.ts']});
 for(const [command,...args]of workspaceTestCommands(selection))assert.equal(spawnSync(command,args,{cwd:root}).status,0);
 assert.equal(readFileSync(join(root,'packages/core/tested'),'utf8'),'yes');assert.equal(readFileSync(join(root,'packages/adapter/tested'),'utf8'),'yes');
 const ui=packageImpact(root,config,{trusted:true,changes:['packages/ui/src/changed.ts']});const [command,...args]=workspaceTestCommands(ui)[0];assert.equal(spawnSync(command,args,{cwd:root}).status,19);
}));

test('a newly added workspace cannot silently escape the verification inventory',()=>fixture((root,config)=>{const manifest=JSON.parse(readFileSync(join(root,'package.json')));manifest.workspaces.push('packages/new');writeFileSync(join(root,'package.json'),JSON.stringify(manifest));assert.throws(()=>packageImpact(root,config,{trusted:true,changes:['packages/core/src/a.ts']}),/inventory changed/);}));
