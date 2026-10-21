import {dom} from './dom-environment'
import {test,expect,beforeEach,afterEach} from 'bun:test'
import * as React from 'react'
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {SnapshotWorkspace,type SnapshotWorkspaceDefinition} from '../src/snapshot-workspace'
import {WorkspaceTextField,WorkspaceNumberField} from '../src/workspace-fields'
import {RecordWorkspace,RecordWorkspaceProvider,titleRecordSchema,type RecordWorkspaceDefinition} from '../src/record-workspace'
import {CommandWorkspace} from '../src/command-workspace'
import {UserGuide,type UserGuideDocument} from '../src/user-guide'
import {TenantModuleProvider,useTenantModule,createTenantModuleStore,createWorkspaceReactBindings,createWorkspaceClientBindings,useWorkspaceClientAdapter,useWorkspaceTask,type WorkspaceClient} from '../src/index'
let root:Root,container:HTMLDivElement
beforeEach(()=>{container=dom.document.createElement('div') as unknown as HTMLDivElement;dom.document.body.appendChild(container as any);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove()})
const render=async(element:React.ReactNode)=>{await act(async()=>{root.render(element);await Bun.sleep(0)})}
const click=async(text:string)=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);expect(button).toBeDefined();await act(async()=>{button!.click();await Bun.sleep(0)})}
const input=async(node:HTMLInputElement|HTMLTextAreaElement,value:string)=>{await act(async()=>{const prototype=node.tagName==='TEXTAREA'?dom.HTMLTextAreaElement.prototype:dom.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(node,value);node.dispatchEvent(new dom.Event('input',{bubbles:true}) as any);node.dispatchEvent(new dom.Event('change',{bubbles:true}) as any)})}
const submit=async(form:HTMLFormElement)=>{await act(async()=>{form.dispatchEvent(new dom.Event('submit',{bubbles:true,cancelable:true}) as any);await Bun.sleep(0)})}
const snapshot=(name='saved',revision=1)=>({tenantId:'t',recordId:'workspace',revision,data:{rows:[{id:'one',name,properties:{rating:'60min'},skills:[{code:'code',level:2}]}],projectId:'project',lock:{token:'token'}}})
const definition:SnapshotWorkspaceDefinition={title:'Fixture workspace',sections:{rows:'Rows'},labels:{id:'ID',name:'Name'},arrayLabels:{skills:'Skills'},itemLabels:{code:'Code',level:'Level'},nestedDetails:['properties'],actions:[{operation:'save',label:'Save',fields:[{key:'name',label:'Name',type:'text'},{key:'amount',label:'Amount',type:'number'},{key:'enabled',label:'Enabled',type:'boolean'},{key:'optional',label:'Optional',type:'text',required:false},{key:'reference',label:'Reference',type:'@rows'},{key:'choice',label:'Choice',type:'a:Option A,b:Option B'}]}],prepare:(_op,values)=>({...values,converted:true}),context:(_op,state)=>({projectId:state.projectId,lockToken:state.lock.token})}
test('snapshot workspace submits typed values with revision/context, renders details and reloads durable state',async()=>{
 let saved='initial',revision=1;const calls:any[]=[];const client={load:async()=>snapshot(saved,revision),execute:async(op:string,args:any)=>{calls.push([op,args]);saved=args.name;return snapshot(saved,++revision)}}
 await render(<SnapshotWorkspace client={client} definition={definition} help={<p>Plugin help</p>}/>);expect(container.textContent).toContain('initial');expect(container.textContent).toContain('Plugin help')
 await click('詳細');expect(container.textContent).toContain('60min');expect(container.textContent).toContain('Code: code');expect(container.textContent).toContain('Level: 2')
 await input(container.querySelector('input[name="name"]')!,'changed');await input(container.querySelector('input[name="amount"]')!,'4');await submit(container.querySelector('form')!)
 expect(calls).toHaveLength(1);expect(calls[0]).toEqual(['save',{name:'changed',amount:4,enabled:false,optional:'',reference:'one',choice:'a',converted:true,revision:1,projectId:'project',lockToken:'token'}]);expect(container.textContent).toContain('changed')
 await click('再取得');expect(container.textContent).toContain('changed')
})
test('snapshot workspace blocks double-submit and hides unconfirmed state after a rejected write',async()=>{
 let reject!:(e:Error)=>void,calls=0;const client={load:async()=>snapshot(),execute:async()=>{calls++;return new Promise<any>((_r,j)=>reject=j)}}
 await render(<SnapshotWorkspace client={client} definition={definition} help={null}/>);
 const form=container.querySelector('form')!;await submit(form);await submit(form);expect(calls).toBe(1)
 await act(async()=>reject(Error('revoked')));expect(container.querySelector('[role="alert"]')!.textContent).toContain('保存を確認できません');expect(container.textContent).not.toContain('saved')
 await click('再取得');expect(container.textContent).toContain('saved')
})
test('snapshot connection switch discards old successful and rejected loads and unmount cancels publication',async()=>{
 let resolve!:(v:any)=>void,reject!:(e:Error)=>void;const old={load:()=>new Promise<any>((r,j)=>{resolve=r;reject=j}),execute:async()=>snapshot('old')},fresh={load:async()=>snapshot('fresh'),execute:async()=>snapshot('fresh')}
 await render(<SnapshotWorkspace client={old} definition={definition} help={null}/>);await render(<SnapshotWorkspace client={fresh} definition={definition} help={null}/>);await act(async()=>resolve(snapshot('secret-old')));expect(container.textContent).toContain('fresh');expect(container.textContent).not.toContain('secret-old')
 await render(<SnapshotWorkspace client={old} definition={definition} help={null}/>);await render(<SnapshotWorkspace client={fresh} definition={definition} help={null}/>);await act(async()=>reject(Error('old failure')));expect(container.querySelector('[role="alert"]')).toBeNull()
 await render(<SnapshotWorkspace client={null} definition={definition}/>);expect(container.textContent).toContain('WorkspaceProvider')
})
test('number/text fields preserve blanks, Unicode, multiline and declared bounds',async()=>{
 let number=7,text='text';function Fields(){const [n,setN]=React.useState(7),[t,setT]=React.useState('text');return <><WorkspaceNumberField label="Number" value={n} min={-1} max={10} step="1" onChange={v=>{number=v;setN(v)}}/><WorkspaceTextField label="Text" value={t} multiline required max={50} onChange={v=>{text=v;setT(v)}}/><WorkspaceTextField label="Single" value="one" onChange={()=>{}}/></>}
 await render(<Fields/>);await input(container.querySelector('input[aria-label="Number"]')!,'');expect(Number.isNaN(number)).toBe(true);expect(container.querySelector('input')!.max).toBe('10');await input(container.querySelector('textarea')!,'日本語\ntext');expect(text).toBe('日本語\ntext')
})
test('tenant bindings publish current context and listeners unsubscribe without granting a missing provider',async()=>{
 const store=createTenantModuleStore(async()=>({tenantId:'t',userId:'u',enabledModules:['notes']}));function Content(){const state=useTenantModule();return <p>{state.loading?'loading':String(state.hasModule('notes'))}</p>}
 await render(<TenantModuleProvider store={store}><Content/></TenantModuleProvider>);expect(container.textContent).toBe('loading');await act(async()=>store.refresh());expect(container.textContent).toBe('true');await act(async()=>store.clear());expect(container.textContent).toBe('false')
})
test('workspace provider isolates replacement sessions and closes an old in-flight client',async()=>{
 const bindings=createWorkspaceReactBindings<any>();let bound:WorkspaceClient<any>|null=null,resolve!:(v:any)=>void;function Panel(){bound=bindings.useClient();return <p>Ready</p>}
 const source={load:()=>new Promise<any>(r=>resolve=r),execute:async()=>snapshot()},component=(key:string)=><bindings.WorkspaceProvider tenantId="t" recordId="workspace" sessionKey={key} client={source}><Panel/></bindings.WorkspaceProvider>
 await render(component('one'));const old=bound!,pending=old.load().then(()=>null,error=>error.message);await render(component('two'));await act(async()=>resolve(snapshot()));expect(await pending).toContain('Stale');await expect(old.load()).rejects.toThrow('expired');expect(bound).not.toBe(old)
})
test('shared workspace task handles single-flight, stale rejection and scope adaptation',async()=>{
 let controls:ReturnType<typeof useWorkspaceTask>,reject!:(reason:unknown)=>void,failed=0,adapted:unknown;const client={load:async()=>snapshot(),execute:async()=>snapshot()},adapt=(tenantId:string,recordId:string,c:typeof client)=>({...c,scope:[tenantId,recordId]})
 function Panel({current}:{current:typeof client|null}){controls=useWorkspaceTask(current,()=>failed++);adapted=useWorkspaceClientAdapter('t','scope',client,adapt);return <p>{String(controls.busy)} {controls.error}</p>}
 await render(<Panel current={client}/>);const first=controls!;let running!:Promise<void>;await act(async()=>{running=first.run(()=>new Promise((_r,j)=>reject=j))});await first.run(async()=>{throw Error('must not run')});expect(failed).toBe(0);expect(adapted).toMatchObject({scope:['t','scope']})
 await render(<Panel current={null}/>);await act(async()=>{reject('old');await running});expect(failed).toBe(0);expect(container.textContent).not.toContain('old')
 await render(<Panel current={client}/>);await act(async()=>controls!.run(async()=>{throw Error('current failure')}));expect(failed).toBe(1);expect(container.textContent).toContain('current failure')
 let late!:(reason:unknown)=>void,work!:Promise<void>;await act(async()=>{work=controls!.run(()=>new Promise((_r,reject)=>late=reject))});await render(null);await act(async()=>{late(Error('unmounted'));await work});expect(failed).toBe(1)
})
const record={tenantId:'t',id:'one',revision:1,title:'First'}
const recordDefinition:RecordWorkspaceDefinition={id:'records',title:'Records',listKey:'rows',operations:{list:'list',get:'get',create:'create',update:'update'},schemas:{list:{properties:{limit:{type:'integer'},search:{type:'string'}}},create:{properties:{title:{type:'string',title:'Title'},commandId:{type:'string'}},required:['title']},update:{properties:{patch:{properties:{title:{type:'string',title:'Title'}}}}}},columns:[{accessorKey:'title',header:'Title'}],commands:[{operation:'preview',label:'Preview',preview:true,schema:{properties:{}}}]}
test('record workspace loads, searches, validates selected records, previews and switches provider scope',async()=>{
 const calls:any[]=[];const client={load:async()=>({tenantId:'t',recordId:'records',revision:0,data:{rows:[record],nextCursor:'next',mayHaveMore:true}}),execute:async(op:string,args:any)=>{calls.push([op,args]);return{tenantId:'t',recordId:'records',revision:0,data:op==='get'?record:op==='preview'?{summary:'preview result'}:{rows:[record]}}}}
 const page=(enabled=true)=><RecordWorkspaceProvider tenantId={enabled?'t':null} recordId="records" sessionKey="session" client={client}><RecordWorkspace definition={recordDefinition} help={null}/></RecordWorkspaceProvider>
 await render(page());expect(container.textContent).toContain('First');await click('次のページ');expect(calls.at(-1)).toEqual(['list',{limit:100,cursor:'next'}])
 await input(container.querySelector('input[type="search"]')!,'term');await click('検索');expect(calls.at(-1)).toEqual(['list',{limit:100,search:'term'}])
 await click('新規登録');expect(container.querySelector('form')).not.toBeNull();await click('キャンセル');expect(container.querySelectorAll('form').length).toBeGreaterThanOrEqual(1)
 await click('Preview');await submit([...container.querySelectorAll('form')].at(-1)!);expect(container.textContent).toContain('preview result')
 await render(page(false));expect(container.textContent).not.toContain('First')
})
test('record schema titles recurse through arrays without altering canonical schema and guide supports all static blocks',async()=>{
 const schema={properties:{rows:{items:{properties:{value:{type:'string'}}}}}};expect(titleRecordSchema(schema,{rows:'Rows',value:'Value'}).properties.rows.items.properties.value.title).toBe('Value');expect((schema.properties.rows as any).title).toBeUndefined()
 const document:UserGuideDocument={schemaVersion:1,id:'fixture',locale:'ja',blocks:[{type:'heading',level:1,children:[{type:'text',text:'Heading'}]},{type:'paragraph',children:[{type:'strong',children:[{type:'code',text:'code'}]},{type:'emphasis',children:[{type:'text',text:'em'}]},{type:'link',href:'javascript:alert(1)',children:[{type:'text',text:'unsafe'}]},{type:'link',href:'https://example.test',children:[{type:'text',text:'safe'}]}]},{type:'list',ordered:true,items:[[{type:'paragraph',children:[{type:'text',text:'one'}]}]]},{type:'list',ordered:false,items:[]},{type:'table',header:[[{type:'text',text:'Column'}]],rows:[[[{type:'text',text:'Cell'}]]]},{type:'code',text:'example'}]}
 await render(<UserGuide document={document} initiallyOpen/>);expect(container.querySelectorAll('a')).toHaveLength(1);expect(container.querySelector('h2')!.textContent).toBe('Heading');expect(container.querySelector('table')!.textContent).toContain('Cell');expect(container.querySelector('article')!.tabIndex).toBe(0)
})
test('command workspace retains selected-action UI and reloads after typed submission',async()=>{
 const calls:any[]=[];const client={load:async()=>snapshot(),execute:async(op:string,a:any)=>{calls.push([op,a]);return snapshot()}}
 await render(<CommandWorkspace client={client} definition={{title:'Commands',sections:{rows:'Rows'},labels:{name:'Name'},actions:[{operation:'save',label:'Save',fields:[{key:'name',label:'Name',type:'text'},{key:'amount',label:'Amount',type:'number'},{key:'enabled',label:'Enabled',type:'boolean'},{key:'note',label:'Note',type:'textarea',required:false},{key:'reference',label:'Reference',type:'text',collection:'rows'}]}]}} help={null}/>);
 await input(container.querySelector('input[name="name"]')!,'changed');await input(container.querySelector('input[name="amount"]')!,'3');await submit(container.querySelector('form')!);expect(calls[0]).toEqual(['save',{name:'changed',amount:3,enabled:false,revision:1}]);expect(container.textContent).toContain('保存しました')
})
test('record workspace creates and edits records with current revision and command ID, then accepts newer owned overrides',async()=>{
 let saved={...record},created=false;const calls:any[]=[]
 const client={load:async()=>({tenantId:'t',recordId:'records',revision:0,data:{rows:created?[saved]:[]}}),execute:async(op:string,args:any)=>{calls.push([op,args]);if(op==='create'){created=true;saved={...record,id:'created',title:args.title}}else if(op==='update'){expect(args.id).toBe(saved.id);expect(args.revision).toBe(saved.revision);saved={...saved,...args.patch,revision:saved.revision+1}}return{tenantId:'t',recordId:'records',revision:0,data:op==='list'?{rows:[saved]}:saved}}}
 const page=(override?:typeof record)=><RecordWorkspaceProvider tenantId="t" recordId="records" sessionKey="session" client={client}><RecordWorkspace definition={recordDefinition} help={null} recordOverride={override}/></RecordWorkspaceProvider>
 await render(page());await click('新規登録');await input(container.querySelector('input[name="title"]')!,'Created title');await submit([...container.querySelectorAll('form')].at(-1)!);
 expect(calls.find(([op])=>op==='create')[1]).toMatchObject({title:'Created title',commandId:expect.any(String)});expect(container.textContent).toContain('保存しました')
 await click('編集');await input(container.querySelector('input[name="title"]')!,'Edited title');await submit([...container.querySelectorAll('form')].at(-1)!);expect(saved.revision).toBe(2);expect(saved.title).toBe('Edited title')
 await render(page({...saved,title:'Current override',revision:3}));expect(container.textContent).toContain('Current override');await render(page({...saved,tenantId:'foreign',title:'Foreign override',revision:4}));expect(container.textContent).not.toContain('Foreign override')
})

