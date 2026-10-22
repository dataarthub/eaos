import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,rmSync,lstatSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {contained} from '../adapter.mjs';
import {render} from './render.mjs';
const bundleFiles=['adapter.mjs','public/render.mjs','public/supply.mjs','public/quality.mjs','public/evidence.mjs','public/supply.test.mjs','public/quality.test.mjs','public/evidence.test.mjs','public/approval.mjs','public/approval.test.mjs','public/conformance.mjs','public/conformance.test.mjs','public/requirements.json','public/fixtures.mjs','public/impact.mjs','public/impact.test.mjs'];
const dest='scripts/workflow-supply',manifestPath='.github/workflow-supply.json';
const digest=b=>createHash('sha256').update(b).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
export function load(root){const a=json(contained(root,'.github/workflow-adapter.json',{allowMissing:false}));
 assert(a.schemaVersion===1&&a.distribution==='npm','Expected public npm adapter');assert(/^[\w.-]+\/[\w.-]+$/.test(a.repository),'Invalid repository');
 assert(a.runtime?.nodeVersions?.length&&a.runtime.nodeVersions.every(n=>Number.isInteger(n)&&n>=24),'Supported Node runtimes required');
 assert(/^\d+\.\d+\.\d+$/.test(a.runtime.bunVersion),'Pinned Bun required');
 const p=json(contained(root,a.project,{allowMissing:false}));return {adapter:a,project:p};}
function inventory(source){return Object.fromEntries(bundleFiles.map(f=>[f,digest(readFileSync(contained(source,f,{allowMissing:false})))]));}
function manifest(root){const m=json(contained(root,manifestPath,{allowMissing:false}));assert(m.schemaVersion===2&&m.distribution==='npm'&&m.upstream==='github-docs/public/templates/private-actions/public','Invalid public supply provenance');assert(/^[a-f0-9]{40}$/.test(m.reviewedRevision)&&m.sourceState==='local-reviewed','Invalid reviewed revision');assert.deepEqual(Object.keys(m.files),bundleFiles,'Invalid bundle inventory');assert.deepEqual(inventory(contained(root,dest,{allowMissing:false})),m.files,'Workflow supply bundle digest changed');assert.equal(m.bundleSha256,digest(JSON.stringify(m.files)),'Bundle digest mismatch');return m;}
function desired(root,m){const {adapter,project}=load(root);const header=`# Generated: ${m.upstream}; reviewed base ${m.reviewedRevision} (local-reviewed).\n# Bundle SHA-256: ${m.bundleSha256}\n# Project adapter: .github/workflow-adapter.json; source: ${adapter.project}\n# Run workflow:generate explicitly; workflow:check never repairs output.\n`;return new Map([...render(adapter,project)].map(([f,s])=>[f,header+s]));}
function write(root,writes){
 const backups=new Map();for(const [file]of writes){const p=contained(root,file);if(existsSync(p))assert(lstatSync(p).isFile(),'Destination must be regular');backups.set(p,existsSync(p)?readFileSync(p):null);}
 const done=[];try{for(const [file,bytes]of writes){const p=contained(root,file);mkdirSync(dirname(p),{recursive:true});const tmp=p+'.'+randomUUID()+'.tmp';try{writeFileSync(tmp,bytes,{flag:'wx'});renameSync(tmp,p);done.push(p);}finally{rmSync(tmp,{force:true});}}}catch(e){for(const p of done.reverse()){const b=backups.get(p);if(b===null)rmSync(p,{force:true});else writeFileSync(p,b);}throw e;}
}
export function install(root,{source=resolve(import.meta.dirname,'..'),reviewedRevision,adoptExisting=false}={}){
 assert(/^[a-f0-9]{40}$/.test(reviewedRevision??''),'Reviewed base commit required');
 const files=inventory(source),m={schemaVersion:2,distribution:'npm',upstream:'github-docs/public/templates/private-actions/public',reviewedRevision,sourceState:'local-reviewed',files,bundleSha256:digest(JSON.stringify(files)),outputs:{}};
 const outputs=desired(root,m),old=existsSync(join(root,manifestPath))?manifest(root):null;
 for(const file of [...outputs.keys(),...bundleFiles.map(f=>dest+'/'+f),manifestPath])if(existsSync(contained(root,file)))assert(old&&(file===manifestPath||Object.hasOwn(old.outputs,file)||bundleFiles.some(f=>dest+'/'+f===file))||adoptExisting&&outputs.has(file),'Explicit adoption required for unmanaged workflow/supply '+file);
 m.outputs=Object.fromEntries([...outputs].map(([f,b])=>[f,digest(b)]));const writes=new Map(bundleFiles.map(f=>[dest+'/'+f,readFileSync(contained(source,f,{allowMissing:false}))]));for(const pair of outputs)writes.set(...pair);writes.set(manifestPath,JSON.stringify(m,null,2)+'\n');write(root,writes);
}
export function check(root){const m=manifest(root),outputs=desired(root,m);assert.deepEqual([...outputs.keys()].sort(),Object.keys(m.outputs).sort(),'Managed role inventory changed; adopt explicitly');const drift=(load(root).adapter.retiredWorkflows??[]).filter(f=>existsSync(contained(root,f)));for(const [f,b]of outputs)if(!existsSync(contained(root,f))||readFileSync(contained(root,f),'utf8')!==b||m.outputs[f]!==digest(b))drift.push(f);return drift;}
export function generate(root){const m=manifest(root),outputs=desired(root,m);assert.deepEqual([...outputs.keys()].sort(),Object.keys(m.outputs).sort(),'Managed role inventory changed');m.outputs=Object.fromEntries([...outputs].map(([f,b])=>[f,digest(b)]));outputs.set(manifestPath,JSON.stringify(m,null,2)+'\n');write(root,outputs);}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{
 const [command,...args]=process.argv.slice(2);const rootIndex=args.indexOf('--project-root'),revIndex=args.indexOf('--reviewed-revision');const root=resolve(rootIndex<0?'.':args[rootIndex+1]);
 if(command==='install')install(root,{reviewedRevision:args[revIndex+1],adoptExisting:args.includes('--adopt-existing')});else if(command==='generate')generate(root);else if(command==='check'){const drift=check(root);assert(!drift.length,'Generated workflow drift: '+drift.join(', '));}else throw Error('Use install, generate or check');console.log('Public workflow supply '+command+' passed.');
}catch(e){console.error(e.message);process.exitCode=1;}}
