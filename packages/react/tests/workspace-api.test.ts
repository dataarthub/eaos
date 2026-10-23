import {expect,test} from 'bun:test'
import {createWorkspaceApi,WorkspaceApiError} from '../src/client/workspace-api'

test('same_origin_and_https_endpoints preserve credentialed cancellable JSON requests',async()=>{
 for(const endpoint of ['/api/plugins','https://app.example.test/api/plugins/']){
  const calls:{url:string;init:RequestInit}[]=[]
  const api=createWorkspaceApi({endpoint,fetch:async(input,init)=>{calls.push({url:String(input),init:init??{}});return Response.json({revision:3})}})
  const signal=new AbortController().signal
  expect(await api.command({pluginId:'records',operation:'update/name',input:{revision:2},signal})).toEqual({revision:3})
  expect(calls[0].url).toBe(endpoint.replace(/\/$/,'')+'/records/update%2Fname')
  expect(calls[0].init).toMatchObject({method:'POST',credentials:'include',redirect:'error',cache:'no-store',body:'{"revision":2}'})
  expect(calls[0].init.signal?.aborted).toBe(false)
  expect(new Headers(calls[0].init.headers).get('X-EAOS-Request')).toBe('plugin-command')
  await api.request({pluginId:'records',path:'/items/a%2Fb',method:'PUT',body:{revision:3},signal})
  expect(calls[1].url).toBe(endpoint.replace(/\/$/,'')+'/records/items/a%2Fb')
 }
})
test('unsafe_suffix_and_endpoints_rejected before fetch',async()=>{
 for(const endpoint of ['//evil.test/api','http://app.test/api','https://user:pass@app.test/api','/api?token=x','/api#x','/api/../other','/api\\other'])expect(()=>createWorkspaceApi({endpoint})).toThrow()
 let calls=0
 const api=createWorkspaceApi({endpoint:'/api/plugins',fetch:async()=>{calls++;return Response.json({})}})
 for(const path of ['//evil.test','/../admin','/%2e%2e/admin','/%252e%252e/admin','/a/..','/a\\b','/a?x=1','/a#x','/%zz'])await expect(api.request({pluginId:'records',path})).rejects.toThrow()
 expect(calls).toBe(0)
})
test('json_and_http_errors_remain_failures without response body leakage',async()=>{
 for(const status of [403,409]){
  const api=createWorkspaceApi({endpoint:'/api/plugins',fetch:async()=>Response.json({error:'private infrastructure detail'},{status})})
  try{await api.request({pluginId:'records',path:'/'});throw Error('accepted')}catch(error){expect(error).toBeInstanceOf(WorkspaceApiError);expect(error).toMatchObject({status});expect(String(error)).not.toContain('private infrastructure detail')}
 }
 const malformed=createWorkspaceApi({endpoint:'/api/plugins',fetch:async()=>new Response('{')})
 await expect(malformed.request({pluginId:'records',path:'/'})).rejects.toThrow()
})
test('aborted request rejects even when fetch ignores cancellation',async()=>{
 const controller=new AbortController()
 const api=createWorkspaceApi({endpoint:'/api/plugins',fetch:async()=>{controller.abort();return Response.json({secret:'old'})}})
 await expect(api.request({pluginId:'records',path:'/',signal:controller.signal})).rejects.toThrow()
})
test('cancellation settles a stalled injected transport',async()=>{
 const controller=new AbortController()
 const api=createWorkspaceApi({endpoint:'/api/plugins',timeoutMs:25,fetch:()=>new Promise(()=>{})})
 const result=api.request({pluginId:'records',path:'/',signal:controller.signal}).catch(error=>error)
 controller.abort()
 expect(await Promise.race([result,Bun.sleep(50).then(()=>'still pending')])).toBeInstanceOf(Error)
})
test('origin-only HTTPS endpoints and percent-containing record IDs are valid',async()=>{
 const urls:string[]=[]
 const api=createWorkspaceApi({endpoint:'https://app.example.test',fetch:async input=>{urls.push(String(input));return Response.json({})}})
 await api.request({pluginId:'records',path:'/items/a%25b'})
 expect(urls).toEqual(['https://app.example.test/records/items/a%25b'])
})
