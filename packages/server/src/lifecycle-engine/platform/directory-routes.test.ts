import {expect,test} from 'bun:test'
import {Hono} from 'hono'
import {createUserDirectoryRoutes} from './directory-routes'

function fixture(){
 const calls:any[]=[],identity={userId:'verified',displayName:'Account name',email:'account@example.test',memberships:[{tenantId:'one',role:'admin',active:true}],isPlatformAdmin:false}
 let userId='verified',fail=false
 const repository={ensureAccount:async(input:any)=>{calls.push(['ensure',input]);return{id:'person',name:input.displayName,created:true}},list:async(tenant:string)=>{calls.push(['list',tenant]);return[]},create:async(tenant:string,input:any)=>{calls.push(['create',tenant,input]);return{id:'contact',name:input.name,created:true}},update:async(tenant:string,id:string,input:any)=>{calls.push(['update',tenant,id,input]);return id!=='foreign'}}
 const app=new Hono<any>();app.use('*',async(c,next)=>{c.set('userId',userId);c.set('tenantId','one');await next()})
 app.route('/api/user',createUserDirectoryRoutes({enabled:true,membershipSource:'kratos',origins:['https://app.example.test'],readIdentity:async()=>{if(fail)throw Error('provider unavailable');return identity},resolveRepository:async()=>repository}))
 const send=(path:string,data?:unknown,method=data===undefined?'GET':'POST',origin='https://app.example.test')=>app.request('/api/user'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-EAOS-Request':'user-directory'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 return{identity,calls,send,setUser:(id:string)=>{userId=id},fail:()=>{fail=true}}
}
test('directory routes validate explicit contacts without granting account authority',async()=>{
 const f=fixture()
 expect((await f.send('/directory',{name:'Partner contact',kinds:['partner_contact'],organizationName:'Partner'})).status).toBe(201)
 expect(f.calls[0]).toEqual(['create','one',{name:'Partner contact',kinds:['partner_contact'],organizationName:'Partner'}])
 for(const value of [{name:'X',role:'admin'},{name:'X',identityId:'other'},{name:'X',tenantId:'other'},{name:'X',kinds:['administrator']},{kinds:['other']},{name:'X',email:'invalid'}])expect((await f.send('/directory',value)).status).toBe(400)
 expect(f.calls).toHaveLength(1)
 expect((await f.send('/directory/contact',{department:'Operations'},'PATCH')).status).toBe(200)
 expect(f.calls[1]).toEqual(['update','one','contact',{department:'Operations'}])
 expect((await f.send('/directory/foreign',{name:'X'},'PATCH')).status).toBe(404)
})
test('live membership, write role and origin are checked on every request before repository access',async()=>{
 const f=fixture()
 expect((await f.send('/person/ensure',{})).status).toBe(200)
 expect(f.calls[0]).toEqual(['ensure',{tenantId:'one',identityId:'verified',displayName:'Account name',email:'account@example.test'}])
 f.identity.memberships[0].role='member'
 expect((await f.send('/directory')).status).toBe(200)
 expect((await f.send('/directory',{name:'X'})).status).toBe(403)
 f.identity.memberships[0].active=false
 expect((await f.send('/directory')).status).toBe(403)
 expect((await f.send('/person/ensure',{})).status).toBe(403)
 expect(f.calls).toHaveLength(2)
 f.identity.memberships[0].active=true;f.identity.memberships[0].role='admin'
 expect((await f.send('/directory',{name:'X'},'POST','https://foreign.example.test')).status).toBe(403)
 expect(f.calls).toHaveLength(2)
})
test('unavailable or mismatched identities and API keys cannot register; missing names never use email',async()=>{
 const f=fixture();f.identity.displayName=' '
 expect((await f.send('/person/ensure',{})).status).toBe(422)
 f.identity.userId='different'
 expect((await f.send('/person/ensure',{})).status).toBe(503)
 f.setUser('api-key:test')
 expect((await f.send('/person/ensure',{})).status).toBe(403)
 f.setUser('verified');f.fail()
 expect((await f.send('/directory')).status).toBe(503)
 expect(f.calls).toHaveLength(0)
})