test('typed client bridges preserve payload APIs and revoke access through the shared provider',async()=>{
 type Client={execute(operation:string,input:Record<string,unknown>):Promise<string>}
 const bindings=createWorkspaceClientBindings<Client,string>((tenantId,recordId,client)=>({load:async()=>({tenantId,recordId,revision:0,data:'initial'}),execute:async(op,input)=>({tenantId,recordId,revision:0,data:await client.execute(op,input)})}),workspace=>({execute:async(op,input)=>(await workspace.execute(op,input)).data}))
 let bound:Client|null=null;function Panel(){bound=bindings.useClient();return <p>Typed scope</p>}
 const client={execute:async()=> 'saved'},page=(enabled:boolean)=><bindings.Provider tenantId={enabled?'t':null} sessionKey="scope" client={client}><Panel/></bindings.Provider>
 await render(page(true));const old=bound!;expect(await old.execute('save',{})).toBe('saved');await render(page(false));expect(container.textContent).not.toContain('Typed scope');await expect(old.execute('save',{})).rejects.toThrow('expired')
})
test('snapshot reference identity and display fields are defined by the plugin without domain-specific fallbacks',async()=>{
 const custom={...definition,collectionKey:(row:any)=>row.key,collectionLabel:(row:any)=>row.caption},client={load:async()=>({...snapshot(),data:{rows:[{key:'source-key',caption:'Candidate label'}]}}),execute:async()=>snapshot()}
 await render(<SnapshotWorkspace client={client} definition={custom} help={null}/>);const option=container.querySelector('select[name="reference"] option') as HTMLOptionElement;expect(option.value).toBe('source-key');expect(option.textContent).toBe('Candidate label')
})
