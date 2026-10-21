import {writeFile,mkdir,rm,realpath} from 'node:fs/promises'
import {resolve,join,relative} from 'node:path'
import type {DefinedPlugin} from '@alneas/eaos-core'
export interface DevClientEntry {entry:string;exportName?:string}
/** Compile only explicitly selected trusted local UI. No server config or secret ports enter the bundle. */
export async function buildDevClient(root:string,client:DevClientEntry,plugin:DefinedPlugin):Promise<Map<string,string>> {
 const bun=(globalThis as any).Bun
 if(!bun?.build)throw Error('Development clients require Bun')
 root=await realpath(root)
 const entry=await realpath(resolve(root,client.entry)),rel=relative(root,entry)
 if(rel.startsWith('..')||rel.startsWith('/'))throw Error('Development client must be inside the plugin project')
 if(client.exportName&&!/^[A-Za-z_$][\w$]*$/.test(client.exportName))throw Error('Invalid client export name')
 const directory=join(root,'.eaos','dev-client-'+crypto.randomUUID())
 await mkdir(directory,{recursive:true})
 const source=join(directory,'entry.tsx'),routes=plugin.routeDefinitions.map(({method,path})=>({method,path}))
 try{
  await writeFile(source,`import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {PluginRuntimeProvider,TenantModuleProvider,createTenantModuleStore} from '@alneas/eaos-react'
import * as component from ${JSON.stringify(entry)}
const id=${JSON.stringify(plugin.id)},routes=${JSON.stringify(routes)},params=new URLSearchParams(location.search)
const tenant=params.get('tenant')??'tenant-a',role=params.get('role')??'member',plan=params.get('plan')??'free'
const headers={'Content-Type':'application/json','X-Eaos-Dev-Tenant':tenant,'X-Eaos-Dev-Role':role,'X-Eaos-Dev-Plan':plan}
const store=createTenantModuleStore(async signal=>{const r=await fetch('/__eaos/persona',{headers,signal});if(!r.ok)throw Error('Persona unavailable');return r.json()})
const runtime={tenantId:tenant,sessionKey:tenant+':'+role+':'+plan,request:async(pluginId,path,input,signal)=>{
 if(pluginId!==id||!/^\\/(?:[a-zA-Z0-9_:-]+\\/?)*$/.test(path))throw Error('Invalid development API scope')
 const candidates=routes.filter(route=>new RegExp('^'+route.path.replace(/:[a-zA-Z0-9_-]+/g,'[^/]+')+'$').test(path)),method=input===undefined?'GET':candidates.some(route=>route.method==='POST')?'POST':candidates.length===1?candidates[0].method:null
 if(!method||!candidates.some(route=>route.method===method))throw Error('Declared API method required')
 const r=await fetch('/api/plugins/'+id+path,{method,headers,signal,...(method==='GET'||method==='DELETE'?{}:{body:JSON.stringify(input)})});const result=await r.json();if(!r.ok)throw Error(result.error??'Request failed');return result
},compute:async(...args)=>{if(typeof component.compute!=='function')throw Error('Register an explicit client compute adapter');return component.compute(...args)}}
if(params.get('surface')==='line')globalThis.liff={init:async()=>{},isInClient:()=>true,isLoggedIn:()=>true,getOS:()=> 'ios',getLanguage:()=> 'ja',getProfile:async()=>({userId:'dev-'+role,displayName:'Local '+role,statusMessage:'Development LIFF mock',pictureUrl:''}),getIDToken:()=>null,getAccessToken:()=>null}
const Page=component[${JSON.stringify(client.exportName??'default')}]
if(!Page||!['function','object'].includes(typeof Page))throw Error('Development UI export is not a component')
createRoot(document.getElementById('root')).render(<TenantModuleProvider store={store}><PluginRuntimeProvider runtime={runtime}><aside><strong>{id}</strong><p>{tenant} / {role} / {plan}</p></aside><Page principal={{tenantId:tenant,userId:'dev-'+role,roles:[role]}} surface={params.get('surface')??'web'}/></PluginRuntimeProvider></TenantModuleProvider>)
void store.refresh()
`)
  const result=await bun.build({entrypoints:[source],target:'browser',format:'esm',naming:'client.[ext]',plugins:[{name:'dev-client-peers',setup(build:any){build.onResolve({filter:/^(?:react(?:-dom)?|@alneas\/eaos-react)(?:\/|$)/},(args:any)=>({path:bun.resolveSync(args.path,root)}))}}],define:{'process.env.NODE_ENV':JSON.stringify('development')}})
  if(!result.success)throw new AggregateError(result.logs,'Development UI compilation failed')
  const assets=new Map<string,string>()
  for(const file of result.outputs)assets.set(file.path.split('/').at(-1)!,await file.text())
  return assets
 }finally{await rm(directory,{recursive:true,force:true})}
}
export function devClientHtml(surface:string){return '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/__eaos/assets/'+surface+'/client.css"><body><p>'+ (surface==='line'?'LINE / LIFF 開発用モック':'Web 開発プレビュー') +'</p><div id="root"></div><script type="module" src="/__eaos/assets/'+surface+'/client.js"></script></body></html>'}
