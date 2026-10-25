import { test, expect } from 'bun:test'
import { createOpenAICompatibleChatAdapter, type AIChatAdapter, type AIChatEvent, type AIChatMessage } from '@alneas/appkit-core/ai/ai-chat'
import { createChatClient } from './chat'
import { createAIModelRegistry } from '@alneas/eaos-core'
const p = { tenantId: 'tenant', userId: 'user' }, messages: AIChatMessage[] = [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Compare supplied data' }] }]
const descriptor = { name: 'read_report', description: 'Read an allowed report', inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false } }
const fake = (events: AIChatEvent[]): AIChatAdapter => ({ id: 'fixture', capabilities: { tools: true, structuredData: true, files: false }, async *stream() { yield* events } })
test('uses real app-core SSE transport and preserves assistant/tool-call/tool-result history', async () => {
 let body: any, requestSignal: AbortSignal | undefined
 const adapter = createOpenAICompatibleChatAdapter({ api: 'https://model.invalid/chat', model: 'host-model', headers: { Authorization: 'Bearer fixture-only' }, fetch: (async (_url, init) => {
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-only')
  expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  body = JSON.parse(String(init?.body)); requestSignal = init?.signal as AbortSignal
  return new Response('data: {"choices":[{"index":0,"delta":{"content":"Accepted "}}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"result"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
 }) as typeof fetch })
 const client = createChatClient({ adapter, authorize: async actor => actor.tenantId === p.tenantId })
 const history: AIChatMessage[] = [...messages, { id: 'a', role: 'assistant', parts: [{ type: 'tool-call', callId: 'call', name: 'read_report', input: {} }] }, { id: 't', role: 'tool', parts: [{ type: 'tool-result', callId: 'call', name: 'read_report', output: { count: 3 } }] }]
 expect((await client.complete(p, { messages: history })).message.parts).toEqual([{ type: 'text', text: 'Accepted result' }])
 expect(body.messages[1].tool_calls[0].id).toBe('call'); expect(body.messages[2].tool_call_id).toBe('call')
 expect(body.model).toBe('host-model'); expect(body.tools).toBeUndefined(); expect(requestSignal?.aborted).toBe(true)
})
test('tools default to undisclosed; explicit catalog calls are returned as data and never executed', async () => {
 let catalogs = 0, advertised: unknown
 const adapter = fake([{ type: 'tool-call', name: 'read_report', callId: 'one', input: {} }, { type: 'finish', reason: 'tool-calls' }])
 const stream = adapter.stream.bind(adapter); adapter.stream = request => { advertised = request.tools; return stream(request) }
 const client = createChatClient({ adapter, authorize: async () => true, tools: async () => { catalogs++; return [descriptor] } })
 await expect(client.complete(p, { messages })).rejects.toThrow('unregistered')
 expect(catalogs).toBe(0); expect(advertised).toBeUndefined()
 const result = await client.complete(p, { messages, tools: 'catalog' })
 expect(result.finishReason).toBe('tool-calls'); expect(result.message.parts[0].type).toBe('tool-call'); expect(catalogs).toBe(1)
})
test('denial and revocation during catalog lookup block disclosure; revocation midstream suppresses output', async () => {
 let calls = 0, active = true
 const adapter = fake([{ type: 'text-delta', text: 'private' }, { type: 'finish', reason: 'stop' }])
 const stream = adapter.stream.bind(adapter); adapter.stream = req => { calls++; return stream(req) }
 const client = createChatClient({ adapter, authorize: async actor => active && actor.tenantId === p.tenantId, tools: async () => { active = false; return [descriptor] } })
 await expect(client.complete({ ...p, tenantId: 'other' }, { messages })).rejects.toThrow('denied'); expect(calls).toBe(0)
 await expect(client.complete(p, { messages, tools: 'catalog' })).rejects.toThrow('denied'); expect(calls).toBe(0)
 active = true
 adapter.stream = async function* () { yield { type: 'text-delta', text: 'private' }; active = false; yield { type: 'finish', reason: 'stop' } }
 await expect(client.complete(p, { messages })).rejects.toThrow('denied')
})
test('EOF, truncation, duplicate calls and unsolicited provider tool results are rejected', async () => {
 const call: AIChatEvent = { type: 'tool-call', callId: 'x', name: 'read_report', input: {} }
 for (const events of [[], [{ type: 'finish', reason: 'length' }], [call, call], [{ type: 'tool-result', callId: 'x', name: 'read_report', output: true }], [call, { type: 'finish', reason: 'stop' }]] as AIChatEvent[][]) {
  await expect(createChatClient({ adapter: fake(events), authorize: async () => true, tools: async () => [descriptor] }).complete(p, { messages, tools: 'catalog' })).rejects.toThrow()
 }
})
test('input, output and event limits stop bounded work and abort the adapter', async () => {
 const events: AIChatEvent[] = [{ type: 'text-delta', text: 'private'.repeat(100) }, { type: 'finish', reason: 'stop' }]
 await expect(createChatClient({ adapter: fake(events), authorize: async () => true, maxInputChars: 5 }).complete(p, { messages })).rejects.toThrow('input limit')
 await expect(createChatClient({ adapter: fake(events), authorize: async () => true, maxOutputChars: 100 }).complete(p, { messages })).rejects.toThrow('output limit')
 await expect(createChatClient({ adapter: fake(events), authorize: async () => true, maxEvents: 1 }).complete(p, { messages })).rejects.toThrow('output limit')
})
test('timeout and external cancellation return even when a custom iterator stalls, and request cleanup', async () => {
 let signal: AbortSignal | undefined, returned = 0
 const adapter: AIChatAdapter = { ...fake([]), stream(request) { signal = request.signal; return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: async () => { returned++; return { done: true, value: undefined } } } } } } }
 await expect(createChatClient({ adapter, authorize: async () => true, timeoutMs: 15 }).complete(p, { messages })).rejects.toThrow('timed out')
 expect(signal?.aborted).toBe(true); expect(returned).toBe(1)
 const controller = new AbortController(); const result = createChatClient({ adapter, authorize: async () => true }).complete(p, { messages, signal: controller.signal })
 controller.abort(); await expect(result).rejects.toThrow('cancelled')
})
test('expired slow authorization cannot start a late model request', async () => {
 let calls = 0, allow!: (value: boolean) => void
 const adapter = fake([]); adapter.stream = () => { calls++; return fake([]).stream({ messages }) }
 const result = createChatClient({ adapter, authorize: () => new Promise(resolve => { allow = resolve }), timeoutMs: 10 }).complete(p, { messages })
 await expect(result).rejects.toThrow('timed out'); allow(true)
 await new Promise(resolve => setTimeout(resolve, 5)); expect(calls).toBe(0)
})
test('governance ports guard input, enforce budget, record usage and return a trace id', async () => {
 const events: AIChatEvent[] = [{ type: 'metadata', metadata: { usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cost: 2 } } }, { type: 'text-delta', text: 'safe' }, { type: 'finish', reason: 'stop' }]
 const observed: string[] = [], recorded: unknown[] = []
 const client = createChatClient({ adapter: fake(events), authorize: async () => true, governance: {
  guard: { before: input => ({ allowed: input.messages.length === 1, sensitivityLevel: 'level2_internal' }), after: input => ({ allowed: input.message.parts.length > 0 }) },
  budget: { authorize: async () => ({ allowed: true }), recordUsage: input => { recorded.push(input) } },
  observability: { record: event => { observed.push(event.phase) } },
 } })
 const result = await client.complete(p, { messages })
 expect(result.traceId).toBeString(); expect(result.sensitivityLevel).toBe('level2_internal')
 expect(result.usage?.totalTokens).toBe(14); expect(recorded).toHaveLength(1)
 expect(observed).toContain('started'); expect(observed).toContain('completed')
})
test('governance budget denial prevents the model adapter from starting', async () => {
 let calls = 0
 const adapter = fake([{ type: 'finish', reason: 'stop' }]); adapter.stream = () => { calls++; return fake([]).stream({ messages }) }
 const client = createChatClient({ adapter, authorize: async () => true, governance: { budget: { authorize: async () => ({ allowed: false, reason: 'daily limit' }) } } })
 await expect(client.complete(p, { messages })).rejects.toThrow('daily limit'); expect(calls).toBe(0)
})
test('chat uses only the host-approved model route and applies its bounds', async () => {
 const adapter = fake([{ type: 'text-delta', text: 'safe' }, { type: 'finish', reason: 'stop' }])
 const registry = createAIModelRegistry({ routes: [{ modelId: 'local-strict', adapterId: 'fixture', capabilities: ['chat'], allowedSensitivity: ['level3_strict'], maxInputChars: 1_000 }], defaultModelId: 'local-strict' })
 const client = createChatClient({ adapter, authorize: async () => true, modelRegistry: registry, modelAdapters: {'local-strict':adapter}, governance: { guard: { before: () => ({ allowed: true, sensitivityLevel: 'level3_strict' }) } } })
 expect((await client.complete(p, { messages })).message.parts).toEqual([{ type: 'text', text: 'safe' }])
 await expect(createChatClient({ adapter, authorize: async () => true, modelRegistry: registry, modelAdapters: {'local-strict':adapter}, governance: { model: 'unapproved', guard: { before: () => ({ allowed: true, sensitivityLevel: 'level3_strict' }) } } }).complete(p, { messages })).rejects.toThrow('not registered')
})
test('model route and adapter mismatches fail before model execution', async () => {
 let calls = 0
 const adapter = fake([{ type: 'finish', reason: 'stop' }]); adapter.stream = () => { calls++; return fake([{ type: 'finish', reason: 'stop' }]).stream({ messages }) }
 const registry = createAIModelRegistry({ routes: [{ modelId: 'host-route', adapterId: 'different-adapter', capabilities: ['chat'], allowedSensitivity: ['level2_internal'] }], defaultModelId: 'host-route' })
 await expect(createChatClient({ adapter, authorize: async () => true, modelRegistry: registry, modelAdapters:{'host-route':adapter} }).complete(p, { messages })).rejects.toThrow('does not match')
 expect(calls).toBe(0)
})

