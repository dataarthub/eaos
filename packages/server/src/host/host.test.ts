import {test,expect} from 'bun:test'
import {Hono} from 'hono'
import {createStandardHost} from './index'
import {hostFixture,fixtureManifest} from './fixtures'
test('startup preserves auth membership module and route ordering, exact/nested lifecycle gates and revocation',async()=>{
 const f=hostFixture();try{
  const {app,context}=await createStandardHost(f.options)
  expect((await f.request(app,'/api/a')).status).toBe(200)
  expect(f.order.slice(0,3)).toEqual(['auth','membership:fixture-v1','modules']);expect(f.order.at(-1)).toBe('handler')
  expect((await f.request(app,'/api/a/nested')).status).toBe(200)
  f.setActive(false);expect((await f.request(app,'/api/a')).status).toBe(403);expect((await f.request(app,'/api/a/nested')).status).toBe(403)
  expect(await context.isPluginEnabled('tenant','a')).toBe(false)
  expect((await app.request('/api/a')).status).toBe(401)
  expect((await app.request('/health')).status).toBe(200)
 }finally{f.db.close()}
})
test('invalid metadata rejects before runtime construction and failed initialization returns no app',async()=>{
 const f=hostFixture();let calls=0;try{
  f.options.adoption.pluginIds=['unknown'];f.options.runtime.loadLifecycle=async()=>{calls++;return f.lifecycle}
  await expect(createStandardHost(f.options)).rejects.toThrow();expect(calls).toBe(0)
  f.options.adoption.pluginIds=[];f.options.runtime.loadLifecycle=async()=>{throw Error('offline')}
  await expect(createStandardHost(f.options)).rejects.toThrow('offline')
  f.options.runtime.loadLifecycle=async()=>f.lifecycle;f.options.createRoutes=async()=>{throw Error('route failed')}
  await expect(createStandardHost(f.options)).rejects.toThrow('route failed')
 }finally{f.db.close()}
})
test('empty selection and separate instances do not gain executable routes or fallback admission',async()=>{
 const a=hostFixture(),b=hostFixture();try{
  a.options.adoption.pluginIds=[];b.options.runtime.loadLifecycle=async()=>undefined
  const [empty,missing]=await Promise.all([createStandardHost(a.options),createStandardHost(b.options)])
  expect(empty.context.manifests).toHaveLength(0);expect(missing.context.manifests).toHaveLength(1)
  expect((await a.request(empty.app,'/api/a')).status).toBe(404)
  expect((await b.request(missing.app,'/api/a')).status).toBe(403)
 }finally{a.db.close();b.db.close()}
})
test('tenant-dispatched extension routes preserve verified context and forbid omitted or foreign modules',async()=>{
 const f=hostFixture();try{
  const extension={apiVersion:1 as const,id:'private',tenantIds:['tenant'],manifests:[fixtureManifest('private')],routeFactories:{private:()=>new Hono().get('/',c=>c.text('private'))},routes:[{prefix:'/extra',moduleId:'private',router:new Hono().get('/',c=>c.json({tenant:c.get('tenantId'),binding:c.env?.binding}))}]}
  f.options.adoption.extensions=[extension]
  const {app}=await createStandardHost(f.options)
  const response=await app.request('/extra',{headers:{Authorization:'Bearer valid'}},{binding:'server'})
  expect(response.status).toBe(200);expect(await response.json()).toEqual({tenant:'tenant',binding:'server'})
  extension.tenantIds.push('foreign') // cannot widen the prepared metadata
  f.setActive(false);expect((await f.request(app,'/extra')).status).toBe(403)
  f.options.adoption.pluginIds=['a'];const omitted=await createStandardHost(f.options)
  expect((await f.request(omitted.app,'/extra')).status).toBe(404)
 }finally{f.db.close()}
})
test('an asynchronous startup snapshots its settings and adapters before awaiting services',async()=>{
 const f=hostFixture();let release!:()=>void
 const barrier=new Promise<void>(resolve=>{release=resolve})
 f.options.runtime.loadLifecycle=async()=>{await barrier;return f.lifecycle}
 try{
  const pending=createStandardHost(f.options)
  f.options.app.releaseVersion='changed';f.options.auth.verifier={verifySession:async()=>({valid:false})}
  release();const {app}=await pending;const response=await f.request(app,'/api/a')
  expect(response.status).toBe(200);expect(response.headers.get('X-EAOS-Release')).toBe('fixture-v1')
 }finally{f.db.close()}
})
