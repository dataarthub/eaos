import {dom} from './dom-environment'
import {test,expect,beforeEach,afterEach} from 'bun:test'
import * as React from 'react'
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {RecordWorkspace,RecordWorkspaceProvider,type RecordWorkspaceDefinition} from '../src/record-workspace'
import type {AiDraftSubmission} from '@alneas/eaos-core/ai/proposal-ui'

let root:Root,container:HTMLDivElement
beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove()})
const schema={properties:{title:{type:'string',title:'Title'},commandId:{type:'string'}},required:['title']}
const definition:RecordWorkspaceDefinition={id:'notes',title:'Notes',listKey:'rows',operations:{list:'list',get:'get',create:'create',update:'update'},schemas:{list:{properties:{}},create:schema,update:{properties:{patch:schema}}},columns:[{accessorKey:'title',header:'Title'}],commands:[{operation:'create_note',label:'Create note',schema}]}
const saved={tenantId:'t',id:'new',revision:1,title:'Reviewed title'}
const snapshot=(data:unknown)=>({tenantId:'t',recordId:'notes',revision:0,data})
const draft={mode:'create_note',scope:'notes',riskLevel:2 as const,values:{title:'Suggested'}}
const render=async(element:React.ReactNode)=>act(async()=>{root.render(element);await Bun.sleep(0)})
const click=async(text:string)=>{const b=[...container.querySelectorAll('button')].find(button=>button.textContent?.trim()===text);expect(b).toBeDefined();await act(async()=>{b!.click();await Bun.sleep(0)})}
const submit=async()=>act(async()=>{const form=container.querySelector('section[aria-label="操作フォーム"] form')!;form.dispatchEvent(new dom.Event('submit',{bubbles:true,cancelable:true}) as unknown as Event);await Bun.sleep(0)})
const edit=async(value:string)=>act(async()=>{const node=container.querySelector('input[name="title"]')!;(node as HTMLInputElement).focus();Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new dom.Event('input',{bubbles:true}) as unknown as Event);node.dispatchEvent(new dom.Event('change',{bubbles:true}) as unknown as Event)})

test('unbound AI command requires Host review before any mutation',async()=>{
 const writes:string[]=[]
 const client={load:async()=>snapshot({rows:[]}),execute:async(op:string)=>{if(op!=='list')writes.push(op);return snapshot(op==='list'?{rows:[]}:saved)}}
 await render(<RecordWorkspaceProvider tenantId="t" recordId="notes" sessionKey="one" client={client}><RecordWorkspace definition={definition} help={null} aiDraft={draft}/></RecordWorkspaceProvider>)
 await click('画面に反映して確認');expect((container.querySelector('input[name="title"]') as HTMLInputElement).value).toBe('Suggested')
 await submit();expect(writes).toEqual([]);expect(container.textContent).toContain('レビュー接続')
})

test('review receives edited input, pending approval does not save, and approved result consumes the draft',async()=>{
 const submissions:AiDraftSubmission[]=[],writes:string[]=[]
 const client={load:async()=>snapshot({rows:[]}),execute:async(op:string)=>{writes.push(op);return snapshot({rows:[saved]})}}
 const review=async(request:AiDraftSubmission)=>{submissions.push(request);return request.approvalRequestId?{status:'applied' as const,result:snapshot(saved)}:{status:'pending' as const,approvalRequestId:'approval-1'}}
 await render(<RecordWorkspaceProvider tenantId="t" recordId="notes" sessionKey="one" client={client}><RecordWorkspace definition={definition} help={null} aiDraft={draft} reviewAiDraft={review} onApplyAiDraft={()=>{throw Error('notification failed')}}/></RecordWorkspaceProvider>)
 await click('画面に反映して確認');await edit('Reviewed title');await submit()
 expect(submissions).toHaveLength(1);expect(writes).toEqual([])
 expect(submissions[0].input).toMatchObject({title:'Reviewed title',commandId:expect.any(String)})
 expect(JSON.parse(submissions[0].proposal.changes.find(c=>c.field==='data')!.after as string)).toEqual(submissions[0].input)
 expect(container.textContent).toContain('承認待ち')
 await submit();expect(submissions[1].approvalRequestId).toBe('approval-1');expect(submissions[1].proposal.id).toBe(submissions[0].proposal.id)
 expect(container.textContent).toContain('保存しました');expect(container.querySelector('[aria-label="AI下書き提案"]')).toBeNull()
 expect(container.querySelector('section[aria-label="操作フォーム"]')).toBeNull()
 expect(writes).toEqual(['list'])
})

test('pending review is discarded when the operator changes the input',async()=>{
 const submissions:AiDraftSubmission[]=[]
 const client={load:async()=>snapshot({rows:[]}),execute:async()=>snapshot({rows:[]})}
 const review=async(request:AiDraftSubmission)=>{submissions.push(request);return {status:'pending' as const,approvalRequestId:'approval-'+submissions.length}}
 await render(<RecordWorkspaceProvider tenantId="t" recordId="notes" sessionKey="one" client={client}><RecordWorkspace definition={definition} help={null} aiDraft={draft} reviewAiDraft={review}/></RecordWorkspaceProvider>)
 await click('画面に反映して確認');await submit();await edit('Different');await submit()
 expect(submissions).toHaveLength(2);expect(submissions[1].approvalRequestId).toBeUndefined();expect(submissions[1].proposal.id).not.toBe(submissions[0].proposal.id)
})

