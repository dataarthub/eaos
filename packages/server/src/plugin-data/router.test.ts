import {test,expect} from 'bun:test'
import {createPluginRouter} from './index'
const principal={tenantId:'t',userId:'u',roles:['ADMIN']}
test('default operation body bound stays small; explicitly opted private media route is bounded and authenticated',async()=>{
 const make=(maxBodyBytes?:number)=>{const app=createPluginRouter(async()=>principal,{maxBodyBytes});app.post('/upload',async c=>c.json({length:(await c.req.text()).length}));return app}
 const body='x'.repeat(200000),req=()=>new Request('http://local/upload',{method:'POST',body})
 expect((await make().fetch(req())).status).toBe(413)
 expect(await (await make(4*1024*1024).fetch(req())).json()).toEqual({length:body.length})
 expect((await make(200000).fetch(new Request('http://local/upload',{method:'POST',body:body+'x'}))).status).toBe(413)
 expect(()=>make(Infinity)).toThrow();expect(()=>make(9*1024*1024)).toThrow()
 const denied=createPluginRouter(async()=>null,{maxBodyBytes:4*1024*1024});denied.post('/upload',c=>c.text('never'));expect((await denied.fetch(req())).status).toBe(401)
})
