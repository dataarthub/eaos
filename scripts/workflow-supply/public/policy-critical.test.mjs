import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectCritical,inspectArchive,selectPolicyProbes} from './policy-critical.mjs';
function fixture(work){const root=mkdtempSync(join(tmpdir(),'public-policy-'));const put=(file,text)=>{mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),typeof text==='string'?text:JSON.stringify(text));};try{
 execFileSync('git',['init','-q'],{cwd:root});put('package.json',{private:true,workspaces:['packages/*'],scripts:{'quality:commit':'node staged.mjs','quality:push':'node push.mjs'}});put('.gitignore','.verification/\n.cache/\nnode_modules\n');put('docs.manifest.json',{documents:[{source:'docs/guide.md'}]});put('packages/core/package.json',{name:'@example/core',version:'1.0.0',files:['dist'],exports:{'.':'./dist/index.js'}});put('packages/core/src/index.ts','export const value = 1;\n');symlinkSync(join(process.env.PUBLIC_POLICY_TEST_TOOLS??process.cwd(),'node_modules'),join(root,'node_modules'));return work({root,put});
}finally{rmSync(root,{recursive:true,force:true});}}
const violations=root=>inspectCritical(root).violations;
test('private dev/peer dependencies and external file links block public conformance',()=>fixture(({root,put})=>{
 assert.deepEqual(violations(root),[]);put('packages/core/package.json',{name:'@example/core',devDependencies:{'@example/core-private':'1.0.0'},peerDependencies:{[['@dataarthub','internal'].join('/')]: '1.0.0'},dependencies:{other:'file:../../../sibling'}});const found=violations(root);assert.equal(found.filter(x=>x.id==='boundary.public').length,3);
}));
test('AST inspection finds private export/require/type/dynamic imports but ignores explanatory strings and comments',()=>fixture(({root,put})=>{
 put('packages/core/src/index.ts',`// import x from '@example/x-private';\nconst explanation="@example/x-private";\nexport {value} from '@example/x-private';\nconst a=require('@example/y-private');\ntype T=import('@example/z-private').T;\nasync function load(){return import('../../../../app-private/source.js');}\n`);assert.equal(violations(root).filter(x=>x.id==='boundary.public').length,4);
}));
test('public source aliases and symlinks may not escape the repository',()=>fixture(({root,put})=>{
 put('tsconfig.json',{compilerOptions:{paths:{hidden:['../private/src/*']}}});symlinkSync(tmpdir(),join(root,'packages/core/src/escape'));assert(violations(root).some(x=>x.id==='boundary.alias'));assert(violations(root).some(x=>x.id==='boundary.symlink'));
}));
test('operational receipts cannot enter docs manifests or broad upload paths',()=>fixture(({root,put})=>{
 put('docs.manifest.json',{documents:[{source:'.verification/logs/check.txt'}]});put('scripts/workflow-project/roles.json',{source:{jobs:{verify:{steps:[{uses:'actions/upload-artifact@v7',with:{path:'.verification/**'}}]}}}});assert(violations(root).some(x=>x.id==='evidence.public'));assert(violations(root).some(x=>x.id==='evidence.upload'));
}));
test('evidence exclusion is checked through Git semantics and is never repaired',()=>fixture(({root,put})=>{
 put('.gitignore','node_modules/\n');const before=readFileSync(join(root,'.gitignore'),'utf8');assert(violations(root).some(x=>x.id==='evidence.ignored'));assert.equal(readFileSync(join(root,'.gitignore'),'utf8'),before);
}));
test('actual tarball inspection rejects hidden logs, environment files and traversal without extraction',()=>fixture(({root,put})=>{
 put('package/package.json',{name:'@example/core',version:'1.0.0'});put('package/dist/index.js','export const value=1;');const archive=join(root,'good.tgz');execFileSync('tar',['-czf',archive,'package'],{cwd:root});assert.equal(inspectArchive(archive).violations.length,0);
 put('package/.verification/logs/raw.log','private diagnostics');put('package/.env','TOKEN=placeholder');const bad=join(root,'bad.tgz');execFileSync('tar',['-czf',bad,'package'],{cwd:root});assert(inspectArchive(bad).violations.length>=2);
}));
test('ordinary prose selects no dynamic probes; shared changes select the bounded policy probes',()=>{
 assert.deepEqual(selectPolicyProbes(['docs/guide.md']),[]);assert.deepEqual(selectPolicyProbes(['packages/core/src/index.ts']),[]);assert.deepEqual(selectPolicyProbes(['scripts/workflow-supply/public/policy-critical.mjs']),['commit']);assert.deepEqual(selectPolicyProbes(null),['commit']);
});

test('conditional package aliases and root entrypoints cannot hide private dependencies',()=>fixture(({root,put})=>{put('package.json',{private:true,imports:{'#hidden':{node:['./ok.js',{default:'@example/eaos-private'}]}}});put('index.ts',"export * from '@example/eaos-private';\n");assert(violations(root).some(v=>v.id==='boundary.alias'));assert(violations(root).some(v=>v.file==='index.ts'&&v.id==='boundary.public'));}));
test('TypeScript import-equals and npm aliases cannot hide private targets',()=>fixture(({root,put})=>{put('packages/core/package.json',{name:'@example/core',dependencies:{hidden:'npm:@example/eaos-private@1.0.0'}});put('index.ts',"import hidden = require('@example/eaos-private'); export = hidden;\n");const found=violations(root);assert(found.some(v=>v.file==='index.ts'));assert(found.some(v=>v.file==='packages/core/package.json'));}));
