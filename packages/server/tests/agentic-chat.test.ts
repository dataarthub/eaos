import {test,expect} from 'bun:test'
import {ServerAutonomousWorker} from '../src/agentic/autonomous-worker'
import type {ServerAgentTaskRequest} from '../src/agentic/types'
const task:ServerAgentTaskRequest={id:'task-1',tenantId:'tenant-1',userId:'actor-1',title:'Review memo',instructions:'Summarize supplied memo',workerType:'litellm'}
const sse=(text:string)=>new Response('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
test('LiteLLM worker uses common Appkit stream with host auth, trusted metadata and same task result',async()=>{
 let seen:RequestInit|undefined,url=''
 const worker=new ServerAutonomousWorker({litellmEndpoint:'https://model.invalid/v1',litellmModel:'host-model',litellmHeaders:{Authorization:'Bearer fixture-key'},fetch:async(input,init)=>{url=String(input);seen=init;return sse('Accepted memo')}})
 const result=await worker.runTask(task)
 expect(result.status).toBe('COMPLETED');expect(result.output).toBe('Accepted memo')
 expect(url).toBe('https://model.invalid/v1/chat/completions')
 expect(new Headers(seen?.headers).get('authorization')).toBe('Bearer fixture-key')
 expect(seen?.redirect).toBe('error')
 expect(JSON.parse(String(seen?.body))).toMatchObject({model:'host-model',stream:true,metadata:{tenantId:task.tenantId,taskId:task.id},messages:[{role:'user',content:task.instructions}]})
})
test('injected executor retains precedence and default missing model and HTTP failures stay failed data',async()=>{
 let calls=0
 const injected=new ServerAutonomousWorker({executors:{litellm:async()=> 'injected'},fetch:async()=>{calls++;throw Error('Must not call')}})
 expect((await injected.runTask(task)).output).toBe('injected');expect(calls).toBe(0)
 expect(await new ServerAutonomousWorker().runTask(task)).toMatchObject({status:'FAILED',error:'LiteLLM model is not configured'})
 const denied=new ServerAutonomousWorker({litellmModel:'m',fetch:async()=>new Response('secret provider diagnostic',{status:503})})
 expect(await denied.runTask(task)).toMatchObject({status:'FAILED',error:'LiteLLM request failed (503)'})
})
test('worker common chat enforces output, timeouts, cancellation and final live host authorization',async()=>{
 const limited=new ServerAutonomousWorker({litellmModel:'m',maxOutputChars:3,fetch:async()=>sse('oversized')})
 expect((await limited.runTask(task)).status).toBe('FAILED')
 const stalled=new ServerAutonomousWorker({litellmModel:'m',fetch:async()=>new Promise<Response>(()=>{})})
 expect(await stalled.runTask({...task,timeoutMs:15})).toMatchObject({status:'FAILED',error:'Chat cancelled or timed out'})
 const controller=new AbortController();controller.abort()
 expect(await stalled.runTask(task,{signal:controller.signal})).toMatchObject({status:'FAILED',error:'Chat cancelled or timed out'})
 let active=true
 const revoked=new ServerAutonomousWorker({litellmModel:'m',chat:{authorize:async()=>active,governance:{guard:{after:async()=>{active=false;return {allowed:true}}}}},fetch:async()=>sse('private output')})
 expect(await revoked.runTask(task)).toMatchObject({status:'FAILED',error:'Chat access denied'})
})
test('nonstreaming custom endpoints fail closed and unsupported protocols do not fetch',async()=>{
 const jsonOnly=new ServerAutonomousWorker({litellmModel:'m',fetch:async()=>Response.json({choices:[{message:{content:'JSON only'}}]})})
 expect((await jsonOnly.runTask(task)).status).toBe('FAILED')
 let calls=0
 const invalid=new ServerAutonomousWorker({litellmModel:'m',litellmEndpoint:'file:///etc/passwd',fetch:async()=>{calls++;return sse('no')}})
 expect(await invalid.runTask(task)).toMatchObject({status:'FAILED',error:'Invalid LiteLLM endpoint'});expect(calls).toBe(0)
})
test('worker text ceiling is independent of serialized chat event overhead and failed bodies are cancelled',async()=>{
 const exact=new ServerAutonomousWorker({litellmModel:'m',maxOutputChars:3,fetch:async()=>sse('abc')})
 expect(await exact.runTask(task)).toMatchObject({status:'COMPLETED',output:'abc'})
 let cancelled=0
 const failed=new ServerAutonomousWorker({litellmModel:'m',fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++}}),{status:503})})
 expect((await failed.runTask(task)).error).toBe('LiteLLM request failed (503)')
 expect(cancelled).toBe(1)
})
