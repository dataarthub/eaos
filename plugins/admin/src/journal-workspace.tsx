import UserHelp from './user-help'
import * as React from 'react'
import {Button} from '@alneas/appkit-react/tools/ui'
import {DataTable} from '@alneas/appkit-react/tools/data-table'
import {RecordWorkspaceProvider,useRecordWorkspaceClient} from '@alneas/eaos-react/record-workspace'
export {RecordWorkspaceProvider as WorkspaceProvider}
/**
 * Renders authorized command-journal catalogs, paged audit events and local continuity verification.
 * @returns The audit workspace, or null outside a ready RecordWorkspaceProvider.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Host client must implement admin_journal_catalog/events/verify operations. Checks enforce response tenant/resource scope and verification coverage atomic-journal-v1 with no external trust anchor. This UI does not prove external tamper resistance. Scope changes clear previous events and ignore stale replies.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import AdminJournalWorkspace, { WorkspaceProvider } from '@alneas/eaos-plugins/admin/journal-workspace';
 * export function AuditPage(props: Omit<React.ComponentProps<typeof WorkspaceProvider>, 'children'>) { return <WorkspaceProvider {...props}><AdminJournalWorkspace/></WorkspaceProvider>; }
 * ```
 */
export default function AdminJournalWorkspace(){const client=useRecordWorkspaceClient(),[resources,setResources]=React.useState<{id:string;label:string}[]>([]),[resourceId,setResourceId]=React.useState(''),[events,setEvents]=React.useState<any[]>([]),[next,setNext]=React.useState<number|null>(null),[verified,setVerified]=React.useState<any>(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),generation=React.useRef(0),catalogGeneration=React.useRef(0),pending=React.useRef<number|null>(null)
 const execute=async(op:string,a:Record<string,unknown>)=>{const r=await client!.execute('admin_journal_'+op,a),v=r.data as any;if(!v||v.tenantId!==r.tenantId||op!=='catalog'&&v.resourceId!==resourceId)throw Error('監査の範囲を確認できません。');return v}
 const load=async(n:number,afterSequence?:number)=>{const v=await execute('events',{resourceId,limit:50,...(afterSequence?{afterSequence}:{})});if(n===generation.current){setEvents(old=>afterSequence?[...old,...v.events]:v.events);setNext(v.nextSequence)}}
 const run=async(work:(n:number)=>Promise<unknown>)=>{if(pending.current!==null)return;const n=++generation.current;pending.current=n;setBusy(true);setError('');try{await work(n)}catch{if(n===generation.current){setEvents([]);setVerified(null);setError('監査資料を確認できません。現在の権限・有効状態と監査データの整合性を確認してください。')}}finally{if(pending.current===n)pending.current=null;if(n===generation.current)setBusy(false)}}
 React.useEffect(()=>{generation.current++;const catalog=++catalogGeneration.current;pending.current=null;setBusy(false);setResources([]);setResourceId('');setEvents([]);setNext(null);setVerified(null);setError('');if(client)void execute('catalog',{}).then(v=>{if(catalog===catalogGeneration.current)setResources(v.resources)}).catch(()=>{if(catalog===catalogGeneration.current)setError('許可された監査資料を確認できません。')});return()=>{generation.current++;catalogGeneration.current++}},[client])
 React.useEffect(()=>{const n=++generation.current;pending.current=null;setBusy(false);setEvents([]);setNext(null);setVerified(null);setError('');if(resourceId&&client)void load(n).catch(()=>{if(n===generation.current)setError('監査履歴を確認できません。')})},[resourceId,client])
 if(!client)return null
 return <section aria-label="現在の組織の操作監査" style={{padding:24,maxWidth:1200}}><h1>操作監査</h1><UserHelp/><p>現在の組織で許可された業務の操作履歴と保存データの整合性を確認します。業務本文・秘密情報は表示しません。検証対象は現行のトランザクション監査記録です。外部の改ざん防止サービスによる証明ではありません。</p><label style={{display:'block',margin:'16px 0'}}>確認する監査資料<select aria-label="確認する監査資料" disabled={busy} value={resourceId} onChange={e=>setResourceId(e.target.value)}><option value="">業務を選択</option>{resources.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>{error&&<p role="alert">{error}</p>}{resourceId&&<><Button disabled={busy} onClick={()=>void run(load)}>監査履歴を再読み込み</Button><Button disabled={busy} onClick={()=>void run(async n=>{const v=await execute('verify',{resourceId});if(v.status!=='verified'||v.externalTrustAnchor!==false||v.coverage!=='atomic-journal-v1')throw Error();if(n===generation.current)setVerified(v)})}>履歴と実行記録の整合性を確認</Button>{verified&&<p role="status">整合性を確認しました：{verified.count}件。現行監査記録の連続性・ハッシュ・実行記録との一致を確認しました。</p>}<DataTable rowIdField="sequence" data={events} columns={[{accessorKey:'sequence',header:'順序'},{accessorKey:'operation',header:'操作'},{accessorKey:'actorId',header:'実行アカウント'},{accessorKey:'at',header:'実行日時'},{accessorKey:'hash',header:'記録のハッシュ'}]}/>{next&&<Button disabled={busy} onClick={()=>void run(n=>load(n,next))}>次の監査履歴</Button>}</>}</section>
}
