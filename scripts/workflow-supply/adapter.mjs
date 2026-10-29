import {URL} from 'node:url';
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
export function contained(root,path,{allowMissing=true,allowGlob=false}={}) {
 assert(typeof path==='string'&&path.length&& !/[\r\n\0\\]/.test(path),'Invalid project path');
 assert(!/[~$!{}?[\]]/.test(path)&&!/^[/]|^[A-Za-z]:/.test(path),'Runtime path expansion is forbidden');
 assert(!path.includes('*')||(allowGlob&&path.split('/').every(part=>!part.includes('*')||part==='*')),'Unsupported project glob');
 const base=realpathSync(root),target=resolve(base,path),rel=relative(base,target);
 assert(rel&&!rel.startsWith('..')&&!rel.startsWith('/'),'Path must stay inside project');
 function visit(current,parts){
  if(!parts.length)return;
  const [part,...rest]=parts;
  if(part==='*'){
   let entries;try{entries=readdirSync(current,{withFileTypes:true});}catch(error){if(error.code==='ENOENT'&&allowMissing)return;throw error;}
   for(const entry of entries){const child=join(current,entry.name);assert(!lstatSync(child).isSymbolicLink(),'Symlink project path is forbidden');if(!rest.length||entry.isDirectory())visit(child,rest);}return;
  }
  const child=join(current,part);try{assert(!lstatSync(child).isSymbolicLink(),'Symlink project path is forbidden');}catch(error){if(error.code!=='ENOENT')throw error;assert(allowMissing,'Missing project file: '+path);}
  visit(child,rest);
 }
 visit(base,rel.split('/'));
 return target;
}
function validate(value,schema,label='$'){
 if(schema.anyOf){assert(schema.anyOf.some(candidate=>{try{validate(value,candidate,label);return true;}catch{return false;}}),'Invalid '+label);return;}
 if(schema.const!==undefined)assert.equal(value,schema.const,'Invalid '+label);
 if(schema.type==='object'){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Expected object '+label);
  for(const required of schema.required??[])assert(Object.hasOwn(value,required),'Missing '+label+'.'+required);
  for(const [key,child] of Object.entries(value)){assert(schema.properties?.[key],'Unknown field '+label+'.'+key);validate(child,schema.properties[key],label+'.'+key);}
 }else if(schema.type==='array'){
  assert(Array.isArray(value)&&value.length>=(schema.minItems??0),'Invalid array '+label);assert(new Set(value.map(x=>JSON.stringify(x))).size===value.length,'Duplicate '+label);
  for(const child of value)validate(child,schema.items,label+'[]');
 }else if(schema.type==='integer')assert(Number.isSafeInteger(value)&&value>0,'Invalid integer '+label);
 else if(schema.type==='string'){assert(typeof value==='string'&&value.length&&!/[\r\n\0]/.test(value),'Invalid string '+label);if(schema.pattern)assert(new RegExp(schema.pattern).test(value),'Invalid '+label);}
}
export function loadAdapter(root,path='.github/workflow-adapter.json'){
 const schema=JSON.parse(readFileSync(new URL('adapter.schema.json',import.meta.url),'utf8'));
 const adapter=JSON.parse(readFileSync(contained(root,path,{allowMissing:false}),'utf8'));validate(adapter,schema);
 assert(!adapter.phases.releaseArchiveVerify||adapter.evidence?.validateScript,'Archive verification requires per-runtime source validation through evidence.validateScript');
 assert(adapter.runtime.nodeVersions.includes(adapter.release.primaryNode),'Primary release runtime is absent');
 assert(adapter.runtime.nodeVersions.every(n=>n>=24),'Node.js 24 or later is required');
 for(const path of [adapter.release.outputDirectory,adapter.release.downloadDirectory,adapter.cache?.taskDirectory].filter(Boolean))contained(root,path);
 for(const path of [...adapter.cache?.distributionPaths??[],...adapter.cache?.toolingPaths??[]])contained(root,path,{allowGlob:true});
 for(const name of adapter.vars??[])assert(!['NODE_AUTH_TOKEN','GH_TOKEN','GITHUB_TOKEN','NODE_OPTIONS','FORCE_JAVASCRIPT_ACTIONS_TO_NODE24'].includes(name)&&!name.startsWith('GITHUB_')&&!name.startsWith('RUNNER_')&&!name.startsWith('WORKFLOW_'),'Reserved shared environment variable: '+name);
 if(adapter.runtime.goVersionFile)contained(root,adapter.runtime.goVersionFile,{allowMissing:false});
 const scripts=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts??{};
 for(const command of [...Object.values(adapter.setup),...Object.values(adapter.phases),...[adapter.evidence?.recordScript,adapter.evidence?.validateScript].filter(Boolean),...Object.values(adapter.verification??{}),...Object.values(adapter.localPublication??{})]){
  if(typeof command==='string')assert(Object.hasOwn(scripts,command),'Missing package script '+command);
  else {
   assert(['node','bun','python3'].includes(command[0]),'Unsupported phase executable');
   const builtin=command[0]==='bun'&&['install','run','x','pm','test','build'].includes(command[1]);
   if(command[0]==='bun'&&command[1]==='run')assert(Object.hasOwn(scripts,command[2]),'Missing package script '+command[2]);
   if(command[1]&&!command[1].startsWith('-')&&!builtin)contained(root,command[1],{allowMissing:false});
  }
 }
 return adapter;
}
