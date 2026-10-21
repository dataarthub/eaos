import * as React from 'react'
import { Button, Input } from '@alneas/appkit-react/tools/ui'
import { createWorkspaceReactBindings, type WorkspaceSnapshot } from '@alneas/eaos-react'
import type { ApprovalDocument } from './service'
import UserHelp from './user-help'

/**
 * Approval records exposed by the host workspace loader.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface ApprovalList {
/**
 * Visible approval records containing ID, optimistic revision and persisted request value.
 */
  requests: {
/**
 * Persisted approval record identifier.
 */
  id: string;
/**
 * Positive optimistic approval revision sent with decisions/withdrawals.
 */
  revision: number;
/**
 * Controlled field value; the host must update it in response to onChange.
 */
  value: ApprovalDocument }[] }
const bindings = createWorkspaceReactBindings<ApprovalList>()
/**
 * Provides an isolated authenticated session for the plugin workspace.
 * @param props - WorkspaceProviderProps containing verified tenant/resource/session IDs, stable client and children.
 * @returns Children after the session is ready, otherwise loading/unavailable status content.
 *
 * @remarks
 * Closes old UI sessions on scope change/unmount. The host owns transport authentication and authorization; see ApprovalPage for setup.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { ApprovalPage, ApprovalProvider } from '@alneas/eaos-plugins/approval/workspace';
 * export function Page(props: Omit<React.ComponentProps<typeof ApprovalProvider>, 'children'>) { return <ApprovalProvider {...props}><ApprovalPage/></ApprovalProvider>; }
 * ```
 */
export const ApprovalProvider = bindings.WorkspaceProvider

/**
 * Renders approval requests, submission and current-stage decision/withdrawal forms.
 *
 * The host supplies live-authenticated transports; decision eligibility is enforced by the service.
 * @returns The workspace page with loading/error state, or an alert when the host provider is missing.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Mount inside ApprovalProvider with a stable live-authenticated client. The host supplies load and submit/decide/withdraw workspace operations. Unmount/client changes ignore stale reads; save failures clear displayed state because the outcome may be uncertain.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { ApprovalPage, ApprovalProvider } from '@alneas/eaos-plugins/approval/workspace';
 * export function Page(props: Omit<React.ComponentProps<typeof ApprovalProvider>, 'children'>) { return <ApprovalProvider {...props}><ApprovalPage/></ApprovalProvider>; }
 * ```
 */
export function ApprovalPage() {
 const client = bindings.useClient()
 const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot<ApprovalList> | null>(null)
 const [error, setError] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false)
 const [version, reload] = React.useReducer(n => n + 1, 0)
 const identity = React.useRef(client); identity.current = client
 React.useEffect(() => {
  let active = true; setSnapshot(null); setError(null); setBusy(true)
  if (!client) { setBusy(false); return }
  void client.load().then(value => { if (active) setSnapshot(value) }).catch(() => { if (active) setError('取得できません。権限と接続を確認してください。') }).finally(() => { if (active) setBusy(false) })
  return () => { active = false }
 }, [client, version])
 async function run(operation: string, input: Record<string, unknown>) {
  if (!client || busy || !snapshot) return
  const source = client; setBusy(true); setError(null)
  try { await source.execute(operation, input); if (identity.current === source) { setSnapshot(null); reload() } }
  catch { if (identity.current === source) { setSnapshot(null); setError('保存を確認できません。最新状態を再取得してください。') } }
  finally { if (identity.current === source) setBusy(false) }
 }
 if (!client) return <p role="alert">ホストでApprovalProviderを接続してください。</p>
 return <main className="p-4 space-y-4"><h1>承認</h1><UserHelp/>
  <Button disabled={busy} onClick={reload}>再取得</Button>{error && <p role="alert">{error}</p>}
  {!snapshot ? <p role="status">{error ? '再取得が必要です。' : '読み込み中...'}</p> : <>
   <form onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); void run('submit', values) }}>
    <fieldset disabled={busy} className="space-y-2"><h2>承認を申請</h2>{[['templateId','承認ルール'],['title','件名'],['targetType','対象種別'],['targetId','対象ID']].map(([name,label]) => <label className="block" key={name}>{label}<Input name={name} required maxLength={name === 'title' ? 1000 : 256}/></label>)}<Button type="submit">承認を申請</Button></fieldset>
   </form>
   <section aria-label="承認一覧" className="space-y-4">{snapshot.data.requests.length === 0 && <p>申請はありません。</p>}{snapshot.data.requests.map(request => <article className="border rounded p-4" key={request.id}>
    <h2>{request.value.title}</h2><p>{request.value.status} / {request.value.targetType} / {request.value.targetId}</p><p>申請者: {request.value.requestedBy}</p>
    <ol>{request.value.history.map((entry,index) => <li key={index}>{entry.at} / {entry.actorId} / {entry.action}{entry.comment ? ' / ' + entry.comment : ''}</li>)}</ol>
    {request.value.status === 'pending' && <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run('decide', { id: request.id, revision: request.revision, action: String(data.get('action')), ...(data.get('comment') ? { comment: String(data.get('comment')) } : {}) }) }}>
     <fieldset disabled={busy}><label>判断<select name="action"><option value="approve">承認</option><option value="reject">却下</option></select></label><label>コメント<Input name="comment" maxLength={4000}/></label><Button type="submit">判断を保存</Button><Button type="button" onClick={() => void run('withdraw', { id: request.id, revision: request.revision })}>申請を取り下げ</Button></fieldset>
    </form>}
   </article>)}</section>
  </>}
 </main>
}
