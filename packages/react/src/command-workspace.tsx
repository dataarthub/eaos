import * as React from 'react'
import {CoreWorkspaceHelp} from './user-guide'
import {Button,Input,Textarea} from '@alneas/appkit-react/tools/ui'
import {DataTable} from '@alneas/appkit-react/tools/data-table'
import type {WorkspaceClient,WorkspaceSnapshot} from './index'
/**
 * Command input configuration for native form values and optional choice catalogs.
 *
 * @see CommandWorkspace for a complete host integration example.
 */
export interface CommandField {
/**
 * Input property name sent to the host operation.
 */
  key:string;
/**
 * Input caption and accessible label.
 */
  label:string;
/**
 * Native input kind; number values become Number and booleans use checkbox presence.
 */
  type:'text'|'number'|'date'|'boolean'|'textarea'|'password';
/**
 * Controls native required validation; defaults to true except booleans.
 */
  required?:boolean;
/**
 * Number input lower bound.
 * @defaultValue 0
 */
  min?:number;
/**
 * Optional numeric input upper bound.
 */
  max?:number;
/**
 * Explicit value/label choices, taking precedence over collection.
 */
  options?:readonly {
/**
 * Command option ID sent to the host rather than its presentation label.
 */
  value:string;
/**
 * Input caption and accessible label.
 */
  label:string}[];
/**
 * Snapshot array key mapped to selectable record IDs when options are absent.
 */
  collection?:string}
/**
 * Named host operation and the ordered fields displayed for its command form.
 *
 * @see CommandWorkspace for a complete host integration example.
 */
export interface CommandAction {
/**
 * Host operation invoked on form submit.
 */
  operation:string;
/**
 * Action selector, heading and submit text.
 */
  label:string;
/**
 * Ordered command input definitions.
 */
  fields:readonly CommandField[];
/**
 * Optional explanatory text above the form.
 */
  note?:string}
/**
 * Plugin-owned collection labels, command definitions and input conversion.
 *
 * @see CommandWorkspace for a complete host integration example.
 */
export interface CommandWorkspaceDefinition {
/**
 * Workspace heading.
 */
  title:string;
/**
 * Snapshot collection keys mapped to navigation labels; first key is selected initially.
 */
  sections:Readonly<Record<string,string>>;
/**
 * Record property captions used to build visible scalar columns.
 */
  labels:Readonly<Record<string,string>>;
/**
 * Selectable host operations and their input definitions.
 */
  actions:readonly CommandAction[];
/**
 * Foreign-key display definitions naming a snapshot collection and label.
 */
  references?:Readonly<Record<string,{
/**
 * Snapshot collection key used to resolve selectable/reference records.
 */
  collection:string;
/**
 * Public reference column caption.
 */
  label:string}>>;
/**
 * Optional synchronous input conversion before revision is added; errors enter the command failure state.
 * @param operation - Host operation identifier.
 * @param input - Operation input validated and authorized by the host.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { CommandWorkspaceDefinition } from '@alneas/eaos-react/command-workspace';
 * export function commandInput(definition: CommandWorkspaceDefinition, operation: string, input: Record<string, unknown>) {
 *  return definition.prepare?.(operation, input) ?? input;
 * }
 * ```
 */
prepare?(operation:string,input:Record<string,unknown>):Record<string,unknown>}
/**
 * Renders snapshot collections and host-declared operation forms with a single pending command.
 *
 * Domain definitions and transport remain host/plugin owned. Reuse authenticated SDK snapshots and UI primitives.
 * @param props - Authenticated client or null, plugin-owned definition and optional help; undefined help uses core guide and null hides it.
 * @returns A list/form workspace, connection alert when client is missing, and status/error content while requests settle.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Client changes/unmount suppress obsolete replies without cancelling host writes. Commands include snapshot revision; a failure clears the visible snapshot because persistence may already have occurred.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { CommandWorkspace, type CommandWorkspaceDefinition } from '@alneas/eaos-react/command-workspace';
 * import type { WorkspaceClient } from '@alneas/eaos-react';
 * export function Page({client, definition}: {client: WorkspaceClient<unknown>; definition: CommandWorkspaceDefinition}) { return <CommandWorkspace client={client} definition={definition}/>; }
 * ```
 */
