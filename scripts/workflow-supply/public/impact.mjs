import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
export function packageImpact(root,config,{trusted=false,changes=[]}={}){
 const paths=config.packages;assert(Array.isArray(paths)&&paths.length&&new Set(paths).size===paths.length,'Explicit unique workspace inventory required');
 const workspaces=JSON.parse(readFileSync(join(root,'package.json'))).workspaces;assert(Array.isArray(workspaces),'Unknown workspace topology');const inventory=workspaces.flatMap(path=>path.endsWith('/*')?readdirSync(join(root,path.slice(0,-2)),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.slice(0,-1)+entry.name):[path]);assert.deepEqual([...inventory].sort(),[...paths].sort(),'Workspace inventory changed; update verification contract before selecting');
 const manifests=new Map(paths.map(p=>{assert(!p.startsWith('/')&&!p.split('/').includes('..'),'Invalid workspace path');return [p,JSON.parse(readFileSync(join(root,p,'package.json')))];}));
 const names=new Map([...manifests].map(([p,m])=>[m.name,p]));assert.equal(names.size,paths.length,'Duplicate workspace names');
 const deps=new Map(paths.map(p=>[p,new Set()]));
 const owner=file=>paths.find(p=>file.startsWith(p+'/'));
 for(const [p,m]of manifests){for(const key of ['dependencies','peerDependencies','optionalDependencies','devDependencies'])for(const name of Object.keys(m[key]??{})){const dependency=names.get(name);if(dependency&&dependency!==p)deps.get(p).add(dependency);}
 // Include cross-workspace source imports as well as declared package edges.
 const walk=dir=>{for(const item of readdirSync(join(root,dir),{withFileTypes:true})){if(['node_modules','dist','.git'].includes(item.name))continue;const file=dir+'/'+item.name;if(item.isSymbolicLink())throw Error('Unknown symlink workspace graph');if(item.isDirectory()){walk(file);continue;}if(!/\.[cm]?[jt]sx?$/.test(file))continue;
 const text=readFileSync(join(root,file),'utf8');for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)){const spec=match[1];const target=spec.startsWith('.')?owner(relative(root,resolve(root,dir,spec))):[...names].find(([name])=>spec===name||spec.startsWith(name+'/'))?.[1];if(target&&target!==p)deps.get(p).add(target);}
 }};walk(p);}
 const full=reason=>({full:true,reason,test:[...paths],build:[...paths],omitted:[]});
 if(!trusted)return full('No trusted compatible baseline');
 const touched=new Set();
 for(const item of changes){const file=typeof item==='string'?item:item.file,p=owner(file);if(!p||!(file.slice(p.length+1).startsWith('src/')||/(?:^|\/)(?:src|tests?|__tests__)\//.test(file.slice(p.length+1))||/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)))return full('Shared, manifest, dependency or unknown input changed');touched.add(p);}
 const selected=new Set(touched);let again=true;while(again){again=false;for(const p of paths)if(!selected.has(p)&&[...deps.get(p)].some(d=>selected.has(d))){selected.add(p);again=true;}}
 const builds=new Set(selected);again=true;while(again){again=false;for(const p of [...builds])for(const dep of deps.get(p))if(!builds.has(dep)){builds.add(dep);again=true;}}
 return {full:false,reason:'Changed workspaces and reverse-transitive consumers',test:paths.filter(p=>selected.has(p)),build:paths.filter(p=>builds.has(p)),omitted:paths.filter(p=>!selected.has(p))};
}

export function workspaceTestCommands(selection){return selection.test.map(path=>['bun','run','--cwd',path,'test']);}
export function turboTaskArguments(root,selection,tasks){
 assert(tasks.length&&tasks.every(task=>['build','typecheck','test'].includes(task)),'Unknown selected task');
 if(!selection.test.length)return null;
 return ['scripts/task-runtime.mjs','run',...tasks,...selection.test.map(path=>'--filter='+JSON.parse(readFileSync(join(root,path,'package.json'))).name)];
}