test('a session replaced during post-save refresh cannot receive old notifications or records',async()=>{
 let release!:(value:ReturnType<typeof snapshot>)=>void, notified=0
 const oldClient={load:async()=>snapshot({rows:[]}),execute:async()=>new Promise<ReturnType<typeof snapshot>>(resolve=>{release=resolve})}
 const newClient={load:async()=>snapshot({rows:[]}),execute:async()=>snapshot({rows:[]})}
 const review=async()=>({status:'applied' as const,result:snapshot(saved)})
 const page=(client:typeof oldClient|typeof newClient,session:string)=><RecordWorkspaceProvider tenantId="t" recordId="notes" sessionKey={session} client={client}><RecordWorkspace definition={definition} help={null} aiDraft={draft} reviewAiDraft={review} onApplyAiDraft={()=>{notified++}}/></RecordWorkspaceProvider>
 await render(page(oldClient,'old'));await click('画面に反映して確認');await submit()
 expect(release).toBeDefined();await render(page(newClient,'new'))
 await act(async()=>{release(snapshot({rows:[saved]}));await Bun.sleep(0)})
 expect(notified).toBe(0);expect(container.textContent).not.toContain('Reviewed title');expect(container.querySelector('[role="alert"]')).toBeNull()
})

test('a newer source record invalidates a delayed reviewed save response',async()=>{
 const original={tenantId:'t',id:'one',revision:1,title:'Original'}
 const edited={...original,revision:2,title:'Older save result'}
 const latest={...original,revision:3,title:'Latest source'}
 const editDraft={mode:'edit',scope:'notes',targetId:'one',baseRevision:1,values:{title:'Suggested edit'}}
 let complete!:(value:{status:'applied';result:ReturnType<typeof snapshot>})=>void,notified=0
 const client={load:async()=>snapshot({rows:[original]}),execute:async(op:string)=>snapshot(op==='get'?original:{rows:[original]})}
 const review=()=>new Promise<{status:'applied';result:ReturnType<typeof snapshot>}>(resolve=>{complete=resolve})
 const page=(override?:typeof original)=><RecordWorkspaceProvider tenantId="t" recordId="notes" sessionKey="same" client={client}><RecordWorkspace definition={definition} help={null} aiDraft={editDraft} recordOverride={override} reviewAiDraft={review} onApplyAiDraft={()=>{notified++}}/></RecordWorkspaceProvider>
 await render(page());await act(async()=>{(container.querySelector('tbody tr') as HTMLElement).click();await Bun.sleep(0)})
 await click('画面に反映して確認');await submit();expect(complete).toBeDefined()
 await render(page(latest));await act(async()=>{complete({status:'applied',result:snapshot(edited)});await Bun.sleep(0)})
 expect(notified).toBe(0);expect(container.textContent).toContain('Latest source');expect(container.textContent).not.toContain('Older save result')
})

test('foreign workspace drafts are not displayed or projected into create forms',async()=>{
 const client={load:async()=>snapshot({rows:[]}),execute:async()=>snapshot({rows:[]})}
 await render(<RecordWorkspaceProvider tenantId="t" recordId="notes" sessionKey="one" client={client}><RecordWorkspace definition={definition} help={null} aiDraft={{...draft,scope:'another-plugin'}}/></RecordWorkspaceProvider>)
 expect(container.querySelector('[aria-label="AI下書き提案"]')).toBeNull()
 await click('新規登録');expect((container.querySelector('input[name="title"]') as HTMLInputElement).value).not.toBe('Suggested')
})

test.each([
 {targetId:'one',baseRevision:1},
 {targetId:'another',baseRevision:2},
 {targetId:'one'},
 {baseRevision:2},
])('bound edits require the exact source identity and revision: %j',async binding=>{
 const original={tenantId:'t',id:'one',revision:2,title:'Current'}
 const client={load:async()=>snapshot({rows:[original]}),execute:async()=>snapshot(original)}
 await render(<RecordWorkspaceProvider tenantId="t" recordId="notes" sessionKey="one" client={client}><RecordWorkspace definition={definition} help={null} aiDraft={{mode:'edit',scope:'notes',values:{title:'Stale suggestion'},...binding}}/></RecordWorkspaceProvider>)
 await act(async()=>{(container.querySelector('tbody tr') as HTMLElement).click();await Bun.sleep(0)})
 await click('画面に反映して確認')
 expect((container.querySelector('input[name="title"]') as HTMLInputElement).value).toBe('Current')
})

test('save shortcut submits only the workspace containing keyboard focus',async()=>{
 const writes:string[]=[]
 const page=(id:string)=>{
  const snap=(data:unknown)=>({tenantId:'t',recordId:id,revision:0,data})
  const client={load:async()=>snap({rows:[]}),execute:async(op:string,args:Record<string,unknown>)=>{if(op!=='list')writes.push(id);return snap(op==='list'?{rows:[]}:{...saved,title:args.title})}}
  return <RecordWorkspaceProvider key={id} tenantId="t" recordId={id} sessionKey={id} client={client}><RecordWorkspace definition={{...definition,id,title:id}} help={null}/></RecordWorkspaceProvider>
 }
 await render(<>{page('first')}{page('second')}</>)
 for(const id of ['first','second']){
  const section=container.querySelector(`section[aria-label="${id}"]`)!
  await act(async()=>{([...section.querySelectorAll('button')].find(button=>button.textContent==='新規登録') as HTMLButtonElement).click();await Bun.sleep(0)})
  const node=section.querySelector('input[name="title"]')!
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype,'value')!.set!.call(node,id);node.dispatchEvent(new dom.Event('input',{bubbles:true}) as unknown as Event)})
 }
 const focused=container.querySelector('section[aria-label="second"] input[name="title"]')!
 await act(async()=>{focused.dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}) as unknown as Event);await Bun.sleep(0)})
 expect(writes).toEqual(['second'])
})