// Regressions for admission that changes in the final asynchronous governance phase.
test('late guard and usage callbacks cannot disclose a response after authorization revocation', async () => {
 for (const phase of ['after', 'usage', 'observe'] as const) {
  let active = true
  const adapter = fake([{ type: 'metadata', metadata: { usage: { totalTokens: 1 } } }, { type: 'text-delta', text: 'confidential' }, { type: 'finish', reason: 'stop' }])
  const client = createChatClient({ adapter, authorize: async () => active, governance: {
   guard: { after: async () => { await Promise.resolve(); if (phase === 'after') active = false; return { allowed: true } } },
   budget: { authorize: async () => ({ allowed: true }), recordUsage: async () => { await Promise.resolve(); if (phase === 'usage') active = false } },
   observability: { record: async event => { if (event.phase === 'completed') { await Promise.resolve(); if (phase === 'observe') active = false } } },
  } })
  await expect(client.complete(p, { messages })).rejects.toThrow('denied')
 }
})

test('host-configured worker ceilings are accepted while defaults and absolute maxima remain bounded', async () => {
 const adapter=fake([{type:'finish',reason:'stop'}])
 const client=createChatClient({adapter,authorize:async()=>true,timeoutMs:3_600_000,maxInputChars:7_000_000,maxOutputChars:10_000_000})
 expect((await client.complete(p,{messages})).finishReason).toBe('stop')
 for(const limits of [{timeoutMs:3_600_001},{maxInputChars:7_000_001},{maxOutputChars:10_000_001},{timeoutMs:0},{maxEvents:100_001}])expect(()=>createChatClient({adapter,authorize:async()=>true,...limits})).toThrow('limit')
})
test('revocation in input governance prevents a provider call and provider errors propagate', async () => {
 for(const phase of ['guard','budget','observe'] as const){
  let active=true,calls=0
  const adapter=fake([{type:'finish',reason:'stop'}]);adapter.stream=()=>{calls++;return fake([{type:'finish',reason:'stop'}]).stream({messages})}
  const client=createChatClient({adapter,authorize:async()=>active,governance:{
   guard:{before:async()=>{await Promise.resolve();if(phase==='guard')active=false;return{allowed:true}}},
   budget:{authorize:async()=>{await Promise.resolve();if(phase==='budget')active=false;return{allowed:true}}},
   observability:{record:async event=>{await Promise.resolve();if(phase==='observe'&&event.phase==='started')active=false}},
  }})
  await expect(client.complete(p,{messages})).rejects.toThrow('denied');expect(calls).toBe(0)
 }
 const adapter=createOpenAICompatibleChatAdapter({api:'https://model.invalid/chat',model:'fixture',fetch:(async()=>new Response('Unavailable',{status:503})) as typeof fetch})
 await expect(createChatClient({adapter,authorize:async()=>true}).complete(p,{messages})).rejects.toThrow()
})
test('stalled final telemetry remains bounded and usage-recording failure rejects completion', async()=>{
 const adapter=fake([{type:'metadata',metadata:{usage:{totalTokens:1}}},{type:'finish',reason:'stop'}])
 await expect(createChatClient({adapter,authorize:async()=>true,timeoutMs:10,governance:{observability:{record:event=>event.phase==='completed'?new Promise(()=>{}):undefined}}}).complete(p,{messages})).rejects.toThrow('timed out')
 await expect(createChatClient({adapter,authorize:async()=>true,governance:{budget:{authorize:async()=>({allowed:true}),recordUsage:async()=>{throw Error('Fixture accounting outage')}}}}).complete(p,{messages})).rejects.toThrow('Fixture accounting outage')
})
test('registry routes require explicit model adapter bindings and reserved parameters cannot override transport policy', async()=>{
 let calls=0,selectedModel:unknown
 const request=(async(_url,init)=>{calls++;selectedModel=JSON.parse(String(init?.body)).model;return new Response('data: {"choices":[{"delta":{"content":"safe"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})}) as typeof fetch
 const wrong=createOpenAICompatibleChatAdapter({api:'https://model.invalid/chat',model:'wrong-provider-model',fetch:request})
 const right=createOpenAICompatibleChatAdapter({api:'https://model.invalid/chat',model:'approved-provider-model',fetch:request})
 const registry=createAIModelRegistry({routes:[{modelId:'approved',adapterId:right.id,capabilities:['chat'],allowedSensitivity:['level2_internal']}],defaultModelId:'approved'})
 await expect(async()=>createChatClient({adapter:wrong,authorize:async()=>true,modelRegistry:registry}).complete(p,{messages})).toThrow('binding')
 expect(calls).toBe(0)
 const bindings={approved:right}
 const client=createChatClient({adapter:wrong,authorize:async()=>true,modelRegistry:registry,modelAdapters:bindings})
 bindings.approved=wrong
 expect((await client.complete(p,{messages})).message.parts).toEqual([{type:'text',text:'safe'}])
 expect(selectedModel).toBe('approved-provider-model')
 for(const parameter of ['model','messages','tools','stream'])expect(()=>createChatClient({adapter:right,authorize:async()=>true,parameters:{[parameter]:parameter==='stream'?false:'override'}})).toThrow('reserved')
})
test('real Appkit usage-bearing SSE remains unknown and admitted failure attempts are recorded once',async()=>{
 const recorded:unknown[]=[]
 const adapter=createOpenAICompatibleChatAdapter({api:'https://model.invalid/chat',model:'fixture',fetch:(async()=>new Response('data: {"choices":[{"delta":{"content":"safe"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})) as typeof fetch})
 const budget={authorize:async()=>({allowed:true}),recordUsage:async(input:unknown)=>{recorded.push(input)}}
 const completed=await createChatClient({adapter,authorize:async()=>true,governance:{budget}}).complete(p,{messages})
 expect(completed.usage).toBeUndefined();expect(recorded).toHaveLength(1);expect(recorded[0]).toMatchObject({usage:undefined,context:{tenantId:p.tenantId,userId:p.userId}})
 for(const phase of ['guard','provider','revoked'] as const){
  recorded.length=0
  let active=true
  const failing=fake([{type:'finish',reason:'stop'}])
  failing.stream=async function*(){if(phase==='provider')throw Error('Provider failed');if(phase==='revoked')active=false;yield{type:'finish',reason:'stop'}}
  const client=createChatClient({adapter:failing,authorize:async()=>active,governance:{budget,...(phase==='guard'?{guard:{after:()=>({allowed:false})}}:{})}})
  await expect(client.complete(p,{messages})).rejects.toThrow();expect(recorded).toHaveLength(1);expect(recorded[0]).toMatchObject({usage:undefined})
 }
})
test('accounting errors propagate on success/failure and stalled accounting remains bounded without a second call',async()=>{
 for(const blocked of [false,true]){
  let recorded=0
  const client=createChatClient({adapter:fake([{type:'finish',reason:'stop'}]),authorize:async()=>true,governance:{guard:{after:()=>({allowed:!blocked})},budget:{authorize:async()=>({allowed:true}),recordUsage:async()=>{recorded++;throw Error('Accounting failed')}}}})
  await expect(client.complete(p,{messages})).rejects.toThrow('Accounting failed');expect(recorded).toBe(1)
 }
 let recorded=0
 await expect(createChatClient({adapter:fake([{type:'finish',reason:'stop'}]),authorize:async()=>true,timeoutMs:10,governance:{budget:{authorize:async()=>({allowed:true}),recordUsage:()=>{recorded++;return new Promise(()=>{})}}}}).complete(p,{messages})).rejects.toThrow('timed out')
 expect(recorded).toBe(1)
})
test('guard replacement is bounded before completion telemetry or disclosure',async()=>{
 let completed=false
 const client=createChatClient({adapter:fake([{type:'text-delta',text:'safe'},{type:'finish',reason:'stop'}]),authorize:async()=>true,maxOutputChars:200,governance:{guard:{after:()=>({allowed:true,messages:[{id:'oversized',role:'assistant',parts:[{type:'text',text:'x'.repeat(1000)}]}]})},observability:{record:event=>{if(event.phase==='completed')completed=true}}}})
 await expect(client.complete(p,{messages})).rejects.toThrow('output limit');expect(completed).toBe(false)
})

test('input guard and budget denial never start the adapter or report model usage',async()=>{
 for(const phase of ['input','budget'] as const){
  let provider=0,recorded=0
  const adapter=fake([]);adapter.stream=async function*(){provider++;yield{type:'finish',reason:'stop'}}
  await expect(createChatClient({adapter,authorize:async()=>true,governance:{guard:{before:()=>({allowed:phase!=='input'})},budget:{authorize:async()=>({allowed:phase!=='budget'}),recordUsage:async()=>{recorded++}}}}).complete(p,{messages})).rejects.toThrow()
  expect(provider).toBe(0);expect(recorded).toBe(0)
 }
})

test('a started provider timeout records unknown usage once and returns without waiting for stalled transport',async()=>{
 let recorded=0
 const adapter:AIChatAdapter={...fake([]),stream(){return{[Symbol.asyncIterator](){return{next:()=>new Promise(()=>{}),return:async()=>({done:true,value:undefined})}}}}}
 await expect(createChatClient({adapter,authorize:async()=>true,timeoutMs:10,governance:{budget:{authorize:async()=>({allowed:true}),recordUsage:async input=>{recorded++;expect(input.usage).toBeUndefined()}}}}).complete(p,{messages})).rejects.toThrow('timed out')
 expect(recorded).toBe(1)
})
