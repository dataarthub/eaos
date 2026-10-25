import {test,expect} from 'bun:test'
import {createStructuredDraftProposal} from '@alneas/eaos-core/ai/proposal-ui'
import {approvalBindingMatches,type ApprovalBinding} from '@alneas/eaos-core'
import type {PluginPrincipal,PluginRecord,PluginRecordStore} from '@alneas/eaos-server/plugin-data'
import {createRoutes,type ApprovalDocument,type ApprovalPluginOptions} from '../src'

const author:PluginPrincipal={tenantId:'tenant',userId:'author',roles:['member']}
const reviewer:PluginPrincipal={tenantId:'tenant',userId:'reviewer',roles:['reviewer']}
function fixture(configured=true) {
 const rows=new Map<string,PluginRecord<ApprovalDocument>>()
 const key=(tenant:string,id:string)=>`${tenant}:${id}`
 const store:PluginRecordStore<ApprovalDocument>={async create(tenant,row){rows.set(key(tenant,row.id),structuredClone(row))},async read(tenant,id){return structuredClone(rows.get(key(tenant,id))??null)},async list(){return []},async replace(tenant,row,expected){if(rows.get(key(tenant,row.id))?.revision!==expected)return false;rows.set(key(tenant,row.id),structuredClone(row));return true}}
 let principal:PluginPrincipal|null=author,binding:ApprovalBinding|undefined,writes=0
 const results=new Map<string,{title:string}>()
 const options:ApprovalPluginOptions={store,authorize:async()=>true,resolveTemplate:async()=>({id:'review',stages:[{id:'review',label:'Review',roles:['reviewer']}]}),verifyBinding:async(_p,value)=>Boolean(binding&&approvalBindingMatches(value,binding)),...(configured?{reviewedDrafts:{templateId:'review',resolveContract:async()=>({operation:'notes.save',version:'1',permission:'notes.write',sideEffect:'write' as const,riskLevel:'high' as const,approvalLevel:'L2_LEAD' as const,inputSchema:{type:'object'}}),saveProposal:async(_p,_proposal,value)=>{binding=value},execute:async(_p,_operation,input,id)=>{if(!results.has(id)){writes++;results.set(id,{title:String(input.title)})}return results.get(id)!}}}:{})}
 const app=createRoutes(options,async()=>principal)
 const post=(path:string,input:unknown)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})
 const input={title:'Operator reviewed'}
 const submission={scope:'notes',operation:'notes.save',input,proposal:createStructuredDraftProposal('notes','command-1',{title:'Review note',data:input},'2026-10-24T00:00:00Z')}
 return {post,submission,setPrincipal(value:PluginPrincipal|null){principal=value},get writes(){return writes}}
}
test('configured reviewed-draft route uses the same authentication boundary and rejects unknown envelope fields',async()=>{
 const f=fixture();f.setPrincipal(null)
 expect((await f.post('/drafts/review',f.submission)).status).toBe(401)
 f.setPrincipal(author)
 expect((await f.post('/drafts/review',{...f.submission,tenantId:'foreign'})).status).toBe(400)
 expect((await f.post('/drafts/review',{...f.submission,proposal:{}})).status).toBe(400)
 expect(f.writes).toBe(0)
})
test('configured route persists pending approval and executes only after an existing reviewer decision',async()=>{
 const f=fixture(),response=await f.post('/drafts/review',f.submission)
 expect(response.status).toBe(200)
 const pending=await response.json() as {status:string;approvalRequestId:string}
 expect(pending.status).toBe('pending');expect(f.writes).toBe(0)
 const bound={...f.submission,approvalRequestId:pending.approvalRequestId}
 expect((await f.post('/drafts/review',bound)).status).toBe(409);expect(f.writes).toBe(0)
 f.setPrincipal(reviewer)
 expect((await f.post(`/requests/${pending.approvalRequestId}/decisions`,{revision:1,action:'approve'})).status).toBe(200)
 f.setPrincipal(author)
 expect(await (await f.post('/drafts/review',bound)).json()).toEqual({status:'applied',result:{title:'Operator reviewed'}})
 expect((await f.post('/drafts/review',bound)).status).toBe(200);expect(f.writes).toBe(1)
})
test('review endpoint is absent when the host has not connected proposal and domain command ports',async()=>{
 const f=fixture(false)
 expect((await f.post('/drafts/review',f.submission)).status).toBe(404)
 expect(f.writes).toBe(0)
})