export function CommandWorkspace({client,definition,help}:{
/**
 * Optional help content; undefined uses core help and null hides help.
 */
  help?:React.ReactNode;
/**
 * Stable host transport carrying current authentication and authorization.
 */
  client:WorkspaceClient<any>|null;
/**
 * Plugin-owned workspace schema, labels and operation declarations.
 */
  definition:CommandWorkspaceDefinition}){
 const [snapshot,setSnapshot]=React.useState<WorkspaceSnapshot<any>|null>(null),[section,setSection]=React.useState(Object.keys(definition.sections)[0]),[actionId,setActionId]=React.useState(definition.actions[0]?.operation??''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),generation=React.useRef(0),pending=React.useRef<number|null>(null),lastClient=React.useRef(client)
 if(lastClient.current!==client){lastClient.current=client;generation.current++;pending.current=null}
 const active=React.useRef<WorkspaceClient<any>|null>(null),show=snapshot&&active.current===client?snapshot:null
 const load=async(n:number)=>{const v=await client!.load();if(n===generation.current&&lastClient.current===client){active.current=client;setSnapshot(v)}}
 const run=async(work:(n:number)=>Promise<void>)=>{if(!client||pending.current!==null)return;const n=++generation.current;pending.current=n;setBusy(true);setError('');setNotice('');try{await work(n)}catch{if(n===generation.current){setSnapshot(null);active.current=null;setError('結果を確認できません。最新状態を再取得し、現在の権限・入力・接続と処理状況を確認してください。')}}finally{if(pending.current===n)pending.current=null;if(n===generation.current)setBusy(false)}}
 React.useEffect(()=>{const n=++generation.current;pending.current=null;active.current=null;setSnapshot(null);setError('');setNotice('');setBusy(!!client);if(client)void load(n).catch(()=>{if(n===generation.current)setError('取得できません。現在の権限と接続を確認してください。')}).finally(()=>{if(n===generation.current)setBusy(false)});return()=>{generation.current++}},[client])
 if(!client)return <p role="alert">認証済みのワークスペース接続が必要です。</p>
 const state=show?.data??{},rows=Array.isArray(state[section])?state[section]:[],labels=definition.labels,columns=Object.entries(labels).filter(([key])=>rows.some((r:any)=>Object.hasOwn(r,key)&&r[key]!==null&&typeof r[key]!=='object')).map(([key,header])=>({accessorKey:key,header,cell:({row}:any)=>typeof row.original[key]==='boolean'?(row.original[key]?'はい':'いいえ'):String(row.original[key]??'')}))
 for(const [key,reference] of Object.entries(definition.references??{})){if(rows.some((r:any)=>typeof r[key]==='string'))columns.push({accessorKey:key,header:reference.label,cell:({row}:any)=>{const related=(state[reference.collection]??[]).find((v:any)=>v.id===row.original[key]);return related?String(related.displayName??related.name??related.content??related.code??related.url??'参照情報'):row.original[key]?'参照先を確認できません':'—'}})}
 return <main style={{padding:24,maxWidth:1200}}><h1>{definition.title}</h1>{help===undefined?<CoreWorkspaceHelp/>:help}<Button disabled={busy} onClick={()=>void run(load)}>最新状態を再取得</Button>{busy&&<p role="status">確認中…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{show&&<><nav aria-label="業務データの種類">{Object.entries(definition.sections).map(([key,label])=><Button key={key} disabled={busy} aria-pressed={key===section} onClick={()=>setSection(key)}>{label}</Button>)}</nav><section aria-label={definition.sections[section]}>{rows.length?<DataTable rowIdField="id" data={rows} columns={columns}/>:<p>登録データはありません。</p>}</section><section aria-label="業務操作"><label style={{display:'block',margin:'20px 0'}}>実行する操作<select aria-label="実行する操作" value={actionId} disabled={busy} onChange={e=>setActionId(e.target.value)}>{definition.actions.map(a=><option key={a.operation} value={a.operation}>{a.label}</option>)}</select></label>{definition.actions.filter(a=>a.operation===actionId).map(action=><article key={action.operation} style={{margin:'24px 0',padding:16,border:'1px solid #ddd'}}><h2>{action.label}</h2>{action.note&&<p>{action.note}</p>}<form key={String(show.revision)} onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget),input:Record<string,unknown>={};for(const f of action.fields){const value=data.get(f.key);if(f.type==='boolean')input[f.key]=data.has(f.key);else if(value!==null&&value!=='')input[f.key]=f.type==='number'?Number(value):String(value)}void run(async n=>{await client.execute(action.operation,{...(definition.prepare?.(action.operation,input)??input),revision:show.revision});await load(n);if(n===generation.current)setNotice(action.label+'：保存しました。')})}}><fieldset disabled={busy} style={{border:0,padding:0}}>{action.fields.map(field=><label key={field.key} style={{display:'grid',gap:8,margin:'12px 0'}}>{field.label}{field.collection||field.options?<select name={field.key} required={field.required!==false} aria-label={field.label}><option value="">選択してください</option>{(field.options??(state[field.collection!]??[]).map((row:any)=>({value:row.id,label:row.displayName??row.name??row.title??row.content??row.code??row.url??row.evidence??row.id}))).map((v:any)=><option key={v.value} value={v.value}>{v.label}</option>)}</select>:field.type==='textarea'?<Textarea name={field.key} required={field.required!==false} maxLength={50000} aria-label={field.label}/>:<Input name={field.key} aria-label={field.label} type={field.type==='boolean'?'checkbox':field.type} required={field.type!=='boolean'&&field.required!==false} min={field.type==='number'?(field.min??0):undefined} max={field.max} step={field.type==='number'?'any':undefined} maxLength={field.type==='password'?500:4000} autoComplete={field.type==='password'?'off':undefined}/>}</label>)}<Button type="submit">{action.label}</Button></fieldset></form></article>)}</section></>}</main>
}
